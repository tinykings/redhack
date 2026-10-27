import test from "node:test";
import assert from "node:assert/strict";
import { fetchReddit } from "./sources.js";

test("Reddit images: previews, galleries, crossposts, fallbacks, and missing images", async () => {
  const cases = [
    [{ preview: { images: [{ resolutions: [
      { width: 108, url: "https://preview.redd.it/small.jpg" },
      { width: 320, url: "https://preview.redd.it/image.jpg?a=1&amp;b=2" },
    ] }] } }, "https://preview.redd.it/image.jpg?a=1&b=2"],
    [{ preview: { images: [{ source: { url: "https://i.redd.it/source.jpg" } }] } }, "https://i.redd.it/source.jpg"],
    [{ gallery_data: { items: [{ media_id: "first" }] }, media_metadata: {
      first: { s: { u: "https://i.redd.it/gallery.png" } },
    } }, "https://i.redd.it/gallery.png"],
    [{ crosspost_parent_list: [{ thumbnail: "https://b.thumbs.redditmedia.com/image.jpg" }] }, "https://b.thumbs.redditmedia.com/image.jpg"],
    [{ url: "https://i.redd.it/direct.webp" }, "https://i.redd.it/direct.webp"],
    [{ thumbnail: "https://b.thumbs.redditmedia.com/thumb.jpg" }, "https://b.thumbs.redditmedia.com/thumb.jpg"],
    [{ thumbnail: "self" }, null],
    [{ thumbnail: "nsfw" }, null],
    [{ thumbnail: "javascript:alert(1)" }, null],
    [{}, null],
  ];
  const originalFetch = globalThis.fetch;
  try {
    for (const [fields, expected] of cases) {
      globalThis.fetch = async (url) => ({
        ok: true,
        json: async () => url.includes("/subreddits/mine/")
          ? { data: { children: [{ data: { display_name: "test" } }], after: null } }
          : { data: { children: [{ data: {
            name: "t3_test", subreddit: "test", permalink: "/r/test/comments/test",
            url: "https://example.com/post", score: 10, ...fields,
          } }] } },
      });
      const [post] = await fetchReddit(1);
      assert.equal(post.image, expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
