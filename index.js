const Router = require("./router");

// The Cloudflare worker runtime populates these globals.
const Env = {
  STRAVA_ID,
  STRAVA_SESSION,
  CF_ID,
  CF_SIG,
  CF_POLICY,
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

      // TODO: Make this configurable, probably don't want to cache
      // _everything_
      response = new Response(response.body, response);
      response.headers.append("Cache-Control", "s-maxage=60");
      event.waitUntil(caches.default.put(event.request.url, response.clone()));
    }

    return response;
  } catch (err) {
    return new Response(`err in request handler: ${err}`, { status: 500 });
  }
}

function handleIndexRequest() {
  return new Response(`\
Global Heatmap
  /global/:color/{z}/{x}/{y}.png
  /global/:color/{z}/{x}/{y}@2x.png

  color choices: mobileblue, orange, hot, blue, bluered, purple, gray

Personal Heatmap
  /personal/:color/{z}/{x}/{y}.png
  /personal/:color/{z}/{x}/{y}@2x.png

  color choices: orange, hot, blue, bluered, purple, gray
`);
}

const PERSONAL_MAP_URL =
  "https://personal-heatmaps-external.strava.com/" +
  "tiles/{strava_id}/{color}/{z}/{x}/{y}{res}.png" +
  "?filter_type=ride&include_everyone=true" +
  "&include_followers_only=true&respect_privacy_zones=true";

const GLOBAL_MAP_URL =
  "https://heatmap-external-c.strava.com/" +
  "tiles-auth/ride/{color}/{z}/{x}/{y}{res}.png?v=19";

// Proxy requests from /kind/color/z/x/y(?@2x).png to baseUrl
async function handleTileProxyRequest(request) {
  const url = new URL(request.url);

  const match = url.pathname.match(
    new RegExp("(personal|global)/(\\w+)/(\\d+)/(\\d+)/(\\d+)(@2x)?.png")
  );
  if (match === null) {
    return new Response("invalid url, expected: /kind/color/z/x/y.png", {
      status: 400,
    });
  }

  const [_, kind, color, z, x, y, res] = match;
  const data = {
    strava_id: Env.STRAVA_ID,
    color,
    x,
    y,
    z,
    res: res || "",
  };

  const baseUrl = kind === "personal" ? PERSONAL_MAP_URL : GLOBAL_MAP_URL;
  // replace templated data in base URL
  const proxyUrl = baseUrl.replace(/\{(\w+)\}/g, (_, key) => data[key]);

  const cookies =
    `_strava4_session=${Env.STRAVA_SESSION}` +
    `; CloudFront-Key-Pair-Id=${Env.CF_ID}` +
    `; CloudFront-Policy=${Env.CF_POLICY}` +
    `; CloudFront-Signature=${Env.CF_SIG}`;

  const proxiedRequest = new Request(proxyUrl, {
    method: "GET",
    headers: new Headers({ Cookie: cookies }),
  });

  return await fetch(proxiedRequest);
}
