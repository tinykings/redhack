import { CONFIG, NotLoggedInError, fetchReddit, fetchHackerNews, interleave } from "./sources.js";

const CACHE_KEY = "feedCache";
const CACHE_TTL_MS = 15 * 60 * 1000;

const $feed = document.getElementById("feed");
const $status = document.getElementById("status");
const $notice = document.getElementById("notice");
const $refresh = document.getElementById("refresh");

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
  $feed.replaceChildren(
    ...posts.map((p) => {
      const domain = new URL(p.url).hostname.replace(/^www\./, "");
      const isDiscussion = p.url === p.commentsUrl;
      return el(
        "li",
        { className: p.source },
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
    })
  );
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

$refresh.addEventListener("click", () => load({ force: true }));
load();
