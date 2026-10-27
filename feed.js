import { CONFIG, NotLoggedInError, fetchReddit, fetchHackerNews, interleave } from "./sources.js";

const CACHE_KEY = "feedCache";
const CACHE_TTL_MS = 15 * 60 * 1000;

const $feeds = {
  reddit: document.getElementById("reddit-feed"),
  hn: document.getElementById("hn-feed"),
};
const $status = document.getElementById("status");
const $notice = document.getElementById("notice");
const $refresh = document.getElementById("refresh");
const currentPostIds = { reddit: null, hn: null };
let activeSource = null;

for (const column of document.querySelectorAll(".feed-column")) {
  column.addEventListener("pointerenter", () => { activeSource = column.dataset.source; });
  column.addEventListener("pointerleave", () => { activeSource = null; });
}

function navigatePosts(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || event.isComposing || !["j", "k"].includes(event.key)) return;
  if (event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;

  if (!activeSource) return;
  const source = activeSource;
  const feed = $feeds[source];
  const cards = Array.from(feed.children);
  if (!cards.length) return;
  event.preventDefault();

  const current = cards.findIndex((card) => card.dataset.postId === currentPostIds[source]);
  const next = current < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, current + (event.key === "j" ? 1 : -1)));
  const card = cards[next];
  for (const item of cards) item.classList.toggle("current", item === card);
  currentPostIds[source] = card.dataset.postId;
  card.focus({ preventScroll: true });
  feed.scrollTo({
    top: feed.scrollTop + card.getBoundingClientRect().top - feed.getBoundingClientRect().top - feed.clientTop - 6,
    behavior: "instant",
  });
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
    feed.replaceChildren(...posts.filter((p) => p.source === source).map((p) => {
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
        image.addEventListener("error", () => preview.remove(), { once: true });
      }
      const card = el(
        "li",
        { className: `${p.source}${p.id === currentPostIds[source] ? " current" : ""}`, tabIndex: -1 },
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
      return card;
    }));
  }
}

function showNotice(...content) {
  $notice.replaceChildren(...content);
  $notice.hidden = false;
}

async function load({ force = false } = {}) {
  $notice.hidden = true;
  const { [CACHE_KEY]: cache } = await chrome.storage.local.get(CACHE_KEY);
  if (cache) render(cache.posts);
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    $status.textContent = `Updated ${timeAgo(cache.fetchedAt / 1000)}`;
    return;
  }

  $refresh.disabled = true;
  $status.textContent = "Loading…";

  // Ask each source for the full total so either can fill in if the other comes up short.
  const [reddit, hn] = await Promise.allSettled([
    fetchReddit(CONFIG.totalItems),
    fetchHackerNews(CONFIG.totalItems),
  ]);

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

  const posts = interleave(
    reddit.status === "fulfilled" ? reddit.value : [],
    hn.status === "fulfilled" ? hn.value : [],
    CONFIG.totalItems
  );

  // Only replace a good cache when both sources came back.
  if (reddit.status === "fulfilled" && hn.status === "fulfilled") {
    await chrome.storage.local.set({ [CACHE_KEY]: { fetchedAt: Date.now(), posts } });
  }
  if (posts.length || !cache) render(posts);

  const counts = { reddit: 0, hn: 0 };
  for (const p of posts) counts[p.source]++;
  $status.textContent = `${counts.reddit} Reddit · ${counts.hn} HN · just now`;
  $refresh.disabled = false;
}

document.addEventListener("keydown", navigatePosts);
$refresh.addEventListener("click", () => load({ force: true }));
load();
