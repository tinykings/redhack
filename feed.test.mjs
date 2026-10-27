import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup(savedView = null) {
  function makeFeed(prefix) {
    const feed = {
      scrollTop: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTo(options) { this.lastScroll = options; this.scrollTop = options.top; },
      handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
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
        card.classList = { toggle(name, value) { card.selected = value; } };
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
  const windowEvents = {};
  const opened = [];
  const context = vm.createContext({
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
      getElementById: (id) => feeds[id.replace(/-feed$/, "")] ?? { addEventListener() {} },
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
  return { feeds, columns, press, stored, windowEvents, opened, context };
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

test("scroll and selection survive reload; user scrolling stops image restoration", () => {
  const app = setup(JSON.stringify({
    reddit: { postId: "reddit-1", scrollTop: 450 },
    hn: { postId: "hn-2", scrollTop: 230 },
  }));
  vm.runInContext('restoreScroll("reddit"); restoreScroll("hn");', app.context);
  assert.equal(app.feeds.reddit.scrollTop, 450);
  assert.equal(app.feeds.hn.scrollTop, 230);
  app.columns[0].handlers.pointerenter();
  app.press("Enter");
  assert.equal(app.opened[0][0], "https://example.com/reddit/1");
  app.feeds.reddit.handlers.wheel();
  app.feeds.reddit.scrollTop = 700;
  vm.runInContext('restoreScroll("reddit");', app.context);
  assert.equal(app.feeds.reddit.scrollTop, 700);
  app.windowEvents.pagehide();
  const saved = JSON.parse(app.stored.get("feedView"));
  assert.equal(saved.reddit.scrollTop, 700);
  assert.equal(saved.reddit.postId, "reddit-1");
  assert.equal(saved.hn.scrollTop, 230);
  const reloaded = setup(app.stored.get("feedView"));
  vm.runInContext('restoreScroll("reddit");', reloaded.context);
  assert.equal(reloaded.feeds.reddit.scrollTop, 700);
});

test("invalid saved state falls back safely", () => {
  for (const value of ["not json", "null", JSON.stringify({ reddit: { scrollTop: -5 }, hn: { scrollTop: "bad" } })]) {
    const app = setup(value);
    vm.runInContext('restoreScroll("reddit"); restoreScroll("hn");', app.context);
    assert.equal(app.feeds.reddit.scrollTop, 0);
    assert.equal(app.feeds.hn.scrollTop, 0);
  }
});
