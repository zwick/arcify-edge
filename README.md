# Arcify Edge

Copy the active page's full URL with **Cmd+Shift+C** on macOS (**Ctrl+Shift+C** on Windows/Linux).

## Install

1. Open `edge://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `extension` folder.
3. Open `edge://extensions/shortcuts` and check that **Copy the active page URL** is assigned to **Cmd+Shift+C** (Mac) or **Ctrl+Shift+C** (Windows/Linux), with scope **In Microsoft Edge**. Assign it manually if blank or conflicting.

With Edge focused, press the shortcut to copy the current URL, including its query string and fragment. Paste normally. If Edge's developer tools open instead, revisit the shortcut assignment.

The extension uses `activeTab` to read the URL when invoked, `clipboardWrite` to copy it, and `offscreen` for a hidden clipboard document. URLs stay local; there is no storage or network traffic. See the [Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands) and [offscreen clipboard pattern](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

## Checks

Run `node --test` with Node.js 20 or later. For a browser check, load the extension in Edge, open a page with a query string and fragment, press the shortcut, and paste into a text field. Repeat after switching tabs/windows and on `edge://extensions`. Inspect errors through the extension's **service worker** link on `edge://extensions`.
