// Fetching and normalizing posts from Reddit and Hacker News.
// Every post is normalized to:
//   { source, id, title, url, commentsUrl, score, comments, created, label }

export const CONFIG = {
  totalItems: 100,
  redditTimeWindow: "day", // hour | day | week | month | year | all
  maxPerSubreddit: 5, // keeps huge subs from crowding out small ones
  subsPerRequest: 50, // subreddits combined into one r/a+b+c request
};

const REDDIT = "https://www.reddit.com";
const HN = "https://hacker-news.firebaseio.com/v0";

export class NotLoggedInError extends Error {}

async function getJson(url) {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401 || res.status === 403) {
    throw new NotLoggedInError(`${res.status} from ${new URL(url).host}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function getSubscriptions() {
  const subs = [];
  let after = null;
  do {
    const params = new URLSearchParams({ limit: "100", raw_json: "1" });
    if (after) params.set("after", after);
    const data = await getJson(`${REDDIT}/subreddits/mine/subscriber.json?${params}`);
    for (const child of data.data.children) subs.push(child.data.display_name);
    after = data.data.after;
  } while (after && subs.length < 1000);

  // Reddit answers anonymous requests with an empty listing rather than an error.
  if (subs.length === 0) throw new NotLoggedInError("no subscriptions returned");
  return subs;
}

export async function fetchReddit(limit) {
  const subs = await getSubscriptions();

  const chunks = [];
  for (let i = 0; i < subs.length; i += CONFIG.subsPerRequest) {
    chunks.push(subs.slice(i, i + CONFIG.subsPerRequest));
  }

  const listings = await Promise.all(
    chunks.map((chunk) => {
      const params = new URLSearchParams({ t: CONFIG.redditTimeWindow, limit: "100", raw_json: "1" });
      return getJson(`${REDDIT}/r/${chunk.join("+")}/top.json?${params}`);
    })
  );

  const posts = listings
    .flatMap((l) => l.data.children.map((c) => c.data))
    .filter((p) => !p.stickied && !p.over_18)
    .sort((a, b) => b.score - a.score);

  const perSub = new Map();
  const picked = [];
  for (const p of posts) {
    const n = perSub.get(p.subreddit) ?? 0;
    if (n >= CONFIG.maxPerSubreddit) continue;
    perSub.set(p.subreddit, n + 1);
    const commentsUrl = REDDIT + p.permalink;
    picked.push({
      source: "reddit",
      id: p.name,
      title: p.title,
      url: p.is_self ? commentsUrl : p.url,
      commentsUrl,
      score: p.score,
      comments: p.num_comments,
      created: p.created_utc,
      label: `r/${p.subreddit}`,
    });
    if (picked.length >= limit) break;
  }
  return picked;
}

export async function fetchHackerNews(limit) {
  const ids = await getJson(`${HN}/topstories.json`);
  const items = await Promise.all(
    ids.slice(0, limit + 10).map((id) => getJson(`${HN}/item/${id}.json`).catch(() => null))
  );
  return items
    .filter((it) => it && !it.dead && !it.deleted && it.title)
    .slice(0, limit)
    .map((it) => {
      const commentsUrl = `https://news.ycombinator.com/item?id=${it.id}`;
      return {
        source: "hn",
        id: `hn_${it.id}`,
        title: it.title,
        url: it.url || commentsUrl,
        commentsUrl,
        score: it.score ?? 0,
        comments: it.descendants ?? 0,
        created: it.time,
        label: "Hacker News",
      };
    });
}

// Alternates reddit, hn, reddit, hn... If one source runs short, the other fills the rest.
// Links that appear on both sites are kept once.
export function interleave(reddit, hn, total) {
  const out = [];
  const seenUrls = new Set();
  let r = 0;
  let h = 0;
  let turn = "reddit";
  while (out.length < total && (r < reddit.length || h < hn.length)) {
    const takeReddit = (turn === "reddit" && r < reddit.length) || h >= hn.length;
    const post = takeReddit ? reddit[r++] : hn[h++];
    if (seenUrls.has(post.url)) continue; // same source tries again with its next post
    seenUrls.add(post.url);
    turn = takeReddit ? "hn" : "reddit";
    out.push(post);
  }
  return out;
}
