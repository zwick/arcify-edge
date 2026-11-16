let creatingOffscreen;

const splitSelectedMenuId = "split-selected-tabs";
const copyUrlsMenuId = "copy-tab-urls";
const copyUrlsTitle = (count) => count > 1 ? "Copy All URLs" : "Copy URL";
const splitTitle = (split) => split ? "Unsplit tabs" : "Open selected tabs in split screen";
const menuDefaults = { copyUrlsMenu: false, splitSelectedMenu: true };
const isSplitTab = (tab) => tab.splitViewId !== undefined && tab.splitViewId !== -1;

function createMenu(options) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(options, () => {
      if (chrome.runtime.lastError) {
        console.error("Arcify Edge could not create the tab menu:", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

let menuSettings;
const getMenuSettings = () => (menuSettings ??= chrome.storage.sync.get(menuDefaults));

// Edge groups an extension's tab-menu items into a submenu once there are two,
// so only the items enabled on the options page are created.
let menuRebuild = Promise.resolve();
function rebuildMenus() {
  menuRebuild = menuRebuild.then(async () => {
    const settings = await getMenuSettings();
    await chrome.contextMenus.removeAll();
    if (settings.copyUrlsMenu) {
      await createMenu({ id: copyUrlsMenuId, title: copyUrlsTitle(1), contexts: ["tab"] });
    }
    if (settings.splitSelectedMenu) {
      await createMenu({
        id: splitSelectedMenuId,
        title: splitTitle(false),
        contexts: ["tab"]
      });
    }
  }).catch((error) => {
    console.error("Arcify Edge could not build the tab menu:", error);
  });
  return menuRebuild.then(() => refreshMenuTitles());
}

chrome.runtime.onInstalled.addListener(() => rebuildMenus());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !Object.keys(menuDefaults).some((key) => key in changes)) return;
  menuSettings = undefined;
  return rebuildMenus();
});

// Chromium has no menu onShown event, so titles track the focused window's selection.
let menuTitleRefresh = 0;

async function refreshMenuTitles(windowId) {
  const refresh = ++menuTitleRefresh;
  try {
    const tabs = await chrome.tabs.query(Number.isInteger(windowId) && windowId >= 0
      ? { highlighted: true, windowId }
      : { highlighted: true, lastFocusedWindow: true });
    await menuRebuild;
    const settings = await getMenuSettings();
    if (refresh !== menuTitleRefresh) return;
    if (settings.copyUrlsMenu) {
      await chrome.contextMenus.update(copyUrlsMenuId, { title: copyUrlsTitle(tabs.length) });
    }
    if (settings.splitSelectedMenu) {
      await chrome.contextMenus.update(splitSelectedMenuId, { title: splitTitle(tabs.some(isSplitTab)) });
    }
  } catch (error) {
    console.error("Arcify Edge could not update the tab menu:", error);
  }
}

chrome.runtime.onStartup.addListener(() => refreshMenuTitles());
chrome.tabs.onHighlighted.addListener(({ windowId }) => refreshMenuTitles(windowId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if ("splitViewId" in changeInfo) refreshMenuTitles();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshMenuTitles(windowId);
});

chrome.contextMenus.onClicked.addListener(handleSelectedTabsMenu);

function handleSelectedTabsMenu(info, tab) {
  if (info.menuItemId === copyUrlsMenuId) {
    return copyTabUrls(tab).catch((error) => {
      console.error("Arcify Edge could not copy the tab URLs:", error);
    });
  }
  if (info.menuItemId !== splitSelectedMenuId) return;
  return splitSelectedWithFeedback(tab);
}

function splitSelectedWithFeedback(tab) {
  return splitSelectedTabs(tab).catch(async (error) => {
    console.error("Arcify Edge could not split the selected tabs:", error);
    await chrome.tabs.create({
      windowId: tab?.windowId,
      url: chrome.runtime.getURL(`split-error.html?message=${encodeURIComponent(error.message)}`)
    });
  }).catch((error) => {
    console.error("Arcify Edge could not display the split error:", error);
  });
}

async function splitSelectedTabs(clickedTab) {
  if (!Number.isInteger(clickedTab?.id) || !Number.isInteger(clickedTab.windowId)) {
    throw new Error("Select two tabs, then use the shortcut or right-click one of them.");
  }
  const tabs = await chrome.tabs.query({ highlighted: true, windowId: clickedTab.windowId });
  // Toggle: any split in the targeted tabs is unsplit instead of creating a new one.
  const targets = tabs.some((tab) => tab.id === clickedTab.id) ? tabs : [clickedTab];
  const splitViewIds = [...new Set(targets.filter(isSplitTab).map((tab) => tab.splitViewId))];
  if (splitViewIds.length > 0) {
    if (typeof chrome.tabs.unsplit !== "function") {
      throw new Error("This browser does not support unsplitting from extensions.");
    }
    for (const splitViewId of splitViewIds) await chrome.tabs.unsplit(splitViewId);
    return;
  }
  if (tabs.length !== 2) {
    throw new Error(`Select exactly two tabs to open in split screen (${tabs.length} selected).`);
  }
  if (!tabs.some((tab) => tab.id === clickedTab.id)) {
    throw new Error("Right-click one of the two selected tabs.");
  }
  if (typeof chrome.tabs.createSplit !== "function") {
    throw new Error("This browser does not support native split-view extensions.");
  }
  tabs.sort((a, b) => a.index - b.index);
  const [first, second] = tabs;
  if (first.windowId !== second.windowId || first.groupId !== second.groupId ||
      first.pinned !== second.pinned) {
    throw new Error("Select two tabs in the same window and group, with the same pinned state.");
  }
  if (second.index !== first.index + 1) {
    throw new Error("Move the two selected tabs next to each other, then try again.");
  }
  await chrome.tabs.createSplit([first.id, second.id]);
}

function ensureOffscreenDocument() {
  if (!creatingOffscreen) {
    creatingOffscreen = (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL("offscreen.html")]
      });
      if (contexts.length > 0) return;

      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Copy the active page URL to the clipboard."
      });
    })().finally(() => {
      creatingOffscreen = undefined;
    });
  }
  return creatingOffscreen;
}

const mruDirections = { "mru-next": 1, "mru-previous": -1 };
const mruLimit = 7;
const mruFallbackDelay = 900;
let mruCycle;
let mruQueue = Promise.resolve();

function queueMru(task) {
  mruQueue = mruQueue.then(task).catch((error) => {
    console.error("Arcify Edge could not switch recent tabs:", error);
  });
  return mruQueue;
}

const lastUsed = (tab) => tab.lastAccessed ?? 0;
const viewKey = (tab) => tab.splitViewId !== undefined && tab.splitViewId !== -1
  ? `split:${tab.splitViewId}`
  : `tab:${tab.id}`;

// Reads Edge's favicon cache, which also covers unloaded or discarded tabs.
async function faviconData(pageUrl) {
  if (!pageUrl) return "";
  try {
    const url = new URL(chrome.runtime.getURL("_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", "32");
    const response = await fetch(url);
    if (!response.ok) return "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:image/png;base64,${btoa(binary)}`;
  } catch {
    return "";
  }
}

// Each entry is one tab, or both panes of a split view shown left to right.
async function recentTabs(activeTab) {
  const tabs = await chrome.tabs.query({ windowId: activeTab.windowId });
  const current = tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
  const views = new Map();
  for (const tab of tabs) {
    const key = viewKey(tab);
    if (!views.has(key)) views.set(key, []);
    views.get(key).push(tab);
  }
  const currentKey = viewKey(current);
  const currentView = views.get(currentKey) ?? [current];
  views.delete(currentKey);
  const newest = (view) => Math.max(...view.map(lastUsed));
  const others = [...views.values()].sort((a, b) => newest(b) - newest(a));
  return Promise.all([currentView, ...others].slice(0, mruLimit).map(async (view) => ({
    id: view.reduce((a, b) => (lastUsed(b) > lastUsed(a) ? b : a)).id,
    panes: await Promise.all([...view].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(async (tab) => ({
      title: tab.title || tab.url || "Untitled tab",
      url: tab.url ?? "",
      icon: await faviconData(tab.url)
    })))
  })));
}

async function cycleMru(direction, tab) {
  const activeTab = tab ?? (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  }))[0];
  if (!Number.isInteger(activeTab?.id)) {
    throw new Error("The active tab is unavailable.");
  }
  if (mruCycle?.sourceTabId !== activeTab.id) {
    clearTimeout(mruCycle?.timer);
    mruCycle = { sourceTabId: activeTab.id, tabs: await recentTabs(activeTab), index: 0 };
  }
  const cycle = mruCycle;
  if (cycle.tabs.length < 2) {
    mruCycle = undefined;
    return;
  }
  clearTimeout(cycle.timer);
  cycle.index = (cycle.index + direction + cycle.tabs.length) % cycle.tabs.length;
  const state = await showMruSwitcher(cycle);
  if (mruCycle !== cycle) return;
  if (state === "released") return commitMru(cycle);
  if (state === "unavailable") {
    cycle.timer = setTimeout(() => queueMru(() => commitMru(cycle)), mruFallbackDelay);
  }
}

async function showMruSwitcher(cycle) {
  if (cycle.unavailable) return "unavailable";
  const message = { type: "mru-switcher-show", tabs: cycle.tabs, index: cycle.index };
  for (const inject of [false, true]) {
    try {
      if (inject) {
        await chrome.scripting.executeScript({
          target: { tabId: cycle.sourceTabId },
          files: ["mru-switcher.js"]
        });
      }
      const response = await chrome.tabs.sendMessage(cycle.sourceTabId, message, { frameId: 0 });
      if (response?.ok) return response.held ? "shown" : "released";
    } catch {
      // Restricted pages cannot host the switcher; fall back to an idle timer.
    }
  }
  cycle.unavailable = true;
  return "unavailable";
}

async function commitMru(cycle) {
  if (mruCycle !== cycle) return;
  mruCycle = undefined;
  clearTimeout(cycle.timer);
  if (cycle.index === 0) return;
  await chrome.tabs.update(cycle.tabs[cycle.index].id, { active: true });
}

function handleMruMessage(message, sender) {
  const cycle = mruCycle;
  if (!cycle || sender.tab?.id !== cycle.sourceTabId) return;
  if (message.type === "mru-switcher-commit") return queueMru(() => commitMru(cycle));
  return queueMru(() => {
    if (mruCycle !== cycle) return;
    clearTimeout(cycle.timer);
    mruCycle = undefined;
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (Object.hasOwn(mruDirections, command)) {
    queueMru(() => cycleMru(mruDirections[command], tab));
    return;
  }
  if (command === "split-selected-tabs") {
    splitSelectedCommand(tab);
    return;
  }
  if (command !== "copy-page-url") return;

  copyPageUrl(tab).catch((error) => {
    console.error("Arcify Edge could not copy the page URL:", error);
  });
});

async function splitSelectedCommand(tab) {
  const activeTab = tab ?? (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  }).catch(() => []))[0];
  return splitSelectedWithFeedback(activeTab);
}

async function copyPageUrl(tab) {
  const activeTab = tab ?? (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  }))[0];
  if (!activeTab?.url) {
    throw new Error("The active page URL is unavailable.");
  }

  await writeClipboard(activeTab.url);
  await showCopyConfirmation(activeTab, "URL copied");
}

// Like Chromium's own tab commands, a click inside the selection applies to every
// selected tab; a click outside it applies only to the clicked tab.
async function copyTabUrls(clickedTab) {
  if (!Number.isInteger(clickedTab?.id) || !Number.isInteger(clickedTab.windowId)) {
    throw new Error("The clicked tab is unavailable.");
  }
  const selected = await chrome.tabs.query({ highlighted: true, windowId: clickedTab.windowId });
  const tabs = selected.some((tab) => tab.id === clickedTab.id) ? selected : [clickedTab];
  const urls = tabs.filter((tab) => tab.url)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((tab) => tab.url);
  if (urls.length === 0) {
    throw new Error("The tab URLs are unavailable.");
  }

  await writeClipboard(urls.join("\n"));
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: clickedTab.windowId });
  await showCopyConfirmation(activeTab, urls.length > 1 ? `${urls.length} URLs copied` : "URL copied");
}

async function writeClipboard(text) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "copy-page-url",
    url: text
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "The clipboard document did not respond.");
  }
}

async function showCopyConfirmation(tab, message) {
  if (!Number.isInteger(tab?.id) || !/^(https?|file):/.test(tab.url ?? "")) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => { globalThis.arcifyEdgeToastMessage = text; },
      args: [message]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["toast.js"]
    });
  } catch (error) {
    console.warn("Arcify Edge copied the URL, but could not display confirmation:", error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "mru-switcher-commit" || message?.type === "mru-switcher-cancel") {
    handleMruMessage(message, sender);
    return;
  }
  if (message?.type !== "split-page-link") return;
  splitPageLink(message, sender).then(
    () => sendResponse({ ok: true }),
    (error) => {
      console.error("Arcify Edge could not split the link:", error);
      sendResponse({ ok: false, error: error.message });
    }
  );
  return true;
});

async function splitPageLink(message, sender) {
  if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) {
    throw new Error("Drag a link from the main page.");
  }
  if (message.side !== "left" && message.side !== "right") {
    throw new Error("Choose the left or right edge.");
  }
  const url = new URL(message.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS links can open in split view.");
  }
  if (typeof chrome.tabs.createSplit !== "function") {
    throw new Error("This browser does not support native split-view extensions.");
  }
  const tab = await chrome.tabs.get(sender.tab.id);
  if (tab.splitViewId !== undefined && tab.splitViewId !== -1) {
    throw new Error("This page is already in split view. Unsplit it before dragging another link.");
  }
  await chrome.tabs.create({
    url: url.href,
    splitWithTabId: tab.id,
    index: message.side === "left" ? tab.index : tab.index + 1
  });
}
