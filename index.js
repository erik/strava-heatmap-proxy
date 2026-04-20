const Router = require("./router");

// The Cloudflare worker runtime populates these globals.
//
// `globalThis` solves the chicken-and-egg problem of not being able to deploy
// the worker without the secret defined, and not being able to define the secret
// without the working already being deployed. See here for more context:
// https://github.com/cloudflare/wrangler/issues/1418
const Env = {
  STRAVA_ID: globalThis.STRAVA_ID,
  STRAVA_COOKIES: globalThis.STRAVA_COOKIES,
  TILE_CACHE_SECS: +TILE_CACHE_SECS || 0,
  ALLOWED_ORIGINS: (globalThis.ALLOWED_ORIGINS || '*').split(','),
};

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  try {
    let response = await caches.default.match(event.request.url);

    if (!response) {
      const r = new Router();
      r.get("/(personal|global)/.*", (req) => handleTileProxyRequest(req));
      r.get("/", () => handleIndexRequest());

      response = await r.route(event.request);

      if (Env.TILE_CACHE_SECS > 0 && response.status === 200) {
        response = new Response(response.body, response);
        response.headers.append("Cache-Control", `maxage=${Env.TILE_CACHE_SECS}`);
        event.waitUntil(caches.default.put(event.request.url, response.clone()));
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
  "https://content-a.strava.com/" +
  "identified/globalheat/{activity}/{color}/{z}/{x}/{y}{res}.png?v=19{qs}";

// Proxy requests from /kind/color/activity/z/x/y(?@2x).png to baseUrl
async function handleTileProxyRequest(request) {
  const url = new URL(request.url);

  const match = url.pathname.match(
    new RegExp("(personal|global)/(\\w+)/(\\w+)/(\\d+)/(\\d+)/(\\d+)(@small|@2x)?.png")
  );
  if (match === null) {
    return new Response("invalid url, expected: /kind/color/activity/z/x/y.png", {
      status: 400,
    });
  }

  const origin = request.headers.get('origin');
  if (!Env.ALLOWED_ORIGINS.includes('*')) {
    if (origin !== null && !Env.ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
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
    res: res === "@small" ? '' : (res || ''),
    qs: res === "@small" ? '&px=256' : '',
  };

  const baseUrl = kind === "personal" ? PERSONAL_MAP_URL : GLOBAL_MAP_URL;
  // replace templated data in base URL
  const proxyUrl = baseUrl.replace(/\{(\w+)\}/g, (_, key) => data[key]);

  const proxiedRequest = new Request(proxyUrl, {
    method: "GET",
    headers: new Headers({ Cookie: Env.STRAVA_COOKIES }),
  });

  let response = await fetch(proxiedRequest);
  response = new Response(
    await response.arrayBuffer(),
    response
  );

  response.headers.append('Access-Control-Allow-Origin', origin);

  return response;
}
