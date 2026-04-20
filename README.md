# strava-heatmap-proxy

This is a simple [Cloudflare Worker](https://workers.dev) allowing
unauthenticated access to personal and global Strava heatmaps. If you want to
use your personal Strava heatmap in Gaia or Locus, this will give you a URL that
you can use for that.

Note: you **will** need to be a Strava premium subscriber to use the personal
heatmap, while the global heatmaps are available to all Strava accounts.
Personal use only, please. Strava will ratelimit you.

# Usage

If you want to use these heatmaps as a tile layer in another app, here are the
template URLs to use:

- Personal: `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/personal/orange/all/{zoom}/{x}/{y}@2x.png`
- Global: `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/global/orange/all/{zoom}/{x}/{y}@2x.png`

Check `https://strava-heatmap-proxy.YOUR_NAMESPACE.workers.dev/` for full list
of supported tile colors, activities, and sizes.

# Deploying the proxy

Requirements:

- [wrangler](https://github.com/cloudflare/wrangler) to manage Worker
  deployments
- [deno](https://deno.land) to run Strava authentication script

### Strava Credentials

Strava's API doesn't support heatmap access directly, so we'll need to
log in with an email and password and grab session cookies for authentication.

In short:

1. Open https://strava.com/maps in your browser
2. Using devtools, look for a network request for a tile (it'll be something
   like `https://content-a.strava.com/identified/globalheat/...`)
3. Find the cookies sent to the server with that request. It'll look like this:
   `_strava4_session=...;_strava_CloudFront-Expires=;CloudFront-Key-Pair-Id=...;CloudFront-Policy=...;CloudFront-Signature=...;_strava_idcf=...`

There are some [browser
extensions](https://wiki.openstreetmap.org/wiki/Strava#Global_Heatmap_in_High_Resolution)
which can help automate this over time.

Lastly, we also need to grab your account id. You can find this by clicking on
"My Profile" on the Strava website and taking note of the URL:
`https://www.strava.com/athletes/{strava_id}`.

Now that we have these values, let's store them as Worker secrets.

```console
$ wrangler login
$ echo "1234" | wrangler secret put STRAVA_ID
$ echo "_strava4_session=..." | wrangler secret put STRAVA_COOKIES
```

Check that everything's working by running `wrangler dev`.

Here's an example tile URL with some data:
[/global/mobileblue/all/11/351/817@2x.png](http://127.0.0.1:8787/global/mobileblue/all/11/351/817@2x.png)
(Downtown Los Angeles)

When you're all set, use `wrangler publish` to bring the site live on
`strava-heatmap-proxy.YOUR-NAMESPACE.workers.dev`

Heads up, your credentials will expire after a few weeks, considering creating
a periodic task to refresh them every 7 days or so.

## (optional) GitHub Actions

Start by forking this repository and setting up some GitHub secrets
(`github.com/you/strava-heatmap-proxy/settings/secrets/actions`).

- [`CF_ACCOUNT_ID`](https://developers.cloudflare.com/fundamentals/get-started/basic-tasks/find-account-and-zone-ids/)
- [`CF_API_TOKEN`](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

These secrets will be used by GitHub Actions:

1. [deploy.yml](.github/workflows/deploy.yml): Deploy to Cloudflare on every
   commit to `main`.

Trigger the action for your first deploy, and you should be good to
go. Your site should now be live on
`strava-heatmap-proxy.YOUR-NAMESPACE.workers.dev`.
