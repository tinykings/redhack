// Fetching and normalizing posts from Reddit and Hacker News.
// Every post is normalized to:
//   { source, id, title, url, commentsUrl, score, comments, created, label, image? }
// markSeen() adds `seen: true|false`.

export const CONFIG = {
  totalItems: 100,
  redditTimeWindow: "day", // hour | day | week | month | year | all
  maxPerSubreddit: 5, // keeps huge subs from crowding out small ones
  subsPerRequest: 50, // subreddits combined into one r/a+b+c request
  seenHistory: 2000, // post ids remembered per source for marking repeats
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

function imageUrl(value) {
  if (typeof value !== "string") return null;
  const decoded = value.replace(/&amp;/g, "&");
  try {
    const url = new URL(decoded);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function redditImage(post) {
  const preview = post.preview?.images?.[0];
  const galleryId = post.gallery_data?.items?.[0]?.media_id;
  const gallery = post.media_metadata?.[galleryId];
  const resolutions = preview?.resolutions ?? gallery?.p ?? [];
  const sized = resolutions.find((image) => image.width >= 640 || image.x >= 640)
    ?? resolutions[resolutions.length - 1];
  const direct = post.url_overridden_by_dest ?? post.url;
  return imageUrl(sized?.url ?? sized?.u)
    ?? imageUrl(preview?.source?.url)
    ?? imageUrl(gallery?.s?.u)
    ?? (/\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(direct ?? "") ? imageUrl(direct) : null)
    ?? (post.crosspost_parent_list?.[0] ? redditImage(post.crosspost_parent_list[0]) : null)
    ?? imageUrl(post.thumbnail);
}

export async function fetchReddit(limit, { sort = "best", timeframe = CONFIG.redditTimeWindow } = {}) {
  if (!["best", "top", "new"].includes(sort)) throw new Error("Invalid Reddit sort");
  if (!["hour", "day", "week", "month", "year", "all"].includes(timeframe)) throw new Error("Invalid Reddit timeframe");
  const subs = await getSubscriptions();

  const chunks = [];
  for (let i = 0; i < subs.length; i += CONFIG.subsPerRequest) {
    chunks.push(subs.slice(i, i + CONFIG.subsPerRequest));
  }

  const params = new URLSearchParams({ limit: "100", raw_json: "1" });
  if (sort === "top") params.set("t", timeframe);
  // Best is Reddit's personalized home ranking, not a subreddit listing sort.
  const urls = sort === "best"
    ? [`${REDDIT}/best.json?${params}`]
    : chunks.map((chunk) => `${REDDIT}/r/${chunk.join("+")}/${sort}.json?${params}`);
  const listings = await Promise.all(urls.map(getJson));

  const posts = listings
    .flatMap((l) => l.data.children.map((c) => c.data))
    .filter((p) => !p.stickied && !p.over_18);
  if (sort === "top") posts.sort((a, b) => b.score - a.score);
  if (sort === "new") posts.sort((a, b) => b.created_utc - a.created_utc);

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
      image: redditImage(p),
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

// Flags posts already shown by an earlier fetch, then records this fetch's ids.
// `seen` maps each source to its ids, oldest first, capped at `max` per source.
export function markSeen(posts, seen = {}, max = CONFIG.seenHistory) {
  const updated = {};
  for (const [source, ids] of Object.entries(seen ?? {})) {
    if (Array.isArray(ids)) updated[source] = ids;
  }
  const previous = Object.fromEntries(Object.entries(updated).map(([source, ids]) => [source, new Set(ids)]));
  const marked = posts.map((p) => ({ ...p, seen: previous[p.source]?.has(p.id) ?? false }));
  for (const source of new Set(posts.map((p) => p.source))) {
    const current = posts.filter((p) => p.source === source).map((p) => p.id);
    const currentSet = new Set(current);
    updated[source] = [...(updated[source] ?? []).filter((id) => !currentSet.has(id)), ...current].slice(-max);
  }
  return { posts: marked, seen: updated };
}
