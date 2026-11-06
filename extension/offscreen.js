const clipboard = document.getElementById("clipboard");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen" || message.type !== "copy-page-url") return;

  try {
    if (typeof message.url !== "string" || message.url.length === 0) {
      throw new Error("A page URL is required.");
    }
    clipboard.value = message.url;
    clipboard.select();
    // Offscreen documents cannot be focused, as required by navigator.clipboard.
    if (!document.execCommand("copy")) {
      throw new Error("The browser rejected the clipboard write.");
    }
    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  } finally {
    clipboard.value = "";
  }
});
