# strava-heatmap-proxy

This is a simple [Cloudflare Worker](https://workers.dev) allowing
unauthenticated access to personal and global Strava heatmaps. If you want to
use your personal Strava heatmap in Gaia or Locus, this will give you a URL
that you can use for that.

Note: you **will** need to be a Strava premium subscriber to use this. Personal
use only, please. Strava will ratelimit you.

# Setup

Follow either of the two paths described below to deploy your Cloudflare
Worker.

If you want to use these heatmaps as a tile layer in another app, here are the
template URLs to use:

- Personal: `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/personal/orange/all/{zoom}/{x}/{y}@2x.png`
- Global: `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/global/orange/all/{zoom}/{x}/{y}@2x.png`

Check `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/` for full list
of supported tile colors.

## The easy way

Start by forking the repository and modifying `wrangler.toml` to reference your
Cloudflare account. The Deploy to Cloudflare Workers button below will do this
for you:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jpicheral/strava-heatmap-proxy)

In your forked repository, we need to set up some GitHub secrets
(`github.com/you/strava-heatmap-proxy/settings/secrets/actions`).

- `STRAVA_EMAIL`
- `STRAVA_PASSWORD`
- `CF_API_TOKEN`

These secrets will be used by two GitHub Actions:

1. [deploy.yml](.github/workflows/deploy.yml): Deploy to Cloudflare on every
   commit to `master`.
2. [credentials.yml](.github/workflows/credentials.yml): Fetch fresh Strava
   cookies once per week.

Trigger both of these actions for your first deploy, and you should be good to
go. Your site should now be live on
`strava-heatmap-proxy.YOUR-NAMESPACE.workers.dev`.

## Manual

Requirements:

  - [wrangler](https://github.com/cloudflare/wrangler) to manage Worker deployments
  - [deno](https://deno.land) to run Strava authentication script

Strava's API doesn't support this kind of access directly, so we'll need to
log in with an email and password and grab session cookies for
authentication.

This can either be done manually in the browser or via
`./scripts/refresh_strava_credentials.ts`

``` console
$ export STRAVA_EMAIL="my-strava-account@example.com"
$ export STRAVA_PASSWORD="hunter2"
$
$ ./scripts/refresh_strava_credentials.ts
STRAVA_ID=12345
STRAVA_COOKIES=...
```

Now that we have these values, let's store them as Worker secrets.
Remember to first modify `wrangler.toml` to update your `account_id`.

``` console
$ wrangler login
$ echo "1234" | wrangler secret put STRAVA_ID
$ echo "...." | wrangler secret put STRAVA_COOKIES
```

Check that everything's working by running `wrangler dev`.

Here's an example tile URL with some data:
[/global/mobileblue/11/351/817@2x.png](http://127.0.0.1:8787/global/mobileblue/11/351/817@2x.png)
(Downtown Los Angeles)

When you're all set, use `wrangler publish` to bring the site live on
`strava-heatmap-proxy.YOUR-NAMESPACE.workers.dev`

Heads up, your credentials will expire after a few weeks, considering creating
a periodic task to refresh them every 7 days or so.
