import { Devvit } from "@devvit/public-api";

type ManualJobData = {
  targetId: string;
};

type RuntimeContext = Pick<
  Devvit.Context,
  "reddit" | "scheduler" | "settings"
>;

type RedditPost = {
  permalink?: string;
  title?: string;
  body?: string;
  score?: number;
  numberOfComments?: number;
  createdAt?: Date;
};

type RedditJsonPost = {
  permalink?: string;
  title?: string;
  selftext?: string;
  ups?: number;
  num_comments?: number;
  created_utc?: number;
};

type RedditJsonListing = {
  data?: {
    children?: Array<{
      data?: RedditJsonPost;
    }>;
  };
};

type PostLike = RedditPost &
  RedditJsonPost & {
    permalink?: string;
    title?: string;
  };

type PostPayload = {
  permalink: string;
  title: string;
  selftext: string;
  ups: number;
  num_comments: number;
  created_utc: number;
};

const INGEST_URL = "https://thelowerdb.com/api/digest/reddit-ingest";
const REDDIT_JSON_BASE_URL = "https://www.reddit.com";
const SUBREDDITS = ["Mounjaro", "Ozempic", "Zepbound", "GLP1_Drugs", "loseit"];
const POSTS_PER_SUB = 25;
const DAILY_JOB_NAME = "glp1_daily_ingest";
const MANUAL_JOB_NAME = "glp1_manual_ingest";
const DAILY_CRON = "0 9 * * *";
const FETCH_DOMAINS = ["reddit.com", "www.reddit.com", "thelowerdb.com"];

Devvit.configure({
  http: {
    domains: FETCH_DOMAINS,
  },
  redditAPI: true,
});

function toUnixSeconds(value: Date | number | undefined): number | null {
  if (value instanceof Date) {
    const unixSeconds = Math.floor(value.getTime() / 1000);
    return Number.isFinite(unixSeconds) ? unixSeconds : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  return null;
}

function toPostPayload(
  post: PostLike | undefined,
  subreddit: string,
  source: "reddit api" | "reddit json fallback",
): PostPayload | null {
  if (!post) {
    console.warn(`[glp1] Skipping empty post in r/${subreddit} from ${source}.`);
    return null;
  }

  const permalink = post.permalink;
  const title = post.title;
  const createdUtc = toUnixSeconds(post.createdAt ?? post.created_utc);
  const selftext = post.body ?? post.selftext ?? "";
  const ups = post.score ?? post.ups ?? 0;
  const numComments = post.numberOfComments ?? post.num_comments ?? 0;

  if (!permalink || !title || createdUtc === null) {
    console.warn(
      `[glp1] Skipping malformed post in r/${subreddit} from ${source}.`,
    );
    return null;
  }

  return {
    permalink,
    title,
    selftext,
    ups,
    num_comments: numComments,
    created_utc: createdUtc,
  };
}

async function fetchViaRedditApi(
  subreddit: string,
  context: RuntimeContext,
): Promise<PostPayload[]> {
  const listing = await context.reddit.getHotPosts({
    subredditName: subreddit,
    limit: POSTS_PER_SUB,
    pageSize: POSTS_PER_SUB,
  }).all();

  const posts: PostPayload[] = [];
  for (const post of listing as RedditPost[]) {
    const payload = toPostPayload(post, subreddit, "reddit api");
    if (payload) {
      posts.push(payload);
    }
  }

  return posts;
}

async function fetchViaRedditJson(subreddit: string): Promise<PostPayload[]> {
  const searchParams = new URLSearchParams({
    limit: String(POSTS_PER_SUB),
    raw_json: "1",
  });
  const res = await fetch(
    `${REDDIT_JSON_BASE_URL}/r/${subreddit}/hot.json?${searchParams.toString()}`,
  );

  if (!res.ok) {
    throw new Error(`Fallback fetch failed with ${res.status}.`);
  }

  const listing = (await res.json()) as RedditJsonListing;
  const children = listing.data?.children ?? [];
  const posts: PostPayload[] = [];

  for (const child of children) {
    const payload = toPostPayload(
      child.data,
      subreddit,
      "reddit json fallback",
    );
    if (payload) {
      posts.push(payload);
    }
  }

  return posts;
}

async function fetchSubredditPosts(
  subreddit: string,
  context: RuntimeContext,
): Promise<PostPayload[]> {
  try {
    return await fetchViaRedditApi(subreddit, context);
  } catch (err) {
    console.error(
      `[glp1] Native Reddit API fetch failed for r/${subreddit}; falling back to subreddit JSON.`,
      err,
    );
  }

  return await fetchViaRedditJson(subreddit);
}

async function ingestSubreddit(
  subreddit: string,
  secret: string,
  context: RuntimeContext,
): Promise<void> {
  console.log(`[glp1] Fetching r/${subreddit}...`);

  let posts: PostPayload[] = [];

  try {
    posts = await fetchSubredditPosts(subreddit, context);
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
        "X-Digest-Reddit-Ingest-Secret": secret,
      },
      body: JSON.stringify({ subreddit, posts }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[glp1] Ingest error for r/${subreddit}: ${res.status} — ${body}`,
      );
      return;
    }

    console.log(`[glp1] ✓ r/${subreddit} done (${posts.length} posts).`);
  } catch (err) {
    console.error(`[glp1] Fetch failed for r/${subreddit}:`, err);
  }
}

async function runIngestJob(
  trigger: "daily cron" | "manual",
  context: RuntimeContext,
): Promise<void> {
  const secret = await context.settings.get<string>("ingestSecret");
  if (!secret) {
    throw new Error(
      "[glp1] ingestSecret is not set. Run: devvit settings set ingestSecret",
    );
  }

  console.log(`[glp1] ${trigger} ingest job running.`);
  for (const sub of SUBREDDITS) {
    await ingestSubreddit(sub, secret, context);
  }
  console.log(`[glp1] ${trigger} ingest job complete.`);
}

async function ensureDailyCron(context: RuntimeContext): Promise<void> {
  const existingJobs = await context.scheduler.listJobs();
  let cancelledJobs = 0;

  for (const job of existingJobs) {
    if (job.name === DAILY_JOB_NAME) {
      await context.scheduler.cancelJob(job.id);
      cancelledJobs += 1;
    }
  }

  await context.scheduler.runJob({
    name: DAILY_JOB_NAME,
    cron: DAILY_CRON,
  });

  console.log(
    `[glp1] Daily cron ensured at ${DAILY_CRON}. Replaced ${cancelledJobs} existing job(s).`,
  );
}

Devvit.addTrigger({
  event: "AppInstall",
  onEvent: async (_event, context) => {
    console.log("[glp1] AppInstall received. Scheduling daily ingest cron.");
    await ensureDailyCron(context);
  },
});

Devvit.addTrigger({
  event: "AppUpgrade",
  onEvent: async (_event, context) => {
    console.log("[glp1] AppUpgrade received. Refreshing daily ingest cron.");
    await ensureDailyCron(context);
  },
});

Devvit.addSchedulerJob({
  name: DAILY_JOB_NAME,
  onRun: async (_event, context) => {
    await runIngestJob("daily cron", context);
  },
});

Devvit.addSchedulerJob<ManualJobData>({
  name: MANUAL_JOB_NAME,
  onRun: async (event, context) => {
    console.log(
      `[glp1] Manual job fired for ${event.data?.targetId ?? "unknown target"}.`,
    );
    await runIngestJob("manual", context);
  },
});

Devvit.addMenuItem({
  label: "Run GLP-1 ingest",
  description: "Manually run the Reddit ingest job",
  forUserType: "moderator",
  location: "subreddit",
  onPress: async (event, context) => {
    try {
      await context.scheduler.runJob<ManualJobData>({
        name: MANUAL_JOB_NAME,
        data: { targetId: event.targetId },
        runAt: new Date(Date.now() + 1000),
      });
      context.ui.showToast({
        text: "GLP-1 ingest queued.",
        appearance: "success",
      });
    } catch (err) {
      console.error("[glp1] Failed to queue manual ingest:", err);
      context.ui.showToast({
        text: "GLP-1 ingest failed.",
        appearance: "neutral",
      });
    }
  },
});

export default Devvit;
