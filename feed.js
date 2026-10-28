import { CONFIG, NotLoggedInError, fetchReddit, fetchHackerNews, interleave, markSeen } from "./sources.js";

const CACHE_KEY = "feedCache";
const SEEN_KEY = "seenPosts";
const CACHE_TTL_MS = 15 * 60 * 1000;

const $feeds = {
  reddit: document.getElementById("reddit-feed"),
  hn: document.getElementById("hn-feed"),
};
const $status = document.getElementById("status");
const $notice = document.getElementById("notice");
const $refresh = document.getElementById("refresh");
const $redditSort = document.getElementById("reddit-sort");
const $redditTimeframe = document.getElementById("reddit-timeframe");
const REDDIT_OPTIONS_KEY = "redditOptions";
let redditOptions = { sort: "best", timeframe: CONFIG.redditTimeWindow };
try {
  const saved = JSON.parse(localStorage.getItem(REDDIT_OPTIONS_KEY));
  if (["best", "top", "new"].includes(saved?.sort)) redditOptions.sort = saved.sort;
  if (["hour", "day", "week", "month", "year", "all"].includes(saved?.timeframe)) redditOptions.timeframe = saved.timeframe;
} catch { /* Keep defaults when storage is unavailable or invalid. */ }
$redditSort.value = redditOptions.sort;
$redditTimeframe.value = redditOptions.timeframe;
$redditTimeframe.hidden = redditOptions.sort !== "top";
let loadVersion = 0;

const VIEW_KEY = "feedView";
let savedView = {};
try {
  savedView = JSON.parse(localStorage.getItem(VIEW_KEY)) ?? {};
} catch { /* Storage may be unavailable or invalid. */ }
const currentPostIds = {};
const pendingScroll = {};
for (const source of Object.keys($feeds)) {
  const saved = savedView[source];
  currentPostIds[source] = typeof saved?.postId === "string" ? saved.postId : null;
  pendingScroll[source] = Number.isFinite(saved?.scrollTop) ? Math.max(0, saved.scrollTop) : 0;
}
let activeSource = null;
let saveTimer;

function saveView() {
  const view = {};
  for (const [source, feed] of Object.entries($feeds)) {
    view[source] = { postId: currentPostIds[source], scrollTop: pendingScroll[source] ?? feed.scrollTop };
  }
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* Keep browsing without persistence. */ }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveView, 150);
}

function restoreScroll(source) {
  if (pendingScroll[source] !== null) $feeds[source].scrollTop = pendingScroll[source];
}

for (const column of document.querySelectorAll(".feed-column")) {
  const source = column.dataset.source;
  const feed = $feeds[source];
  column.addEventListener("pointerenter", () => {
    activeSource = source;
    column.classList.add("active-column");
  });
  column.addEventListener("pointerleave", () => {
    activeSource = null;
    column.classList.remove("active-column");
  });
  // Stop delayed image restoration as soon as the user takes control.
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    feed.addEventListener(type, () => { pendingScroll[source] = null; }, { passive: true });
  }
  feed.addEventListener("scroll", scheduleSave, { passive: true });
}
window.addEventListener("pagehide", saveView);

function navigatePosts(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || event.isComposing || !["j", "k", "Enter", "c"].includes(event.key)) return;
  if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;

  if (event.key === "Enter" && event.target.closest("a, button, summary, [role='button']")) return;
  if (!activeSource) return;
  const source = activeSource;
  const feed = $feeds[source];
  const cards = Array.from(feed.children);
  if (!cards.length) return;
  const current = cards.findIndex((card) => card.dataset.postId === currentPostIds[source]);
  if (event.key === "Enter" || event.key === "c") {
    if (current < 0 || event.repeat) return;
    event.preventDefault();
    const card = cards[current];
    window.open(event.key === "c" ? card.dataset.commentsUrl : card.dataset.url, "_blank", "noopener,noreferrer");
    return;
  }
  event.preventDefault();
  pendingScroll[source] = null;
  const next = current < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, current + (event.key === "j" ? 1 : -1)));
  const card = cards[next];
  for (const item of cards) item.classList.toggle("current", item === card);
  currentPostIds[source] = card.dataset.postId;
  card.focus({ preventScroll: true });
  feed.scrollTo({
    top: feed.scrollTop + card.getBoundingClientRect().top - feed.getBoundingClientRect().top - feed.clientTop - 6,
    behavior: "instant",
  });
  scheduleSave();
}

function timeAgo(unixSeconds) {
  const s = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function compact(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render(posts) {
  for (const [source, feed] of Object.entries($feeds)) {
    pendingScroll[source] ??= feed.scrollTop;
    const sourcePosts = posts.filter((p) => p.source === source);
    // Posts shown by an earlier refresh drop below the new ones.
    const ordered = [...sourcePosts.filter((p) => !p.seen), ...sourcePosts.filter((p) => p.seen)];
    feed.replaceChildren(...ordered.map((p) => {
      const domain = new URL(p.url).hostname.replace(/^www\./, "");
      const isDiscussion = p.url === p.commentsUrl;
      let preview = "";
      if (p.image) {
        const image = el("img", {
          src: p.image,
          alt: "",
          loading: "lazy",
          decoding: "async",
          referrerPolicy: "no-referrer",
        });
        preview = el("a", {
          className: "preview",
          href: p.url,
          "ariaLabel": `View image: ${p.title}`,
        }, image);
        image.addEventListener("load", () => restoreScroll(source), { once: true });
        image.addEventListener("error", () => {
          preview.remove();
          restoreScroll(source);
        }, { once: true });
      }
      const card = el(
        "li",
        {
          className: `${p.source}${p.seen ? " seen" : ""}${p.id === currentPostIds[source] ? " current" : ""}`,
          tabIndex: -1,
        },
        preview,
        el("a", { className: "title", href: p.url, textContent: p.title }),
        isDiscussion ? "" : el("span", { className: "domain", textContent: domain }),
        el(
          "div",
          { className: "meta" },
          el("span", { className: "src", textContent: p.label }),
          ` · ${compact(p.score)} points · `,
          el("a", { href: p.commentsUrl, textContent: `${compact(p.comments)} comments` }),
          ` · ${timeAgo(p.created)}`
        )
      );
      card.dataset.postId = p.id;
      card.dataset.url = p.url;
      card.dataset.commentsUrl = p.commentsUrl;
      return card;
    }));
    restoreScroll(source);
  }
}

function showNotice(...content) {
  $notice.replaceChildren(...content);
  $notice.hidden = false;
}

async function load({ force = false } = {}) {
  const version = ++loadVersion;
  const options = { ...redditOptions };
  const redditCacheKey = options.sort === "top" ? `top:${options.timeframe}` : options.sort;
  $notice.hidden = true;
  const { [CACHE_KEY]: storedCache } = await chrome.storage.local.get(CACHE_KEY);
  if (version !== loadVersion) return;
  const cache = storedCache?.redditCacheKey === redditCacheKey ? storedCache : null;
  if (cache) render(cache.posts);
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    $status.textContent = `Updated ${timeAgo(cache.fetchedAt / 1000)}`;
    $refresh.disabled = false;
    return;
  }

  $refresh.disabled = true;
  $status.textContent = "Loading…";

  // Ask each source for the full total so either can fill in if the other comes up short.
  const [reddit, hn] = await Promise.allSettled([
    fetchReddit(CONFIG.totalItems, options),
    fetchHackerNews(CONFIG.totalItems),
  ]);

  if (version !== loadVersion) return;

  if (reddit.status === "rejected") {
    console.error("Reddit fetch failed:", reddit.reason);
    if (reddit.reason instanceof NotLoggedInError) {
      showNotice(
        "Couldn't read your Reddit subscriptions. Make sure you're ",
        el("a", { href: "https://www.reddit.com/login", textContent: "logged in to Reddit" }),
        " in this browser, then refresh."
      );
    } else {
      showNotice(`Reddit failed: ${reddit.reason.message}`);
    }
  }
  if (hn.status === "rejected") console.error("Hacker News fetch failed:", hn.reason);

  const { [SEEN_KEY]: storedSeen } = await chrome.storage.local.get(SEEN_KEY);
  if (version !== loadVersion) return;
  const { posts, seen } = markSeen(interleave(
    reddit.status === "fulfilled" ? reddit.value : [],
    hn.status === "fulfilled" ? hn.value : [],
    CONFIG.totalItems
  ), storedSeen);
  await chrome.storage.local.set({ [SEEN_KEY]: seen });

  // Only replace a good cache when both sources came back.
  if (reddit.status === "fulfilled" && hn.status === "fulfilled") {
    await chrome.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), redditCacheKey, posts } });
  }
  if (version !== loadVersion) return;
  if (posts.length || !cache) render(posts);

  const counts = { reddit: 0, hn: 0 };
  for (const p of posts) counts[p.source]++;
  $status.textContent = `${counts.reddit} Reddit · ${counts.hn} HN · just now`;
  $refresh.disabled = false;
}

function changeRedditOptions() {
  redditOptions = { sort: $redditSort.value, timeframe: $redditTimeframe.value };
  $redditTimeframe.hidden = redditOptions.sort !== "top";
  try { localStorage.setItem(REDDIT_OPTIONS_KEY, JSON.stringify(redditOptions)); } catch { /* Keep browsing. */ }
  currentPostIds.reddit = null;
  pendingScroll.reddit = 0;
  $feeds.reddit.replaceChildren();
  restoreScroll("reddit");
  scheduleSave();
  load();
}

$redditSort.addEventListener("change", changeRedditOptions);
$redditTimeframe.addEventListener("change", changeRedditOptions);
document.addEventListener("keydown", navigatePosts);
$refresh.addEventListener("click", () => load({ force: true }));
load();
