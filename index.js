import Router from "./router";

// Global variables for in-memory caching and request coalescing
let cachedCookies = null;
let cookieRefreshPromise = null;

export default {
  async fetch(request, env, ctx) {
    // Process env vars once per request or inline (cheap enough)
    const config = {
      STRAVA_ID: env.STRAVA_ID,
      STRAVA_COOKIES: env.STRAVA_COOKIES,
      TILE_CACHE_SECS: +env.TILE_CACHE_SECS || 0,
      ALLOWED_ORIGINS: (env.ALLOWED_ORIGINS || "*").split(","),
    };

    return handleRequest(request, env, ctx, config);
  },
};

async function handleRequest(request, env, ctx, config) {
  try {
    let response = await caches.default.match(request.url);

    if (!response) {
      const r = new Router();
      r.get("/(personal|global)/.*", (req) =>
        handleTileProxyRequest(req, env, config)
      );
      r.get("/", () => handleIndexRequest());

      response = await r.route(request);

      if (config.TILE_CACHE_SECS > 0 && response.status === 200) {
        response = new Response(response.body, response);
        response.headers.append(
          "Cache-Control",
          `maxage=${config.TILE_CACHE_SECS}`
        );
        ctx.waitUntil(caches.default.put(request.url, response.clone()));
      }
    }

    return response;
  } catch (err) {
    return new Response(`err in request handler: ${err}`, { status: 500 });
  }
}

function handleIndexRequest() {
  return new Response(`\
Global Heatmap
       256px: /global/:color/:activity/{z}/{x}/{y}@small.png
       512px: /global/:color/:activity/{z}/{x}/{y}.png
      1024px: /global/:color/:activity/{z}/{x}/{y}@2x.png

      colors: mobileblue, orange, hot, blue, bluered, purple, gray
  activities: all, ride, winter, run, water, ...


Personal Heatmap
       512px: /personal/:color/:activity/{z}/{x}/{y}.png
      1024px: /personal/:color/:activity/{z}/{x}/{y}@2x.png

      colors: orange, hot, blue, bluered, purple, gray
  activities: all, ride, winter, run, water, ...


Additional Activity Types
    sport_AlpineSki
    sport_BackcountrySki
    sport_Badminton
    sport_Canoeing
    sport_EBikeRide
    sport_EMountainBikeRide
    sport_Golf
    sport_GravelRide
    sport_Handcycle
    sport_Hike
    sport_IceSkate
    sport_InlineSkate
    sport_Kayaking
    sport_Kitesurf
    sport_MountainBikeRide
    sport_NordicSki
    sport_Pickleball
    sport_Ride
    sport_RockClimbing
    sport_RollerSki
    sport_Rowing
    sport_Run
    sport_Sail
    sport_Skateboard
    sport_Snowboard
    sport_Snowshoe
    sport_Soccer
    sport_StandUpPaddling
    sport_Surfing
    sport_Swim
    sport_Tennis
    sport_TrailRun
    sport_Velomobile
    sport_VirtualRide
    sport_VirtualRow
    sport_VirtualRun
    sport_Walk
    sport_Wheelchair
    sport_Windsurf
`);
}

const PERSONAL_MAP_URL =
  "https://personal-heatmaps-external.strava.com/" +
  "tiles/{strava_id}/{color}/{z}/{x}/{y}{res}.png" +
  "?filter_type={activity}&include_everyone=true" +
  "&include_followers_only=true&respect_privacy_zones=true";

const GLOBAL_MAP_URL =
  "https://heatmap-external-c.strava.com/" +
  "tiles-auth/{activity}/{color}/{z}/{x}/{y}{res}.png?v=19{qs}";

// --- Token Management Logic ---

// Helper to parse cookie string into an object
function parseCookies(cookieString) {
  const cookies = {};
  if (!cookieString) return cookies;
  cookieString.split(";").forEach((c) => {
    const [key, ...v] = c.trim().split("=");
    if (key) cookies[key] = v.join("=");
  });
  return cookies;
}

// Helper to check if required CloudFront cookies are present
function hasCloudFrontCookies(cookies) {
  return (
    cookies["CloudFront-Policy"] &&
    cookies["CloudFront-Key-Pair-Id"] &&
    cookies["CloudFront-Signature"]
  );
}

// Helper to format cookie object back to string
function formatCookies(cookies) {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function fetchNewTokens(sessionCookie) {
  if (!sessionCookie) {
    throw new Error("No session cookie available to refresh tokens");
  }

  // Fetch /auth to get new CloudFront cookies
  const authResp = await fetch("https://heatmap-external-a.strava.com/auth", {
    headers: { Cookie: `_strava4_session=${sessionCookie}` },
  });

  if (authResp.status !== 200) {
    throw new Error(`Authentication failed with status ${authResp.status}`);
  }

  const setCookieHeader = authResp.headers.get("Set-Cookie");
  if (!setCookieHeader) {
    throw new Error("No Set-Cookie header in auth response");
  }

  const newCookies = {};
  const keysToFind = [
    "CloudFront-Policy",
    "CloudFront-Key-Pair-Id",
    "CloudFront-Signature",
  ];

  keysToFind.forEach((key) => {
    const match = setCookieHeader.match(new RegExp(`${key}=([^;]+)`));
    if (match) {
      newCookies[key] = match[1];
    }
  });

  if (!hasCloudFrontCookies(newCookies)) {
    throw new Error("Failed to extract CloudFront cookies from response");
  }

  return newCookies;
}

async function getEffectiveCookies(env, forceRefresh = false) {
  // 1. Check in-memory cache (skip if forceRefresh)
  if (!forceRefresh && cachedCookies) {
    return cachedCookies;
  }

  // 2. Check caches.default (persistent-ish storage) (skip if forceRefresh)
  const cacheKey = "https://strava-heatmap-proxy-internal/tokens";
  if (!forceRefresh) {
    let cacheResp = await caches.default.match(cacheKey);
    if (cacheResp) {
      const cachedText = await cacheResp.text();
      cachedCookies = cachedText; // Populate memory cache
      return cachedText;
    }
  }

  // 3. Check env.STRAVA_COOKIES
  // It might contain valid CloudFront cookies (if just updated by userscript)
  // or just the session cookie.
  const envCookies = parseCookies(env.STRAVA_COOKIES);

  // If Env has valid CloudFront cookies, use them and cache them.
  // BUT if forceRefresh is true, we must assume Env tokens are stale too
  // (unless we rely on userscript keeping them fresh, but here we want to auto-refresh).
  let validTokens = null;
  if (!forceRefresh && hasCloudFrontCookies(envCookies)) {
    validTokens = envCookies;
  }

  const sessionCookie = envCookies["_strava4_session"];

  if (!validTokens) {
    // 4. Need to fetch new tokens.
    // Use request coalescing.
    if (!cookieRefreshPromise) {
      cookieRefreshPromise = (async () => {
        try {
          const newTokens = await fetchNewTokens(sessionCookie);
          // Merge with session cookie. Note: newTokens overwrites Env values.
          const merged = { ...envCookies, ...newTokens };
          return formatCookies(merged);
        } catch (e) {
          // If fetch fails, we might still return the envCookies as a fallback
          // or rethrow.
          console.error("Error fetching tokens:", e);
          throw e;
        } finally {
          cookieRefreshPromise = null;
        }
      })();
    }
    try {
      const refreshedCookieString = await cookieRefreshPromise;
      validTokens = parseCookies(refreshedCookieString);
    } catch (e) {
      // If refresh failed, and we don't have valid tokens, we are stuck.
      // Return whatever is in Env and hope for the best?
      return env.STRAVA_COOKIES;
    }
  }

  // Reconstruct string
  const finalCookieString = formatCookies(validTokens);

  // Update caches
  cachedCookies = finalCookieString;

  // Store in caches.default with a TTL (e.g. 6 hours to be safe, max 24h)
  const tokensResponse = new Response(finalCookieString);
  tokensResponse.headers.append("Cache-Control", "maxage=21600"); // 6 hours
  await caches.default.put(cacheKey, tokensResponse);

  return finalCookieString;
}

// --- End Token Management ---

// Proxy requests from /kind/color/activity/z/x/y(?@2x).png to baseUrl
async function handleTileProxyRequest(request, env, config) {
  const url = new URL(request.url);

  const match = url.pathname.match(
    new RegExp(
      "(personal|global)/(\\w+)/(\\w+)/(\\d+)/(\\d+)/(\\d+)(@small|@2x)?.png"
    )
  );
  if (match === null) {
    return new Response(
      "invalid url, expected: /kind/color/activity/z/x/y.png",
      {
        status: 400,
      }
    );
  }

  const origin = request.headers.get("origin");
  if (!config.ALLOWED_ORIGINS.includes("*")) {
    if (origin !== null && !config.ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }
  }

  const [_, kind, color, activity, z, x, y, res] = match;
  const data = {
    strava_id: config.STRAVA_ID,
    color,
    activity,
    x,
    y,
    z,
    // "@small" and "@2x" as part of the URL don't map 1:1 to Strava's API.
    res: res === "@small" ? "" : res || "",
    qs: res === "@small" ? "&px=256" : "",
  };

  const baseUrl = kind === "personal" ? PERSONAL_MAP_URL : GLOBAL_MAP_URL;
  // replace templated data in base URL
  const proxyUrl = baseUrl.replace(/\{(\w+)\}/g, (_, key) => data[key]);

  // Get valid cookies (auto-refreshing if needed)
  let cookies;
  try {
    cookies = await getEffectiveCookies(env);
  } catch (e) {
    return new Response(`Failed to get Strava cookies: ${e.message}`, {
      status: 500,
    });
  }

  const proxiedRequest = new Request(proxyUrl, {
    method: "GET",
    headers: new Headers({ Cookie: cookies }),
  });

  let response = await fetch(proxiedRequest);

  // If we get a 403/401, it might mean our tokens expired (even if we thought they were valid).
  // We could implement a retry here: force refresh tokens and try again.
  if (response.status === 403 || response.status === 401) {
    // Clear caches
    cachedCookies = null;
    await caches.default.delete(
      "https://strava-heatmap-proxy-internal/tokens"
    );

    // Retry once
    try {
      cookies = await getEffectiveCookies(env, true); // Force refresh
      const retryRequest = new Request(proxyUrl, {
        method: "GET",
        headers: new Headers({ Cookie: cookies }),
      });
      response = await fetch(retryRequest);
    } catch (e) {
      // ignore, return original error
    }
  }

  response = new Response(await response.arrayBuffer(), response);

  response.headers.append("Access-Control-Allow-Origin", origin);

  return response;
}
