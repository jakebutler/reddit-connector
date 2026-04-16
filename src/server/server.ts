import { createServer } from "@devvit/web/server";
// @ts-ignore — reddit is present at runtime but missing from .d.ts in 0.12.19
import { reddit as _reddit } from "@devvit/web/server";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Type shim for reddit client ─────────────────────────────────────────────
interface RedditPost {
  permalink: string;
  title: string;
  selftext: string;
  score: number;
  numComments: number;
  createdAt: string | Date;
}
interface RedditClient {
  getHotPosts(opts: {
    subredditName: string;
    limit: number;
  }): Promise<RedditPost[]>;
}
const reddit = _reddit as unknown as RedditClient;

// ─── Configuration ────────────────────────────────────────────────────────────
const INGEST_URL = "https://thelowerdb.com/api/digest/reddit-ingest";
const INGEST_SECRET = process.env.INGEST_SECRET ?? "";
const SUBREDDITS = ["Mounjaro", "Ozempic", "Zepbound", "GLP1_Drugs", "loseit"];
const POSTS_PER_SUB = 25;
const JOB_NAME = "glp1_weekly_ingest";

if (!INGEST_SECRET) {
  console.error(
    "[glp1] INGEST_SECRET is not set. Run: devvit env set INGEST_SECRET <value>",
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface PostPayload {
  permalink: string;
  title: string;
  selftext: string;
  ups: number;
  num_comments: number;
  created_utc: number;
}

// ─── Core ingest logic ────────────────────────────────────────────────────────
async function ingestSubreddit(subreddit: string): Promise<void> {
  console.log(`[glp1] Fetching r/${subreddit}...`);

  let posts: PostPayload[] = [];

  try {
    const listing = await reddit.getHotPosts({
      subredditName: subreddit,
      limit: POSTS_PER_SUB,
    });

    posts = listing.map((post) => ({
      permalink: post.permalink,
      title: post.title,
      selftext: post.selftext ?? "",
      ups: post.score,
      num_comments: post.numComments,
      created_utc: Math.floor(new Date(post.createdAt).getTime() / 1000),
    }));
  } catch (err) {
    console.error(`[glp1] Failed to fetch r/${subreddit}:`, err);
    return;
  }

  if (posts.length === 0) {
    console.log(`[glp1] No posts for r/${subreddit}, skipping.`);
    return;
  }

  console.log(`[glp1] Sending ${posts.length} posts from r/${subreddit}...`);

  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Digest-Reddit-Ingest-Secret": INGEST_SECRET,
      },
      body: JSON.stringify({ subreddit, posts }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[glp1] Ingest error for r/${subreddit}: ${res.status} — ${body}`,
      );
    } else {
      console.log(`[glp1] ✓ r/${subreddit} done (${posts.length} posts).`);
    }
  } catch (err) {
    console.error(`[glp1] Fetch failed for r/${subreddit}:`, err);
  }
}

// ─── Job handler ──────────────────────────────────────────────────────────────
async function weeklyIngestHandler(): Promise<void> {
  console.log("[glp1] Weekly ingest job running.");
  for (const sub of SUBREDDITS) {
    await ingestSubreddit(sub);
  }
  console.log("[glp1] Weekly ingest job complete.");
}

// ─── Helper: read full body from IncomingMessage ──────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";

    // ── Health check ──
    if (req.method === "GET" && url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", app: "glp1-reddit-monitor" }));
      return;
    }

    // ── Cron: weekly ingest ──
    if (req.method === "POST" && url === "/internal/cron/glp1-weekly-ingest") {
      try {
        await weeklyIngestHandler();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      } catch (err) {
        console.error("[glp1] Error handling cron request:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
      return;
    }

    // ── 404 fallback ──
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  },
);

// Cron schedule is declared in devvit.json → scheduler.tasks.glp1_weekly_ingest.
// Devvit routes the firing directly to POST /internal/cron/glp1-weekly-ingest.
// No runtime registration needed.

export default server;
