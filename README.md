# Arcify Edge

Copy the active page's full URL with **Cmd+Shift+C** on macOS (**Ctrl+Shift+C** on Windows/Linux).

## Install

1. Open `edge://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `extension` folder.
3. Open `edge://extensions/shortcuts` and check that **Copy the active page URL** is assigned to **Cmd+Shift+C** (Mac) or **Ctrl+Shift+C** (Windows/Linux), with scope **In Microsoft Edge**. Assign it manually if blank or conflicting.

With Edge focused, press the shortcut to copy the current URL, including its query string and fragment. A brief **URL copied** message appears at the top of the page, then fades away. Paste normally. If Edge's developer tools open instead, revisit the shortcut assignment.

Edge's restricted pages (such as `edge://extensions` and extension stores) still copy, but cannot display the message. File pages need **Allow access to file URLs** enabled in the extension's details to display it.

The extension uses `activeTab` to read the URL when invoked, `clipboardWrite` to copy it, `offscreen` for a hidden clipboard document, `scripting` for page feedback and drag-to-split, and `tabs` for the recent-tab list. URLs are handled locally; opening a split loads the link normally. See the [Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands), [offscreen clipboard pattern](https://developer.chrome.com/docs/extensions/reference/api/offscreen), and [script injection permissions](https://developer.chrome.com/docs/extensions/reference/api/scripting).

## Try drag-to-split

Reload the extension after updating, then refresh open web pages. Drag a page link into either highlighted edge zone and release to open it beside the current page in native split view. The zones appear automatically during link drags, cover up to 240 pixels on each side, and highlight blue when ready to accept the drop.

Automatic handling runs on HTTP and HTTPS pages. Edge may ask to **read and change data on websites** for this access; allow the sites where you want drag-to-split. Page links are handled locally and opened only when dropped into a zone.

This proof of concept uses the [native split-view extension API](https://developer.chrome.com/blog/split-view-api-extensions). It requires a browser exposing that API (verified on Edge 157.0.4341.42). Use Edge's split controls to unsplit before opening another pair. Link drags start in the main page; browser tab-strip drags and links inside frames are outside this experiment.

## Split selected tabs

Reload the extension, select **exactly two adjacent tabs** in Edge's tab strip or vertical sidebar, then right-click either selected tab and choose **Open selected tabs in split screen**. Both tabs must share a group and pinned state, and neither can already be split. Arcify leaves tab order and membership unchanged. Invalid selections open an explanatory extension tab, including on restricted pages.

This adds only the `contextMenus` permission. See the [native tab-menu context](https://developer.chrome.com/docs/extensions/reference/api/contextMenus#type-ContextType) and [split-view API constraints](https://developer.chrome.com/blog/split-view-api-extensions#general-constraints).

## Switch recent tabs

Hold **Cmd** and tap **E** to move forward through the current window's 7 most recently used tabs, or **Shift+E** to move backward (starting from the 7th). Windows/Linux use **Ctrl+E** / **Ctrl+Shift+E**. These replace Edge's address-bar and sidebar search shortcuts (**Cmd+L** still focuses the address bar). A list shows which tab is selected while the modifier is held; release to switch, or press **Escape** to stay. Past the last tab, selection returns to the current tab. A quick tap jumps straight to the previous tab.

Remap either shortcut at `edge://extensions/shortcuts` (**Switch to the next/previous most recently used tab**). Any Cmd, Ctrl, or Option/Alt combination works, because the list closes when all of those modifiers are released. Edge reserves **Ctrl+Tab** and does not allow extensions to use the Tab key, so it cannot be assigned.

The list appears on HTTP/HTTPS pages (refresh tabs opened before installing). Restricted pages such as `edge://` can't display it, so the selection switches about a second after the last press. This feature adds the `tabs` permission to read tab titles; the ordering uses each tab's [`lastAccessed`](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-Tab-lastAccessed) time.

## Checks

Run `node --test` with Node.js 20 or later. For a browser check, load the extension in Edge, open a page with a query string and fragment, press the shortcut, and paste into a text field. Repeat after switching tabs/windows and on `edge://extensions`. Inspect errors through the extension's **service worker** link on `edge://extensions`.
