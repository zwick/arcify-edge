(() => {
  const key = "__arcifyMruSwitcher";
  if (globalThis[key]) return;
  globalThis[key] = true;

  // Whether a shortcut modifier is held; null until a trusted event reveals it.
  let held = null;
  let host;
  let list;
  let visible = false;

  function build() {
    host = document.createElement("div");
    host.id = "arcify-edge-mru-switcher";
    for (const [property, value] of Object.entries({
      all: "initial",
      position: "fixed",
      inset: "0",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "z-index": "2147483647",
      "pointer-events": "none"
    })) {
      host.style.setProperty(property, value, "important");
    }
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      ul {
        box-sizing: border-box;
        width: min(560px, 90vw);
        margin: 0;
        padding: 8px;
        list-style: none;
        border-radius: 12px;
        background: #202124f2;
        box-shadow: 0 8px 32px #0006;
        color: #fff;
        font: 14px/20px system-ui, sans-serif;
      }
      li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border-radius: 8px;
      }
      li[aria-selected="true"] { background: #174ea6; }
      .icons { flex: none; display: flex; gap: 4px; }
      .icon {
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        background: #5f6368;
      }
      .icon.loaded { background: none; }
      .text { min-width: 0; }
      .title, .host {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .host { color: #bdc1c6; font-size: 12px; line-height: 16px; }
    `;
    list = document.createElement("ul");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Recent tabs");
    shadow.append(style, list);
  }

  function hostname(url) {
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  }

  // Drawn on a canvas so page image policies (CSP img-src) cannot block it.
  function favicon(pane) {
    const canvas = document.createElement("canvas");
    canvas.className = "icon";
    canvas.width = canvas.height = 32;
    const data = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(pane.icon ?? "")?.[1];
    if (data) {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      createImageBitmap(new Blob([bytes], { type: "image/png" })).then((bitmap) => {
        canvas.getContext("2d").drawImage(bitmap, 0, 0, 32, 32);
        canvas.classList.add("loaded");
      }).catch(() => {});
    }
    return canvas;
  }

  function row(entry, selected) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(selected));
    const icons = document.createElement("div");
    icons.className = "icons";
    icons.append(...entry.panes.map(favicon));
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = entry.panes.map((pane) => pane.title).join(" | ");
    const site = document.createElement("div");
    site.className = "host";
    site.textContent = entry.panes.map((pane) => hostname(pane.url)).join(" | ");
    text.append(title, site);
    item.append(icons, text);
    return item;
  }

  function render(entries, index) {
    if (!host) build();
    list.replaceChildren(...entries.map((entry, i) => row(entry, i === index)));
    if (!host.isConnected) document.documentElement.append(host);
    visible = true;
  }

  function finish(type) {
    if (!visible) return;
    visible = false;
    host.remove();
    chrome.runtime.sendMessage({ type }).catch(() => {});
  }

  function track(event) {
    if (!event.isTrusted) return;
    held = event.metaKey || event.ctrlKey || event.altKey;
    if (visible && !held) finish("mru-switcher-commit");
  }

  function keyDown(event) {
    if (visible && event.isTrusted && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish("mru-switcher-cancel");
      return;
    }
    track(event);
  }

  function lostFocus() {
    held = null;
    finish("mru-switcher-cancel");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "mru-switcher-show") return;
    if (held === false) {
      sendResponse({ ok: true, held: false });
      return;
    }
    render(message.tabs, message.index);
    sendResponse({ ok: true, held: true });
  });

  addEventListener("keydown", keyDown, true);
  addEventListener("keyup", track, true);
  addEventListener("pointermove", track, true);
  addEventListener("pointerdown", track, true);
  addEventListener("blur", lostFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") lostFocus();
  });
})();
