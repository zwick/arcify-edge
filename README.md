# Arcify Edge

Arc-style shortcuts for Microsoft Edge.

| Feature | macOS | Windows/Linux |
| --- | --- | --- |
| Copy page URL | Cmd+Shift+C | Ctrl+Shift+C |
| Switch recent tabs | Cmd+E / Cmd+Shift+E | Ctrl+E / Ctrl+Shift+E |
| Split / unsplit selected tabs | Ctrl+Shift+S | Alt+Shift+S |

Right-click a tab for **Copy URL(s)**, **Split / Unsplit Tabs**, and **Close Duplicate Tabs**. Drag a link to the page edge to open it in split view.

## Install

1. Open `edge://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder.
3. Check the shortcuts at `edge://extensions/shortcuts`. Assign any that show blank because of a conflict.

After updating, reload the extension and refresh open pages.

## Features

**Copy page URL** copies the full URL, including query string and fragment, and shows a brief **URL copied** message. Restricted pages like `edge://` still copy without the message.

**Switch recent tabs** cycles through the window's 7 most recently used tabs. Hold the modifier to see the list, release to switch, or press **Escape** to cancel. A quick tap jumps to the previous tab. Split views count as one entry. These shortcuts replace Edge's address-bar and sidebar search shortcuts; **Cmd+L** still focuses the address bar.

**Split / unsplit** splits exactly two adjacent selected tabs, or unsplits the current split. Both tabs must share a group and pinned state. Uses Edge's [split-view API](https://developer.chrome.com/blog/split-view-api-extensions).

**Drag-to-split** highlights drop zones on each side of HTTP/HTTPS pages while you drag a link. Drop it in a zone to open it beside the current page.

**Copy URL(s)** copies the clicked tab's URL, or every selected tab's URL (one per line) when you right-click inside a selection.

**Close Duplicate Tabs** closes tabs in the window whose URL exactly matches another tab. Active, pinned, and split-view tabs are kept; otherwise the leftmost copy stays. Use **Reopen closed tab** to undo.

## Options

All tab-menu items are on by default. Turn them off under **Extension options** in the extension's details. Edge groups multiple items under an **Arcify Edge** submenu.

## Checks

Run `node --test` with Node.js 20 or later. Inspect runtime errors through the extension's **service worker** link on `edge://extensions`.
