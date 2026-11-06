(() => {
  const key = "__arcifySplitDrag";
  if (globalThis[key]) return;
  globalThis[key] = true;

  const host = document.createElement("div");
  host.id = "arcify-edge-split-drag";
  host.style.setProperty("all", "initial", "important");
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("inset", "0", "important");
  host.style.setProperty("pointer-events", "none", "important");
  host.style.setProperty("z-index", "2147483647", "important");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .edge, .status {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      font: 14px/20px system-ui, sans-serif;
      color: #fff;
      background: #202124;
      pointer-events: none;
    }
    .edge {
      display: none;
      top: 0;
      bottom: 0;
      width: min(240px, 30vw);
      align-items: center;
      justify-content: center;
      text-align: center;
      border: 2px solid #8ab4f8;
      background: #202124e6;
    }
    .edge.active { background: #174ea6ed; }
    .edge span { pointer-events: none; }
    .left { left: 0; }
    .right { right: 0; }
    .status {
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 70vw;
      padding: 10px 16px;
      border-radius: 8px;
    }
  `;
  const left = document.createElement("div");
  left.className = "edge left";
  const right = document.createElement("div");
  right.className = "edge right";
  for (const [zone, text] of [[left, "Drop to split left"], [right, "Drop to split right"]]) {
    const label = document.createElement("span");
    label.textContent = text;
    zone.append(label);
  }
  const status = document.createElement("div");
  status.className = "status";
  status.hidden = true;
  status.setAttribute("role", "status");
  shadow.append(style, left, right, status);
  document.documentElement.append(host);

  let draggedUrl;
  let timer;
  let pending = false;
  function notify(text) {
    clearTimeout(timer);
    status.textContent = text;
    status.hidden = false;
    timer = setTimeout(() => { status.hidden = true; }, 3000);
  }
  function hideEdges() {
    left.style.display = right.style.display = "none";
    left.style.pointerEvents = right.style.pointerEvents = "none";
    left.classList.remove("active");
    right.classList.remove("active");
    draggedUrl = undefined;
  }
  function dragStart(event) {
    if (!event.isTrusted || pending) return;
    const link = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    if (!link || !/^https?:/.test(link.href)) return;
    draggedUrl = link.href;
    left.style.display = right.style.display = "flex";
    left.style.pointerEvents = right.style.pointerEvents = "auto";
  }
  function sideAt(event) {
    for (const [zone, side] of [[left, "left"], [right, "right"]]) {
      const rect = zone.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) return side;
    }
  }
  function dragOver(event) {
    if (!event.isTrusted || !draggedUrl) return;
    const side = sideAt(event);
    left.classList.toggle("active", side === "left");
    right.classList.toggle("active", side === "right");
    if (!side) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }
  async function drop(event) {
    if (!event.isTrusted || !draggedUrl) return;
    const side = sideAt(event);
    const url = draggedUrl;
    hideEdges();
    if (!side) return;
    event.preventDefault();
    event.stopPropagation();
    pending = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "split-page-link", side, url });
      if (!response?.ok) throw new Error(response?.error ?? "The extension did not respond.");
      notify("Split view opened");
    } catch (error) {
      console.error("Arcify Edge could not split the link:", error);
      notify(`Could not split: ${error.message}`);
    } finally {
      pending = false;
    }
  }
  function keyDown(event) {
    if (event.key === "Escape") hideEdges();
  }

  document.addEventListener("dragstart", dragStart, true);
  document.addEventListener("dragenter", dragOver, true);
  document.addEventListener("dragover", dragOver, true);
  document.addEventListener("drop", drop, true);
  document.addEventListener("dragend", hideEdges, true);
  document.addEventListener("keydown", keyDown, true);
})();
