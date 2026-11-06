let creatingOffscreen;

const splitSelectedMenuId = "split-selected-tabs";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: splitSelectedMenuId,
    title: "Open selected tabs in split screen",
    contexts: ["tab"]
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Arcify Edge could not create the tab menu:", chrome.runtime.lastError.message);
    }
  });
});

chrome.contextMenus.onClicked.addListener(handleSelectedTabsMenu);

function handleSelectedTabsMenu(info, tab) {
  if (info.menuItemId !== splitSelectedMenuId) return;
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
    throw new Error("Right-click one of the two selected tabs.");
  }
  const tabs = await chrome.tabs.query({ highlighted: true, windowId: clickedTab.windowId });
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
  if (tabs.some((tab) => tab.splitViewId !== undefined && tab.splitViewId !== -1)) {
    throw new Error("A selected tab is already in split view. Unsplit it first.");
  }
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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "copy-page-url") return;

  copyPageUrl(tab).catch((error) => {
    console.error("Arcify Edge could not copy the page URL:", error);
  });
});

async function copyPageUrl(tab) {
  const activeTab = tab ?? (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  }))[0];
  if (!activeTab?.url) {
    throw new Error("The active page URL is unavailable.");
  }

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "copy-page-url",
    url: activeTab.url
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? "The clipboard document did not respond.");
  }

  if (!Number.isInteger(activeTab.id) || !/^(https?|file):/.test(activeTab.url)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["toast.js"]
    });
  } catch (error) {
    console.warn("Arcify Edge copied the URL, but could not display confirmation:", error);
  }
}

chrome.action.onClicked.addListener((tab) => {
  enableSplitDrag(tab).catch(async (error) => {
    console.error("Arcify Edge could not enable drag-to-split:", error);
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title: error.message });
  });
});

async function enableSplitDrag(tab) {
  if (typeof chrome.tabs.createSplit !== "function") {
    throw new Error("This browser does not support native split-view extensions.");
  }
  if (!Number.isInteger(tab.id) || !/^https?:/.test(tab.url ?? "")) {
    throw new Error("Enable drag-to-split on an HTTP or HTTPS page.");
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["split-drag.js"]
  });
  await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  await chrome.action.setTitle({
    tabId: tab.id,
    title: "Toggle link drag-to-split on this page"
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    throw new Error("Drag a link from the enabled page.");
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
