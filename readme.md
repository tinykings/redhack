# RedHack Feed

Browser extension combining Reddit, Hacker News, and your YouTube subscriptions in three columns. Plain JavaScript, HTML, and CSS; no build step or dependencies.

## Features

- Reddit and Hacker News share up to 100 items by default; YouTube adds up to 100 videos from the initial subscriptions page (no older-page pagination yet).
- YouTube uses your existing browser login—no API key or OAuth setup. Ranked “Most relevant” carousels and supplemental rich shelves are excluded; main upload-list order is preserved.
- Click a video thumbnail or title, or press **Enter** on a selected video, to watch on YouTube in a new tab. No embedded players.
- Hover a column and use **j/k** to navigate new items; **c** opens comments in a new tab.
- Removes duplicate URLs and fills remaining slots when one source runs short.
- Reddit sort picker: **Best** (default, personalized home ranking), **Top** with timeframe, or **New**. Choice persists across reloads.
- Caps Reddit posts at five per subreddit; excludes pinned and NSFW posts.
- Remembers posts/videos shown by earlier refreshes; repeats move below a **Seen** divider. Seen means previously fetched, not necessarily watched; this does not sync YouTube watch history.
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
4. Log in to [YouTube](https://www.youtube.com/feed/subscriptions) in the same browser profile and complete any consent prompts.
5. Click **Refresh** to fetch fresh posts and videos. After installing this update, reload the extension and feed tab; approve new permissions if prompted.

No Reddit API keys or Hacker News account required. Reddit requests use your existing browser session. If subscriptions cannot be read, the feed shows a login notice and can still display Hacker News posts.

If a source fails, other sources still load and cached cards from the failed source remain available. An existing cache is replaced only when all three requests succeed.

YouTube session access relies on undocumented page data and may break when YouTube changes its layout. Browser cookie restrictions can prevent login detection even when the site works in a normal tab.

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
| `sources.test.mjs`, `youtube.test.mjs`, `feed.test.mjs` | Source parsing, session errors, seen history, rendering, video links, and keyboard tests |

## Permissions and data

- `storage`: saves the feed cache and previously shown post/video ids in local extension storage.
- `https://www.youtube.com/*`: reads your subscriptions page with browser session credentials.
- `https://www.reddit.com/*`: reads subscriptions and top posts.
- `https://hacker-news.firebaseio.com/*`: reads Hacker News top stories and story details.

Requests go directly to Reddit, Hacker News, and YouTube; no project backend. YouTube thumbnails load from `i.ytimg.com`. Image previews load from their source hosts. Cached posts remain in the browser’s extension storage.
