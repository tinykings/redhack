import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup(savedView = null, savedOptions = null) {
  function makeFeed(prefix) {
    const feed = {
      scrollTop: 0,
      replaceChildren(...children) { this.children = children; },
      clientTop: 0,
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTo(options) { this.lastScroll = options; this.scrollTop = options.top; },
      handlers: {},
      addEventListener(type, handler) {
        const previous = this.handlers[type];
        this.handlers[type] = (...args) => { previous?.(...args); handler(...args); };
      },
      children: [0, 1, 2].map((index) => {
        const card = {
          dataset: {
            postId: `${prefix}-${index}`,
            url: `https://example.com/${prefix}/${index}`,
            commentsUrl: `https://example.com/${prefix}/${index}/comments`,
          },
          selected: false,
          focus(options) { this.focusOptions = options; },
          getBoundingClientRect: () => ({ top: 200 - feed.scrollTop }),
        };
        card.classList = {
          contains(name) { return card.className?.split(" ").includes(name) ?? false; },
          toggle(name, value) {
            if (name === "current") card.selected = value;
            if (name === "keyboard-dimmed") card.dimmed = value;
          },
        };
        return card;
      }),
    };
    return feed;
  }
  const feeds = { reddit: makeFeed("reddit"), hn: makeFeed("hn") };
  const columns = Object.keys(feeds).map((source) => ({
    dataset: { source },
    handlers: {},
    classList: {
      add() { this.active = true; },
      remove() { this.active = false; },
    },
    addEventListener(type, handler) { this.handlers[type] = handler; },
  }));
  let keyHandler;
  const stored = new Map(savedView === null ? [] : [["feedView", savedView]]);
  if (savedOptions !== null) stored.set("redditOptions", savedOptions);
  const controls = Object.fromEntries(["reddit-sort", "reddit-timeframe"].map((id) => [id, {
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
  }]));
  const windowEvents = {};
  const opened = [];
  const context = vm.createContext({
    CONFIG: { redditTimeWindow: "day" },
    URL,
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
    setTimeout: () => 1,
    clearTimeout() {},
    window: {
      addEventListener(type, handler) { windowEvents[type] = handler; },
      open(...args) { opened.push(args); },
    },
    document: {
      createElement(tag) {
        const node = {
          tagName: tag, dataset: {}, children: [],
          append(...children) { this.children.push(...children); },
          addEventListener() {},
        };
        node.classList = {
          contains: (name) => node.className?.split(" ").includes(name) ?? false,
          toggle(name, value) {
            if (name === "keyboard-dimmed") node.dimmed = value;
            if (name === "current") node.selected = value;
          },
        };
        return node;
      },
      getElementById: (id) => controls[id] ?? feeds[id.replace(/-feed$/, "")] ?? { addEventListener() {} },
      querySelectorAll: () => columns,
      addEventListener(type, handler) { keyHandler = handler; },
    },
    // Leave initial loading pending; these tests exercise navigation only.
    chrome: { storage: { local: { get: () => new Promise(() => {}) } } },
  });
  vm.runInContext(readFileSync(new URL("./feed.js", import.meta.url), "utf8").replace(/^import .*\n/, ""), context);
  function press(key, extra = {}) {
    const event = {
      key, target: { closest: () => null },
      preventDefault() { this.prevented = true; }, ...extra,
    };
    keyHandler(event);
    return event;
  }
  return { feeds, columns, press, stored, windowEvents, opened, context, controls };
}

test("j/k follow hovered column, preserve independent selection, and scroll only that list", () => {
  const { feeds, columns, press } = setup();
  assert.equal(press("j").prevented, undefined);
  columns[0].handlers.pointerenter();
  press("j"); press("j");
  assert.equal(feeds.reddit.children[1].selected, true);
  assert.equal(feeds.reddit.lastScroll.top, 94);
  assert.equal(feeds.hn.lastScroll, undefined);
  columns[0].handlers.pointerleave();
  columns[1].handlers.pointerenter();
  press("j");
  assert.equal(feeds.hn.children[0].selected, true);
  columns[1].handlers.pointerleave();
  columns[0].handlers.pointerenter();
  press("k");
  assert.equal(feeds.reddit.children[0].selected, true);
  assert.equal(feeds.hn.children[0].selected, true);
  press("k");
  assert.equal(feeds.reddit.children[0].selected, true);
  press("j"); press("j"); press("j");
  assert.equal(feeds.reddit.children[2].selected, true);
  columns[0].handlers.pointerleave();
  assert.equal(press("k").prevented, undefined);
});

test("j/k skip seen posts and dividers, including all-seen feeds", () => {
  const { feeds, columns, press } = setup();
  const [first, seen, last] = feeds.reddit.children;
  seen.className = "seen";
  feeds.reddit.children.splice(1, 0, { dataset: {}, classList: { toggle() {} } });
  columns[0].handlers.pointerenter();
  press("j");
  assert.equal(first.selected, true);
  press("j");
  assert.equal(last.selected, true);
  assert.equal(seen.selected, false);
  press("j");
  assert.equal(last.selected, true);
  press("k");
  assert.equal(first.selected, true);
  first.className = last.className = "seen";
  assert.equal(press("j").prevented, undefined);
});

test("render groups seen posts below a labeled divider in each column", () => {
  const app = setup(JSON.stringify({ reddit: { postId: "reddit-seen" } }));
  app.context.posts = ["reddit", "hn"].flatMap((source) => [true, false].map((seen) => ({
    source, seen, id: `${source}-${seen ? "seen" : "new"}`,
    url: "https://example.com/post", commentsUrl: "https://example.com/comments",
    title: "Post", label: source, score: 1, comments: 1, created: 0,
  })));
  vm.runInContext("render(posts)", app.context);
  for (const [source, feed] of Object.entries(app.feeds)) {
    const [fresh, divider, seen] = feed.children;
    assert.equal(fresh.dataset.postId, `${source}-new`);
    assert.equal(divider.className, "seen-divider");
    assert.deepEqual(divider.children.map((node) => node.tagName), ["hr", "span", "hr"]);
    assert.equal(divider.children[1].textContent, "Seen");
    assert.equal(seen.dataset.postId, `${source}-seen`);
    assert.equal(seen.classList.contains("current"), false);
  }
  app.context.posts = app.context.posts.filter((post) => !post.seen);
  vm.runInContext("render(posts)", app.context);
  assert.equal(app.feeds.reddit.children.length, 1);
});

test("navigation ignores typing, modifiers, composition, and empty columns", () => {
  const { feeds, columns, press } = setup();
  columns[0].handlers.pointerenter();
  for (const extra of [
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { isComposing: true }, { defaultPrevented: true },
    { target: { closest: () => ({}) } },
  ]) assert.equal(press("j", extra).prevented, undefined);
  assert.equal(feeds.reddit.lastScroll, undefined);
  feeds.reddit.children = [];
  assert.equal(press("j").prevented, undefined);
});

test("active cue follows hover; Enter and c open selected post/comments in new tabs", () => {
  const { columns, press, opened } = setup();
  columns[0].handlers.pointerenter();
  assert.equal(columns[0].classList.active, true);
  press("Enter");
  assert.equal(opened.length, 0);
  press("j");
  press("Enter");
  press("c");
  assert.deepEqual(opened, [
    ["https://example.com/reddit/0", "_blank", "noopener,noreferrer"],
    ["https://example.com/reddit/0/comments", "_blank", "noopener,noreferrer"],
  ]);
  press("Enter", { repeat: true });
  press("c", { ctrlKey: true });
  press("Enter", { target: { closest: (selector) => selector.startsWith("a,") ? {} : null } });
  assert.equal(opened.length, 2);
  columns[0].handlers.pointerleave();
  assert.equal(columns[0].classList.active, false);
  press("c");
  assert.equal(opened.length, 2);
});

test("reload starts both lists at the top but keeps selection; user scrolling stops image restoration", () => {
  const app = setup(JSON.stringify({
    reddit: { postId: "reddit-1", scrollTop: 450 },
    hn: { postId: "hn-2", scrollTop: 230 },
  }));
  app.feeds.reddit.scrollTop = 450;
  app.feeds.hn.scrollTop = 230;
  vm.runInContext('restoreScroll("reddit"); restoreScroll("hn");', app.context);
  assert.equal(app.feeds.reddit.scrollTop, 0);
  assert.equal(app.feeds.hn.scrollTop, 0);
  app.columns[0].handlers.pointerenter();
  app.press("Enter");
  assert.equal(app.opened[0][0], "https://example.com/reddit/1");
  app.feeds.reddit.handlers.wheel();
  app.feeds.reddit.scrollTop = 700;
  vm.runInContext('restoreScroll("reddit");', app.context);
  assert.equal(app.feeds.reddit.scrollTop, 700);
  app.windowEvents.pagehide();
  const saved = JSON.parse(app.stored.get("feedView"));
  assert.equal(saved.reddit.postId, "reddit-1");
  assert.equal(saved.reddit.scrollTop, undefined);
  const reloaded = setup(app.stored.get("feedView"));
  reloaded.feeds.reddit.scrollTop = 700;
  vm.runInContext('restoreScroll("reddit");', reloaded.context);
  assert.equal(reloaded.feeds.reddit.scrollTop, 0);
});

test("Reddit controls default to Best, persist Top timeframe, and reset only Reddit view", () => {
  const app = setup();
  const sort = app.controls["reddit-sort"];
  const timeframe = app.controls["reddit-timeframe"];
  assert.equal(sort.value, "best");
  assert.equal(timeframe.hidden, true);
  sort.value = "top";
  sort.handlers.change();
  assert.equal(timeframe.hidden, false);
  timeframe.value = "week";
  timeframe.handlers.change();
  assert.deepEqual(JSON.parse(app.stored.get("redditOptions")), { sort: "top", timeframe: "week" });
  assert.equal(app.feeds.reddit.children.length, 0);
  assert.equal(app.feeds.hn.children.length, 3);
  const reloaded = setup(null, app.stored.get("redditOptions"));
  assert.equal(reloaded.controls["reddit-sort"].value, "top");
  assert.equal(reloaded.controls["reddit-timeframe"].value, "week");
  assert.equal(reloaded.controls["reddit-timeframe"].hidden, false);
  sort.value = "new";
  sort.handlers.change();
  assert.equal(timeframe.hidden, true);
});

test("invalid saved state falls back safely", () => {
  for (const value of ["not json", "null", JSON.stringify({ reddit: { scrollTop: -5 }, hn: { scrollTop: "bad" } })]) {
    const app = setup(value);
    vm.runInContext('restoreScroll("reddit"); restoreScroll("hn");', app.context);
    assert.equal(app.feeds.reddit.scrollTop, 0);
    assert.equal(app.feeds.hn.scrollTop, 0);
  }
});

test("keyboard navigation fades both lists; manual scrolling either list clears fade", () => {
  const { feeds, columns, press } = setup();
  const allCards = [...feeds.reddit.children, ...feeds.hn.children];
  function assertFade(selected) {
    for (const card of allCards) assert.equal(card.dimmed, card !== selected);
  }
  columns[0].handlers.pointerenter();
  press("j");
  assertFade(feeds.reddit.children[0]);
  feeds.reddit.handlers.scroll(); // Delayed keyboard scroll event must keep fade.
  assertFade(feeds.reddit.children[0]);
  press("j");
  assertFade(feeds.reddit.children[1]);
  columns[0].handlers.pointerleave();
  columns[1].handlers.pointerenter();
  press("j");
  assertFade(feeds.hn.children[0]);
  for (const source of ["reddit", "hn"]) {
    for (const type of ["wheel", "touchmove", "scroll"]) {
      press("k");
      assertFade(feeds.hn.children[0]);
      if (type === "scroll") feeds[source].scrollTop += 20;
      feeds[source].handlers[type]();
      for (const card of allCards) assert.equal(card.dimmed, false);
    }
  }
});
