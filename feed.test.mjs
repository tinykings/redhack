import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup() {
  function makeFeed(prefix) {
    return {
      scrollTop: 0,
      clientTop: 0,
      getBoundingClientRect: () => ({ top: 100 }),
      scrollTo(options) { this.lastScroll = options; },
      children: [0, 1, 2].map((index) => {
        const card = {
          dataset: { postId: `${prefix}-${index}` },
          selected: false,
          focus(options) { this.focusOptions = options; },
          getBoundingClientRect: () => ({ top: 200 }),
        };
        card.classList = { toggle(name, value) { card.selected = value; } };
        return card;
      }),
    };
  }
  const feeds = { reddit: makeFeed("reddit"), hn: makeFeed("hn") };
  const columns = Object.keys(feeds).map((source) => ({
    dataset: { source },
    handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
  }));
  let keyHandler;
  const context = vm.createContext({
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
  return { feeds, columns, press };
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
