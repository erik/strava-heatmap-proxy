#!/usr/bin/env -S deno run --allow-net --allow-env
//
// Log a user into Strava and write the cookies to stdout for later use.

const STRAVA_EMAIL = Deno.env.get("STRAVA_EMAIL")!;
const STRAVA_PASSWORD = Deno.env.get("STRAVA_PASSWORD")!;

function getCookies(res: Response): Array<string> {
  const cookies = [];
  for (const [k, v] of res.headers) {
    if (k === "set-cookie") {
      const stripped = v.match(/^([^;]+);/);
      stripped !== null && cookies.push(stripped[1]);
    }
  }
  return cookies;
}

const loginFormResp = await fetch("https://www.strava.com/login");
const match = (await loginFormResp.text()).match(
  /name="authenticity_token" value="([^"]+)"/,
);
if (!match) {
  throw new Error("Could not acquire login form authenticity token.");
}
const authToken = match[1];
const loginCookies = getCookies(loginFormResp);

const d = new URLSearchParams();
d.set("email", STRAVA_EMAIL);
d.set("password", STRAVA_PASSWORD);
d.set("utf8", "\u2713");
d.set("plan", "");
d.set("authenticity_token", authToken);
d.set("remember_me", "on");

const sessionResp = await fetch(
  "https://www.strava.com/session",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": loginCookies.join(";"),
    },
    body: d.toString(),
    redirect: "manual",
  },
);

const sessionCookies = getCookies(sessionResp);

// This is how we grab cloudfront tokens, needed for high-res global heatmaps
const authResp = await fetch("https://heatmap-external-a.strava.com/auth", {
  headers: { "Cookie": sessionCookies.join(";") },
});

if (authResp.status !== 200) {
  throw new Error("Authentication failed.");
}

const requiredCookieNames = new Set([
  "CloudFront-Policy",
  "CloudFront-Key-Pair-Id",
  "CloudFront-Signature",
  "_strava4_session",
]);

const allCookies = getCookies(authResp).concat(sessionCookies);
const [_, stravaId] = allCookies.find((c) =>
  c.startsWith("strava_remember_id=")
)!
  .split("=", 2);

// We're limited to 1kB for CloudflareWorker Secrets, so be selective in the cookies we use
const requiredCookies = allCookies.filter((it) =>
  requiredCookieNames.has(it.split("=")[0])
);

const stravaCookies = requiredCookies.join(";");

console.log(`STRAVA_ID='${stravaId}'`);
console.log(`STRAVA_COOKIES='${stravaCookies}'`);
