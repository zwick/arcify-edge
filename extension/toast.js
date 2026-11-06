(() => {
  const id = "arcify-edge-copy-confirmation";
  document.getElementById(id)?.remove();

  const host = document.createElement("div");
  host.id = id;
  for (const [property, value] of Object.entries({
    all: "initial",
    position: "fixed",
    top: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    "z-index": "2147483647",
    "pointer-events": "none"
  })) {
    host.style.setProperty(property, value, "important");
  }

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    @keyframes fade {
      0% { opacity: 0; }
      12%, 78% { opacity: 1; }
      100% { opacity: 0; }
    }
    div {
      padding: 10px 16px;
      border-radius: 8px;
      background: #202124;
      color: #fff;
      box-shadow: 0 2px 12px #0003;
      font: 14px/20px system-ui, sans-serif;
      white-space: nowrap;
      animation: fade 1400ms ease-in-out both;
    }
    @media (prefers-reduced-motion: reduce) {
      div { animation: none; }
    }
  `;
  const message = document.createElement("div");
  message.setAttribute("role", "status");
  message.textContent = "URL copied";
  shadow.append(style, message);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 1400);
})();
