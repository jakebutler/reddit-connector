# Reddit Connector

A [Devvit](https://developers.reddit.com/) server app that ingests hot posts from GLP-1 patient communities on Reddit and pushes them to [The Lower DB](https://thelowerdb.com) weekly digest pipeline.

Runs as a scheduled cron job every Monday at 9 AM UTC. For each monitored subreddit, it fetches the top 25 hot posts via the Reddit API and POSTs them to the Lower DB ingest endpoint, where they're cached in Convex and used to generate the weekly digest instead of the fragile public Reddit JSON API.

## Monitored subreddits

- r/Mounjaro
- r/Ozempic
- r/Zepbound
- r/GLP1_Drugs
- r/loseit

To change this list, update the `SUBREDDITS` array in `src/server/server.ts` and redeploy (`npm run deploy`). The list is baked into the bundle at deploy time — there's no hot-reload.

## How it works

```
Devvit cron (Monday 9 AM UTC)
  → POST /internal/cron/glp1-weekly-ingest  (Devvit routes this internally)
    → fetch top 25 hot posts per subreddit via Reddit API
      → POST https://thelowerdb.com/api/digest/reddit-ingest  (once per subreddit)
        → Convex stores posts in digestRedditIngestCache
          → Lower DB weekly digest reads from cache instead of public reddit.com JSON
```

Authentication uses a shared secret (`INGEST_SECRET` / `DIGEST_REDDIT_INGEST_SECRET`) sent as the `X-Digest-Reddit-Ingest-Secret` request header.

## Prerequisites

- Node.js ≥ 22.6.0
- A Reddit account connected to the [Devvit developer platform](https://developers.reddit.com/)
- The `devvit` CLI (installed as a project dependency — no global install needed)

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

The secret must match the `DIGEST_REDDIT_INGEST_SECRET` environment variable set in the Lower DB deployment.

```bash
npx devvit env set INGEST_SECRET <your-secret>
```

### 4. Deploy

```bash
npm run deploy
```

This builds the server bundle and uploads it to Devvit. The cron job is registered automatically from `devvit.json` — no manual scheduling step is needed.

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile `src/server/` → `dist/server/index.js` via esbuild |
| `npm run deploy` | Build then upload to Devvit (`devvit upload`) |
| `npm run dev` | Live playtest in a subreddit (`devvit playtest`) |
| `npm run type-check` | TypeScript type check |

## Project structure

```
src/server/server.ts   — server logic: cron handler, Reddit fetch, ingest POST
src/server/index.ts    — re-exports server as default
tools/build.ts         — esbuild script
devvit.json            — Devvit app config: server entry, permissions, cron schedule
```

## Configuration reference

| Value | Where it lives | Notes |
|---|---|---|
| Monitored subreddits | `SUBREDDITS` in `server.ts` | Requires redeploy after changes |
| Ingest URL | `INGEST_URL` in `server.ts` | Points to Lower DB `/api/digest/reddit-ingest` |
| Ingest secret | Devvit env var `INGEST_SECRET` | Set with `devvit env set`; never commit this value |
| Cron schedule | `devvit.json` → `scheduler.tasks` | Currently `0 9 * * 1` (Monday 9 AM UTC) |
| HTTP allowlist | `devvit.json` → `permissions.http.domains` | Must include the Lower DB domain |

## License

BSD-3-Clause — see [LICENSE](./LICENSE).
