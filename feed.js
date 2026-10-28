import { CONFIG, NotLoggedInError, fetchReddit, fetchHackerNews, fetchYouTube, interleave, markSeen } from "./sources.js";

const CACHE_KEY = "feedCacheV3";
const SEEN_KEY = "seenPosts";
const CACHE_TTL_MS = 15 * 60 * 1000;

const $feeds = {
  reddit: document.getElementById("reddit-feed"),
  hn: document.getElementById("hn-feed"),
  youtube: document.getElementById("youtube-feed"),
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
  // Every page load starts at the top of both lists.
  pendingScroll[source] = 0;
}
let activeSource = null;
let keyboardSource = null;
const scrollPositions = {};
let saveTimer;

function updateKeyboardFade(source = null) {
  keyboardSource = source;
  for (const [name, feed] of Object.entries($feeds)) {
    for (const card of feed.children) {
      card.classList.toggle("keyboard-dimmed", Boolean(card.dataset.postId) && source !== null
        && (name !== source || card.dataset.postId !== currentPostIds[source]));
    }
  }
}

function saveView() {
  const view = {};
  for (const source of Object.keys($feeds)) {
    view[source] = { postId: currentPostIds[source] };
  }
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* Keep browsing without persistence. */ }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveView, 150);
}

function restoreScroll(source) {
  if (pendingScroll[source] !== null) {
    $feeds[source].scrollTop = pendingScroll[source];
    scrollPositions[source] = $feeds[source].scrollTop;
  }
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
  scrollPositions[source] = feed.scrollTop;
  feed.addEventListener("scroll", () => {
    // Keyboard navigation and image restoration record their own scroll positions.
    if (feed.scrollTop !== scrollPositions[source]) {
      pendingScroll[source] = null;
      updateKeyboardFade();
    }
    scrollPositions[source] = feed.scrollTop;
  }, { passive: true });
  for (const type of ["wheel", "touchmove"]) {
    feed.addEventListener(type, () => updateKeyboardFade(), { passive: true });
  }
  // Stop delayed image restoration as soon as the user takes control.
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    feed.addEventListener(type, () => { pendingScroll[source] = null; }, { passive: true });
  }
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
  const cards = Array.from(feed.children).filter((card) => card.dataset.postId && !card.classList.contains("seen"));
  if (!cards.length) return;
  const current = cards.findIndex((card) => card.dataset.postId === currentPostIds[source]);
  if (event.key === "Enter" || event.key === "c") {
    if (current < 0 || event.repeat) return;
    event.preventDefault();
    const card = cards[current];
    if (source === "youtube" && event.key === "Enter") playVideo(card);
    else window.open(event.key === "c" ? card.dataset.commentsUrl : card.dataset.url, "_blank", "noopener,noreferrer");
    return;
  }
  event.preventDefault();
  pendingScroll[source] = null;
  const next = current < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, current + (event.key === "j" ? 1 : -1)));
  const card = cards[next];
  for (const item of cards) item.classList.toggle("current", item === card);
  currentPostIds[source] = card.dataset.postId;
  updateKeyboardFade(source);
  card.focus({ preventScroll: true });
  feed.scrollTo({
    top: feed.scrollTop + card.getBoundingClientRect().top - feed.getBoundingClientRect().top - feed.clientTop - 6,
    behavior: "instant",
  });
  scrollPositions[source] = feed.scrollTop;
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
  const node = Object.assign(document.createElement(tag),
    tag === "a" ? { target: "_blank", rel: "noopener noreferrer" } : {}, props);
  node.append(...children);
  return node;
}

let embedSetup;
async function playVideo(card, standard = false) {
  const id = card.dataset.videoId;
  if (!/^[\w-]{11}$/.test(id ?? "")) return;
  // YouTube rejects extension-origin embeds without an HTTP(S) Referer (error 153).
  // Scope this header to embeds initiated by this extension, not ordinary browsing.
  try {
    embedSetup ??= chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1, 2],
      addRules: ["www.youtube.com", "www.youtube-nocookie.com"].map((host, index) => ({
        id: index + 1, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [
          { header: "Referer", operation: "set", value: "https://www.youtube.com/" },
        ] },
        condition: {
          urlFilter: `|https://${host}/embed/`,
          resourceTypes: ["sub_frame"],
          initiatorDomains: [new URL(chrome.runtime.getURL("/")).hostname],
        },
      })),
    });
    await embedSetup;
  } catch (error) {
    embedSetup = null;
    showNotice(`Couldn't set up YouTube playback: ${error.message}. Use Open on YouTube instead.`);
    return;
  }
  if (!card.isConnected) return;
  // One active player; replacing/removing an iframe stops its audio.
  for (const player of document.querySelectorAll(".video-player")) {
    player.remove();
  }
  for (const controls of document.querySelectorAll(".video-controls")) controls.remove();
  for (const preview of document.querySelectorAll(".video-preview")) preview.hidden = false;
  const preview = card.querySelector(".video-preview");
  if (!preview) return;
  const player = el("iframe", {
    className: "video-player",
    src: `https://${standard ? "www.youtube.com" : "www.youtube-nocookie.com"}/embed/${id}?autoplay=1&rel=0`,
    title: "YouTube video player",
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
    allowFullscreen: true,
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  preview.hidden = true;
  const retry = el("button", {
    type: "button", textContent: standard ? "Try privacy player" : "Try standard player",
  });
  retry.addEventListener("click", () => playVideo(card, !standard));
  const controls = el("div", { className: "video-controls" }, retry,
    el("p", { className: "meta", textContent: "Playback error? Try the other player. Videos with embedding or account restrictions may require YouTube." }));
  preview.after(player, controls);
}

function render(posts) {
  for (const [source, feed] of Object.entries($feeds)) {
    pendingScroll[source] ??= feed.scrollTop;
    const sourcePosts = posts.filter((p) => p.source === source);
    // Posts shown by an earlier refresh drop below the new ones.
    const unseen = sourcePosts.filter((p) => !p.seen);
    const seen = sourcePosts.filter((p) => p.seen);
    const ordered = [...unseen, ...seen];
    if (!unseen.some((p) => p.id === currentPostIds[source])) currentPostIds[source] = null;
    const cards = ordered.map((p) => {
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
        preview = p.source === "youtube"
          ? el("button", { className: "preview video-preview", type: "button", ariaLabel: `Play: ${p.title}` }, image)
          : el("a", { className: "preview", href: p.url, ariaLabel: `View image: ${p.title}` }, image);
        image.addEventListener("load", () => restoreScroll(source), { once: true });
        image.addEventListener("error", () => {
          if (source === "youtube") image.remove();
          else preview.remove();
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
          p.source === "youtube" ? " · " : ` · ${compact(p.score)} points · `,
          el("a", { href: p.commentsUrl, textContent: p.source === "youtube" ? "Open on YouTube / comments" : `${compact(p.comments)} comments` }),
          p.source === "youtube" ? (p.published ? ` · ${p.published}` : "") : ` · ${timeAgo(p.created)}`
        )
      );
      if (p.source === "youtube") {
        card.dataset.videoId = p.videoId;
        if (p.image) preview.addEventListener("click", () => playVideo(card));
      }
      card.dataset.postId = p.id;
      card.dataset.url = p.url;
      card.dataset.commentsUrl = p.commentsUrl;
      return card;
    });
    if (seen.length) {
      cards.splice(unseen.length, 0, el("li", { className: "seen-divider" },
        el("hr"), el("span", { textContent: "Seen" }), el("hr")));
    }
    feed.replaceChildren(...cards);
    restoreScroll(source);
  }
  updateKeyboardFade(keyboardSource);
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
  $notice.replaceChildren();
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
  const [reddit, hn, youtube] = await Promise.allSettled([
    fetchReddit(CONFIG.totalItems, options),
    fetchHackerNews(CONFIG.totalItems),
    fetchYouTube(CONFIG.totalItems),
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
  if (hn.status === "rejected") {
    console.error("Hacker News fetch failed:", hn.reason);
    $notice.append(el("p", { textContent: `Hacker News failed: ${hn.reason.message}` }));
    $notice.hidden = false;
  }
  if (youtube.status === "rejected") {
    console.error("YouTube fetch failed:", youtube.reason);
    $notice.append(el("p", {},
      youtube.reason instanceof NotLoggedInError ? "Couldn't read your YouTube subscriptions. " : `YouTube failed: ${youtube.reason.message}. `,
      el("a", { href: "https://www.youtube.com/feed/subscriptions", textContent: "Open YouTube" }),
      " in this browser, check login and consent, then refresh. Browser cookie restrictions may prevent session access."
    ));
    $notice.hidden = false;
  }

  const { [SEEN_KEY]: storedSeen } = await chrome.storage.local.get(SEEN_KEY);
  if (version !== loadVersion) return;
  const fresh = [
    ...interleave(
      reddit.status === "fulfilled" ? reddit.value : [],
      hn.status === "fulfilled" ? hn.value : [],
      CONFIG.totalItems
    ),
    ...(youtube.status === "fulfilled" ? youtube.value : []),
  ];
  const marked = markSeen(fresh, storedSeen);
  const seen = marked.seen;
  const results = { reddit, hn, youtube };
  const posts = [...marked.posts, ...(cache?.posts ?? []).filter((p) => results[p.source]?.status === "rejected")];
  await chrome.storage.local.set({ [SEEN_KEY]: seen });

  // Partial failures retain cached cards, but must not cache a failed request as fresh.
  if (Object.values(results).every((result) => result.status === "fulfilled")) {
    await chrome.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), redditCacheKey, posts } });
  }
  if (version !== loadVersion) return;
  if (posts.length || !cache) render(posts);

  const counts = { reddit: 0, hn: 0, youtube: 0 };
  for (const p of posts) counts[p.source]++;
  $status.textContent = `${counts.reddit} Reddit · ${counts.hn} HN · ${counts.youtube} YouTube · just now`;
  $refresh.disabled = false;
}

function changeRedditOptions() {
  redditOptions = { sort: $redditSort.value, timeframe: $redditTimeframe.value };
  $redditTimeframe.hidden = redditOptions.sort !== "top";
  try { localStorage.setItem(REDDIT_OPTIONS_KEY, JSON.stringify(redditOptions)); } catch { /* Keep browsing. */ }
  updateKeyboardFade();
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
