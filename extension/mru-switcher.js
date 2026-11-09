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
      .icon {
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        background: #5f6368;
        object-fit: contain;
      }
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

  function row(tab, selected) {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(selected));
    let icon;
    if (/^(https?:|data:image\/)/.test(tab.favIconUrl ?? "")) {
      icon = document.createElement("img");
      icon.src = tab.favIconUrl;
      icon.alt = "";
      icon.onerror = () => { icon.removeAttribute("src"); };
    } else {
      icon = document.createElement("span");
    }
    icon.className = "icon";
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = tab.title;
    const site = document.createElement("div");
    site.className = "host";
    site.textContent = hostname(tab.url);
    text.append(title, site);
    item.append(icon, text);
    return item;
  }

  function render(tabs, index) {
    if (!host) build();
    list.replaceChildren(...tabs.map((tab, i) => row(tab, i === index)));
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
