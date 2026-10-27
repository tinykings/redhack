// Clicking the toolbar icon opens the feed in a tab (reuses an existing one if open).
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("feed.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
