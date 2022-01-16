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
  TILE_CACHE_SECS: +TILE_CACHE_SECS || 0
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
        response.headers.append("Cache-Control", `s-maxage=${Env.TILE_CACHE_SECS}`);
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
  activities: all, ride, winter, run, water


Personal Heatmap
       512px: /personal/:color/:activity/{z}/{x}/{y}.png
      1024px: /personal/:color/:activity/{z}/{x}/{y}@2x.png

      colors: orange, hot, blue, bluered, purple, gray
  activities: all, ride, winter, run, water
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

  return await fetch(proxiedRequest);
}
