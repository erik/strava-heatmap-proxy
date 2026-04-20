const Router = require("./router");

// The Cloudflare worker runtime populates these globals.
//
// `globalThis` solves the chicken-and-egg problem of not being able to deploy
// the worker without the secret defined, and not being able to define the secret
// without the working already being deployed. See here for more context:
// https://github.com/cloudflare/wrangler/issues/1418
const Env = {
  STRAVA_ID: globalThis.STRAVA_ID,
  STRAVA_SESSION: globalThis.STRAVA_SESSION,
  TILE_CACHE_SECS: +TILE_CACHE_SECS || 0,
  ALLOWED_ORIGINS: (globalThis.ALLOWED_ORIGINS || "*").split(","),
};

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  try {
    let response = await caches.default.match(event.request.url);

    if (!response) {
      const r = new Router();
      r.get("/(personal|global)/.*", (req) =>
        handleTileProxyRequest(req, event),
      );
      r.get("/", () => handleIndexRequest());

      response = await r.route(event.request);

      if (Env.TILE_CACHE_SECS > 0 && response.status === 200) {
        response = new Response(response.body, response);
        response.headers.append(
          "Cache-Control",
          `maxage=${Env.TILE_CACHE_SECS}`,
        );
        event.waitUntil(
          caches.default.put(event.request.url, response.clone()),
        );
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

// Exchange our session cookie for fresh CloudFront credentials via /maps.
async function refreshCloudFrontCookies() {
  const resp = await fetch("https://www.strava.com/maps", {
    headers: {
      Cookie: `_strava4_session=${Env.STRAVA_SESSION}`,
      Referer: "https://www.strava.com/",
      Origin: "https://www.strava.com",
    },
    redirect: "manual",
  });

  const cookieNames = [
    "CloudFront-Key-Pair-Id",
    "CloudFront-Policy",
    "CloudFront-Signature",
    "_strava_idcf",
  ];

  const cookies = {};
  let expiry = 0;

  for (const header of resp.headers.getAll("set-cookie")) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (!match) continue;
    const [_, name, value] = match;

    if (value && cookieNames.includes(name)) {
      cookies[name] = value;
    } else if (name === "_strava_CloudFront-Expires" && value) {
      expiry = parseInt(value, 10);
    }
  }

  if (cookieNames.some((name) => !cookies[name])) {
    throw new Error(
      "Failed to obtain CloudFront cookies from Strava — session may be invalid",
    );
  }

  const cookieStr = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  return { cookies: cookieStr, expiry };
}

const KV_KEY = "strava_cloudfront_cookies";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

// in-memory cache, persists across requests within an isolate
let COOKIE_CACHE = null;

// Get valid CloudFront cookies, refreshing if needed.
async function getStravaCookies(event) {
  const now = Date.now();

  if (COOKIE_CACHE && COOKIE_CACHE.expiry > now + REFRESH_BUFFER_MS) {
    return COOKIE_CACHE.cookies;
  }

  const fromKv = await STRAVA_HEATMAP_PROXY_COOKIES.get(KV_KEY, {
    type: "json",
  });

  if (fromKv && fromKv.expiry && fromKv.expiry > now + REFRESH_BUFFER_MS) {
    COOKIE_CACHE = fromKv;
    return COOKIE_CACHE.cookies;
  }

  COOKIE_CACHE = await refreshCloudFrontCookies();

  const ttlSecs = Math.max(Math.floor((COOKIE_CACHE.expiry - now) / 1000), 60);
  event.waitUntil(
    STRAVA_HEATMAP_PROXY_COOKIES.put(KV_KEY, JSON.stringify(COOKIE_CACHE), {
      expirationTtl: ttlSecs,
    }),
  );

  return COOKIE_CACHE.cookies;
}

const PERSONAL_MAP_URL =
  "https://personal-heatmaps-external.strava.com/" +
  "tiles/{strava_id}/{color}/{z}/{x}/{y}{res}.png" +
  "?filter_type={activity}&include_everyone=true" +
  "&include_followers_only=true&respect_privacy_zones=true";

const GLOBAL_MAP_URL =
  "https://content-a.strava.com/" +
  "identified/globalheat/{activity}/{color}/{z}/{x}/{y}{res}.png?v=19{qs}";

// Proxy requests from /kind/color/activity/z/x/y(?@2x).png to baseUrl
async function handleTileProxyRequest(request, event) {
  const url = new URL(request.url);

  const match = url.pathname.match(
    new RegExp(
      "(personal|global)/(\\w+)/(\\w+)/(\\d+)/(\\d+)/(\\d+)(@small|@2x)?.png",
    ),
  );
  if (match === null) {
    return new Response(
      "invalid url, expected: /kind/color/activity/z/x/y.png",
      {
        status: 400,
      },
    );
  }

  const origin = request.headers.get("origin");
  if (!Env.ALLOWED_ORIGINS.includes("*")) {
    if (origin !== null && !Env.ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }
  }

  const [_, kind, color, activity, z, x, y, res] = match;
  const data = {
    strava_id: Env.STRAVA_ID,
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

  const stravaCookies = await getStravaCookies(event);

  const proxiedRequest = new Request(proxyUrl, {
    method: "GET",
    headers: new Headers({ Cookie: stravaCookies }),
  });

  let response = await fetch(proxiedRequest);
  response = new Response(await response.arrayBuffer(), response);

  response.headers.append("Access-Control-Allow-Origin", origin);

  return response;
}
