# RedHack Feed

Browser extension combining top posts from your subscribed subreddits with Hacker News in one feed. Plain JavaScript, HTML, and CSS; no build step or dependencies.

## Features

- Alternates Reddit and Hacker News posts, up to 100 items by default.
- Removes duplicate URLs and fills remaining slots when one source runs short.
- Reddit sort picker: **Best** (default, personalized home ranking), **Top** with timeframe, or **New**. Choice persists across reloads.
- Caps Reddit posts at five per subreddit; excludes pinned and NSFW posts.
- Remembers posts shown by earlier refreshes; when they appear again they move to the bottom of their column and are faded.
- Shows scores, comment links, post ages, and available Reddit image previews.
- Follows your system’s light or dark theme.
- Caches results locally for 15 minutes. **Refresh** bypasses the cache.
- Opens from the toolbar, reusing an existing feed tab when available.

## Install

Clone or download this repository:

```sh
git clone https://github.com/tinykings/redhack.git
cd redhack
```

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project’s directory.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select this project’s `manifest.json`.

Firefox temporary installations last until the browser restarts.

## Use

1. Log in to [Reddit](https://www.reddit.com/login) in the same browser profile and subscribe to at least one subreddit.
2. Click the **RedHack Feed** toolbar button.
3. Choose **Best**, **Top**, or **New** beside the Reddit heading. **Top** offers past hour/day/week/month/year or all time.
4. Click **Refresh** to fetch fresh posts.

No Reddit API keys or Hacker News account required. Reddit requests use your existing browser session. If subscriptions cannot be read, the feed shows a login notice and can still display Hacker News posts.

If a source fails, available posts from the other source are shown. An existing cache is replaced only when both source requests succeed.

## Configuration

Edit `CONFIG` in `sources.js`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `totalItems` | `100` | Maximum combined feed size |
| `redditTimeWindow` | `"day"` | Reddit ranking window: `hour`, `day`, `week`, `month`, `year`, or `all` |
| `maxPerSubreddit` | `5` | Maximum posts selected per subreddit |
| `subsPerRequest` | `50` | Subreddits combined into each Reddit listing request |
| `seenHistory` | `2000` | Post ids remembered per source for marking repeats |

Cache lifetime is controlled by `CACHE_TTL_MS` in `feed.js`. Reload the extension after editing, then reload the feed tab and click **Refresh**.

## Development

No package installation required. Load the project as an unpacked or temporary extension to test browser behavior.

Run tests with Node.js 22 or later:

```sh
node --experimental-default-type=module --test *.test.mjs
```

Tests mock network requests and cover Reddit previews, galleries, crossposts, direct images, thumbnails, and invalid or missing image URLs.

### Project files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension metadata, permissions, and browser configuration |
| `background.js` | Toolbar action and feed-tab reuse |
| `feed.html`, `feed.css` | Feed markup and styling |
| `feed.js` | Rendering, refresh, cache, and error notices |
| `sources.js` | API requests, post normalization, image selection, and interleaving |
| `sources.test.mjs` | Reddit image extraction tests |

## Permissions and data

- `storage`: saves the feed cache and previously shown post ids in local extension storage.
- `https://www.reddit.com/*`: reads subscriptions and top posts.
- `https://hacker-news.firebaseio.com/*`: reads Hacker News top stories and story details.

Requests go directly to Reddit and Hacker News; no project backend. Image previews load from their source hosts. Cached posts remain in the browser’s extension storage.
