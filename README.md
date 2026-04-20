# Reddit Connector

A native Devvit app that ingests hot posts from GLP-1 patient communities on Reddit and pushes them to [The Lower DB](https://thelowerdb.com) digest pipeline.

The app runs a daily scheduled job at 9 AM UTC. It also exposes a moderator-only subreddit menu action, `Run GLP-1 ingest`, for testing or an initial fetch. Both paths run the same ingest logic.

## Monitored subreddits

- r/Mounjaro
- r/Ozempic
- r/Zepbound
- r/GLP1_Drugs
- r/loseit

To change this list, update the `SUBREDDITS` array in [`src/main.ts`](./src/main.ts) and redeploy.

## How it works

```text
AppInstall / AppUpgrade
  -> idempotently refreshes native Devvit cron: 0 9 * * *

Daily cron or moderator menu action
  -> fetch top 25 hot posts per subreddit via Reddit API
    -> fallback to subreddit JSON if Reddit API post construction fails on malformed items
    -> POST https://thelowerdb.com/api/digest/reddit-ingest
      -> Lower DB stores posts for downstream digest generation
```

Authentication uses the shared secret stored in Devvit app settings as `ingestSecret`. That secret is forwarded to Lower DB as the `X-Digest-Reddit-Ingest-Secret` header.

## Prerequisites

- Node.js >= 22.6.0
- A Reddit account connected to the [Devvit developer platform](https://developers.reddit.com/)
- The `devvit` CLI

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to Devvit

```bash
npm run login
```

### 3. Set the ingest secret

The secret must match the `DIGEST_REDDIT_INGEST_SECRET` environment variable in the Lower DB deployment.

```bash
devvit settings set ingestSecret
```

### 4. Deploy

```bash
npm run deploy
```

This runs a type-check and uploads the app to Devvit.

## Fetch Domains

The following domains are requested for this app:

- `thelowerdb.com` - server-side POST target for the ingest pipeline
- `reddit.com` and `www.reddit.com` - fallback read path for subreddit JSON when Devvit post construction fails on malformed Reddit objects

Reddit also expects this **Fetch Domains** justification in the README for reviewers; see the [HTTP Fetch policy](https://developers.reddit.com/docs/capabilities/server/http-fetch-policy) documentation.

## Privacy Policy and Terms of Use (required for HTTP Fetch)

Any Devvit app that uses `fetch` must provide **Terms** and a **Privacy Policy**, and the **links must be saved in the Devvit app details form** (for example under **About this app**), not only in this repo. Reddit’s docs describe this under **Terms and conditions** on the [HTTP Fetch](https://developers.reddit.com/docs/capabilities/server/http-fetch) page; the [Devvit Rules](https://developers.reddit.com/docs/devvit_rules) also require links in the app when using HTTP Fetch or collecting personal information.

**GLP-1 Monitor** — published legal pages (this repo’s [GitHub Pages](https://pages.github.com/) site, deployed from the repository root):

- **Privacy Policy:** https://jakebutler.github.io/reddit-connector/privacy-policy.html
- **Terms of Use:** https://jakebutler.github.io/reddit-connector/terms-of-use.html

### Resubmitting domain exceptions after a rejection

1. **Add both URLs** to your app in the Reddit developer portal (**Privacy Policy** + **Terms of Service** / **Terms of Use** fields). Links to Reddit’s own legal documents are not accepted as a substitute for your app’s documents.
2. **Confirm the pages return 200** in a private/incognito window (GitHub Pages finished building).
3. **Upload or playtest again** — domain allowlist entries from `devvit.json` are **submitted for review when you playtest or upload** the app. After updating app details, run `npm run deploy` (or `devvit upload`) and/or start a playtest so `thelowerdb.com`, `reddit.com`, and `www.reddit.com` go back into review.

## Manual testing

Open the playtest subreddit URL and use the subreddit header `...` menu:

- `Run GLP-1 ingest`

The menu action queues a one-off native Devvit scheduler job, so it exercises the same runtime as the daily scheduled job.

## Logs

Monitor logs with:

```bash
devvit logs glp1_monitor_dev glp1-monitor --show-timestamps
```

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Type-check the app |
| `npm run deploy` | Type-check then upload to Devvit |
| `npm run dev` | Start Devvit playtest |
| `npm run type-check` | Run TypeScript type-check |

## Project structure

```text
src/main.ts     - native Devvit entrypoint: triggers, scheduler jobs, menu item, ingest logic
devvit.json     - app config: blocks entry, permissions, settings, playtest subreddit
```

## Configuration reference

| Value | Where it lives | Notes |
|---|---|---|
| Monitored subreddits | `SUBREDDITS` in `src/main.ts` | Requires redeploy after changes |
| Ingest URL | `INGEST_URL` in `src/main.ts` | Points to Lower DB `/api/digest/reddit-ingest` |
| Ingest secret | Devvit app setting `ingestSecret` | Set with `devvit settings set ingestSecret`; stored encrypted by Devvit |
| Daily cron | `DAILY_CRON` in `src/main.ts` | `0 9 * * *`, re-registered idempotently on install and upgrade |
| Manual trigger | `Devvit.addMenuItem(...)` in `src/main.ts` | Moderator-only subreddit menu action |
| Fetch domains | `permissions.http.domains` in `devvit.json` and `Devvit.configure(...)` in `src/main.ts` | `reddit.com`, `www.reddit.com`, `thelowerdb.com` |

## License

BSD-3-Clause — see [LICENSE](./LICENSE).
