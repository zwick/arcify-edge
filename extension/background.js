let creatingOffscreen;

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
