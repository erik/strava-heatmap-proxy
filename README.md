# strava-heatmap-proxy

This is a simple [Cloudflare Worker](https://workers.dev) allowing
unauthenticated access to personal and global Strava heatmaps.

Note: you **will** need to be a Strava premium subscriber to use this.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/erik/strava-heatmap-proxy)

## Setup

While logged in on Strava desktop, use devtools to find values for
each cookie. Then use
[wrangler](https://developers.cloudflare.com/workers/cli-wrangler/commands#put)
to store these as secrets in your Worker.

| Cookie                   | Secret           |
|--------------------------|------------------|
| `ajs_user_id`            | `STRAVA_ID`      |
| `_strava4_session`       | `STRAVA_SESSION` |
| `CloudFront-Key-Pair-Id` | `CF_ID`          |
| `CloudFront-Policy`      | `CF_POLICY`      |
| `CloudFront-Signature`   | `CF_SIG`         |
