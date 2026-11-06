const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const path = require("node:path");

const extensionPath = path.join(__dirname, "../extension");
const source = (file) => readFileSync(path.join(extensionPath, file), "utf8");
const url = "https://example.com/path?query=a%20b&other=1#fragment";

function background(overrides = () => {}) {
  const messages = [];
  const errors = [];
  const documents = [];
  const injections = [];
  const warnings = [];
  let listener;
  let messageListener;
  let menuListener;
  let installedListener;
  const menus = [];
  const chrome = {
    contextMenus: {
      create: (options, callback) => { menus.push(options); callback(); },
      onClicked: { addListener: (handler) => { menuListener = handler; } }
    },
    commands: { onCommand: { addListener: (handler) => { listener = handler; } } },
    tabs: { query: async () => [{ url }] },
    scripting: { executeScript: async (options) => { injections.push(options); } },
    runtime: {
      onInstalled: { addListener: (handler) => { installedListener = handler; } },
      getURL: (file) => `chrome-extension://test/${file}`,
      getContexts: async () => [],
      sendMessage: async (message) => { messages.push(message); return { ok: true }; },
      onMessage: { addListener: (handler) => { messageListener = handler; } }
    },
    offscreen: { createDocument: async (options) => { documents.push(options); } }
  };
  overrides(chrome);
  const context = vm.createContext({
    chrome,
    URL,
    console: {
      error: (...args) => errors.push(args),
      warn: (...args) => warnings.push(args)
    }
  });
  vm.runInContext(source("background.js"), context);
  return {
    messages, errors, documents, injections, warnings, menus,
    install: () => installedListener(),
    menu: (info, tab) => menuListener(info, tab),
    splitSelected: (tab) => context.splitSelectedTabs(tab),
    copy: (tab) => context.copyPageUrl(tab),
    split: (message, sender) => context.splitPageLink(message, sender),
    message: (message, sender, respond) => messageListener(message, sender, respond),
    command: (...args) => listener(...args)
  };
}

function clipboard(copyResult = true) {
  let listener;
  let selected = false;
  let copied;
  const field = { value: "", select: () => { selected = true; } };
  vm.runInNewContext(source("offscreen.js"), {
    chrome: { runtime: { onMessage: { addListener: (handler) => { listener = handler; } } } },
    document: {
      getElementById: (id) => { assert.equal(id, "clipboard"); return field; },
      execCommand: (command) => {
        assert.equal(command, "copy");
        assert.equal(selected, true);
        copied = field.value;
        if (copyResult instanceof Error) throw copyResult;
        return copyResult;
      }
    }
  });
  return {
    field,
    copied: () => copied,
    send: (message) => {
      let response;
      listener(message, {}, (value) => { response = value; });
      return response;
    }
  };
}

test("manifest wires the Mac shortcut and only required permissions", () => {
  const manifest = JSON.parse(source("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.commands["copy-page-url"].suggested_key.mac, "Command+Shift+C");
  assert.equal(manifest.commands["copy-page-url"].suggested_key.default, "Ctrl+Shift+C");
  assert.deepEqual(manifest.permissions, ["activeTab", "clipboardWrite", "offscreen", "scripting", "contextMenus"]);
  assert.equal(manifest.action, undefined);
  assert.deepEqual(manifest.content_scripts, [{
    matches: ["http://*/*", "https://*/*"], js: ["split-drag.js"], run_at: "document_idle"
  }]);
  assert.equal(manifest.host_permissions, undefined);
  assert.ok(existsSync(path.join(extensionPath, manifest.background.service_worker)));
  assert.match(source("offscreen.html"), /<script src="offscreen.js"><\/script>/);
  assert.match(source("offscreen.html"), /<textarea id="clipboard"/);
});

const selectedPair = () => [
  { id: 41, windowId: 7, index: 2, groupId: -1, pinned: false, splitViewId: -1 },
  { id: 42, windowId: 7, index: 3, groupId: -1, pinned: false, splitViewId: -1 }
];

test("installs only a native tab-strip context menu", () => {
  const app = background();
  app.install();
  assert.equal(app.menus.length, 1);
  assert.equal(app.menus[0].id, "split-selected-tabs");
  assert.deepEqual(Array.from(app.menus[0].contexts), ["tab"]);
});

test("selected tab split queries the clicked window and preserves strip order", async () => {
  const pairs = [];
  const app = background((chrome) => {
    chrome.tabs.query = async (options) => {
      assert.equal(options.highlighted, true);
      assert.equal(options.windowId, 7);
      return selectedPair().reverse();
    };
    chrome.tabs.createSplit = async (ids) => { pairs.push(Array.from(ids)); };
  });
  await app.splitSelected({ id: 42, windowId: 7 });
  assert.deepEqual(pairs, [[41, 42]]);
  assert.equal(app.injections.length, 0);
});

test("rejects counts other than two, unrelated clicks, and incompatible pairs without splitting", async () => {
  const cases = [
    [[], /exactly two.*0 selected/],
    [selectedPair().slice(0, 1), /exactly two.*1 selected/],
    [[...selectedPair(), { id: 43 }], /exactly two.*3 selected/],
    [selectedPair().map((tab) => ({ ...tab, id: tab.id + 10 })), /Right-click/],
    [selectedPair().map((tab, i) => ({ ...tab, index: i * 2 })), /next to each other/],
    [selectedPair().map((tab, i) => ({ ...tab, groupId: i })), /same window and group/],
    [selectedPair().map((tab, i) => ({ ...tab, pinned: !!i })), /pinned state/],
    [selectedPair().map((tab, i) => ({ ...tab, windowId: 7 + i })), /same window/],
    [selectedPair().map((tab, i) => ({ ...tab, splitViewId: i ? 123 : -1 })), /already in split/]
  ];
  for (const [tabs, error] of cases) {
    const app = background((chrome) => {
      chrome.tabs.query = async () => tabs;
      chrome.tabs.createSplit = async () => assert.fail("Invalid selections must not split");
    });
    await assert.rejects(app.splitSelected({ id: 42, windowId: 7 }), error);
  }
});

test("rejects missing context and unsupported split API explicitly", async () => {
  const app = background((chrome) => { chrome.tabs.query = async () => selectedPair(); });
  await assert.rejects(app.splitSelected(), /Right-click/);
  await assert.rejects(app.splitSelected({ id: 42 }), /Right-click/);
  await assert.rejects(app.splitSelected({ id: 42, windowId: 7 }), /does not support/);
});

test("compatible pinned grouped tabs can split without URL access", async () => {
  let split = false;
  const app = background((chrome) => {
    chrome.tabs.query = async () => selectedPair().map((tab) => ({ ...tab, groupId: 9, pinned: true }));
    chrome.tabs.createSplit = async () => { split = true; };
  });
  await app.splitSelected({ id: 41, windowId: 7 });
  assert.equal(split, true);
});

test("native menu errors open readable extension feedback even for restricted pages", async () => {
  for (const failure of ["query", "split", "count"]) {
    const created = [];
    const app = background((chrome) => {
      chrome.tabs.query = async () => {
        if (failure === "query") throw new Error("Selection unavailable");
        return failure === "count" ? [] : selectedPair();
      };
      chrome.tabs.createSplit = async () => { throw new Error("Tab changed"); };
      chrome.tabs.create = async (options) => { created.push(options); };
    });
    app.menu({ menuItemId: "unrelated" }, { id: 42, windowId: 7 });
    await new Promise(setImmediate);
    assert.equal(created.length, 0);
    app.menu({ menuItemId: "split-selected-tabs" }, { id: 42, windowId: 7 });
    await new Promise(setImmediate);
    assert.equal(created.length, 1);
    assert.equal(created[0].windowId, 7);
    assert.match(created[0].url, /^chrome-extension:\/\/test\/split-error.html\?message=/);
    assert.equal(app.errors.length, 1);
    assert.equal(app.injections.length, 0);
  }
});

test("error page renders messages as text", () => {
  const message = {};
  vm.runInNewContext(source("split-error.js"), {
    URL,
    location: { href: "chrome-extension://test/split-error.html?message=%3Cb%3ESelect%20two%3C%2Fb%3E" },
    document: { getElementById: () => message }
  });
  assert.equal(message.textContent, "<b>Select two</b>");
});

test("copies the exact invoking tab URL and creates a clipboard document", async () => {
  const app = background(() => {});
  await app.copy({ url });
  assert.equal(app.messages[0].url, url);
  assert.equal(app.messages[0].target, "offscreen");
  assert.equal(app.documents[0].url, "offscreen.html");
  assert.equal(app.documents[0].reasons[0], "CLIPBOARD");
});

test("queries the active tab when the command supplies none", async () => {
  const app = background((chrome) => {
    chrome.tabs.query = async (options) => {
      assert.equal(options.active, true);
      assert.equal(options.lastFocusedWindow, true);
      return [{ url }];
    };
  });
  await app.copy();
  assert.equal(app.messages[0].url, url);
});

test("reuses an existing offscreen document after worker restart", async () => {
  const app = background((chrome) => {
    chrome.runtime.getContexts = async (options) => {
      assert.equal(options.contextTypes[0], "OFFSCREEN_DOCUMENT");
      assert.equal(options.documentUrls[0], "chrome-extension://test/offscreen.html");
      return [{}];
    };
  });
  await app.copy({ url });
  assert.equal(app.documents.length, 0);
});

test("concurrent commands share offscreen creation", async () => {
  let release;
  let creations = 0;
  const app = background((chrome) => {
    chrome.offscreen.createDocument = () => {
      creations++;
      return new Promise((resolve) => { release = resolve; });
    };
  });
  const copies = [app.copy({ url }), app.copy({ url: "https://example.org/" })];
  await new Promise(setImmediate);
  release();
  await Promise.all(copies);
  assert.equal(creations, 1);
  assert.equal(app.messages.length, 2);
});

test("concurrent commands share the offscreen lookup", async () => {
  let release;
  let lookups = 0;
  const app = background((chrome) => {
    chrome.runtime.getContexts = () => {
      lookups++;
      return new Promise((resolve) => { release = resolve; });
    };
  });
  const copies = [app.copy({ url }), app.copy({ url })];
  assert.equal(lookups, 1);
  release([]);
  await Promise.all(copies);
  assert.equal(app.documents.length, 1);
});

test("failed offscreen creation can be retried", async () => {
  let attempts = 0;
  const app = background((chrome) => {
    chrome.offscreen.createDocument = async () => {
      if (++attempts === 1) throw new Error("Creation failed");
    };
  });
  await assert.rejects(app.copy({ url }), /Creation failed/);
  await app.copy({ url });
  assert.equal(app.messages.length, 1);
});

test("missing URLs never write to the clipboard", async () => {
  const app = background((chrome) => { chrome.tabs.query = async () => []; });
  await assert.rejects(app.copy(), /URL is unavailable/);
  await assert.rejects(app.copy({}), /URL is unavailable/);
  assert.equal(app.messages.length, 0);
  assert.equal(app.documents.length, 0);
});

test("clipboard failures and absent replies propagate", async () => {
  for (const response of [{ ok: false, error: "Copy failed" }, undefined]) {
    const app = background((chrome) => { chrome.runtime.sendMessage = async () => response; });
    await assert.rejects(app.copy({ url }), /Copy failed|did not respond/);
  }
});

test("only the copy command runs and failures are logged", async () => {
  const app = background((chrome) => { chrome.tabs.query = async () => []; });
  app.command("unrelated");
  app.command("copy-page-url");
  await new Promise(setImmediate);
  assert.equal(app.errors.length, 1);
  assert.equal(app.messages.length, 0);
});

test("offscreen copies exact text, acknowledges it, and clears the field", () => {
  const page = clipboard();
  assert.equal(page.send({ target: "offscreen", type: "copy-page-url", url }).ok, true);
  assert.equal(page.copied(), url);
  assert.equal(page.field.value, "");
});

test("offscreen reports rejected writes and exceptions", () => {
  for (const result of [false, new Error("Denied")]) {
    const page = clipboard(result);
    const response = page.send({ target: "offscreen", type: "copy-page-url", url });
    assert.equal(response.ok, false);
    assert.match(response.error, /rejected|Denied/);
    assert.equal(page.field.value, "");
  }
});

test("offscreen ignores other messages and rejects invalid URLs", () => {
  const page = clipboard();
  assert.equal(page.send({ target: "other", type: "copy-page-url", url }), undefined);
  assert.equal(page.send({ target: "offscreen", type: "other", url }), undefined);
  for (const invalid of ["", null, 123]) {
    assert.equal(page.send({ target: "offscreen", type: "copy-page-url", url: invalid }).ok, false);
  }
  assert.equal(page.copied(), undefined);
});

test("shows confirmation in the copied tab only after clipboard success", async () => {
  const app = background((chrome) => {
    chrome.scripting.executeScript = async (options) => {
      assert.equal(app.messages.length, 1);
      assert.equal(options.target.tabId, 42);
      assert.equal(options.files[0], "toast.js");
    };
  });
  await app.copy({ id: 42, url });
});

test("failed clipboard writes never show confirmation", async () => {
  const app = background((chrome) => {
    chrome.runtime.sendMessage = async () => ({ ok: false, error: "Denied" });
  });
  await assert.rejects(app.copy({ id: 42, url }), /Denied/);
  assert.equal(app.injections.length, 0);
});

test("restricted pages copy without injecting confirmation", async () => {
  const app = background();
  for (const restricted of ["edge://extensions/", "about:blank", "chrome-extension://other/page.html"]) {
    await app.copy({ id: 42, url: restricted });
  }
  assert.equal(app.messages.length, 3);
  assert.equal(app.injections.length, 0);
});

test("blocked injection preserves copying and reports confirmation failure", async () => {
  const app = background((chrome) => {
    chrome.scripting.executeScript = async () => { throw new Error("Cannot access this page"); };
  });
  await app.copy({ id: 42, url });
  assert.equal(app.messages.length, 1);
  assert.equal(app.warnings.length, 1);
  assert.match(app.warnings[0][0], /copied the URL/);
});

test("toast replaces prior confirmation, stays isolated, and removes itself", () => {
  const hosts = new Map();
  const timers = [];
  const document = {
    getElementById: (id) => hosts.get(id),
    createElement: (tag) => ({
      tag, children: [], attributes: {}, properties: {},
      style: { setProperty() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      append(...children) { this.children.push(...children); },
      attachShadow(options) {
        this.shadowOptions = options;
        this.shadow = document.createElement("shadow");
        return this.shadow;
      },
      remove() { if (hosts.get(this.id) === this) hosts.delete(this.id); }
    }),
    documentElement: { append: (host) => hosts.set(host.id, host) }
  };
  const context = vm.createContext({
    document, setTimeout: (callback, delay) => { timers.push({ callback, delay }); }
  });
  vm.runInContext(source("toast.js"), context);
  const first = hosts.get("arcify-edge-copy-confirmation");
  assert.equal(first.shadowOptions.mode, "closed");
  assert.equal(first.shadow.children[1].textContent, "URL copied");
  assert.equal(first.shadow.children[1].attributes.role, "status");
  assert.match(first.shadow.children[0].textContent, /prefers-reduced-motion/);
  assert.equal(timers[0].delay, 1400);
  vm.runInContext(source("toast.js"), context);
  assert.equal(hosts.size, 1);
  assert.notEqual(hosts.get(first.id), first);
  timers[0].callback();
  assert.equal(hosts.size, 1);
  timers[1].callback();
  assert.equal(hosts.size, 0);
});

test("unsupported browsers reject split creation explicitly", async () => {
  const app = background();
  await assert.rejects(app.split({ side: "left", url }, { tab: { id: 42 }, frameId: 0 }), /does not support/);
  assert.equal(app.injections.length, 0);
});

test("left and right drops create adjacent native split tabs", async () => {
  const created = [];
  const app = background((chrome) => {
    chrome.tabs.createSplit = async () => {};
    chrome.tabs.get = async (id) => ({ id, index: 3, splitViewId: -1 });
    chrome.tabs.create = async (options) => { created.push(options); };
  });
  for (const side of ["left", "right"]) {
    await app.split({ side, url }, { tab: { id: 42 }, frameId: 0 });
  }
  assert.equal(created[0].index, 3);
  assert.equal(created[1].index, 4);
  for (const options of created) {
    assert.equal(options.splitWithTabId, 42);
    assert.equal(options.url, url);
  }
});

test("split requests reject invalid sources, sides, URLs, and existing splits", async () => {
  const app = background((chrome) => {
    chrome.tabs.createSplit = async () => {};
    chrome.tabs.get = async () => ({ id: 42, index: 3, splitViewId: 123 });
  });
  const sender = { tab: { id: 42 }, frameId: 0 };
  await assert.rejects(app.split({ side: "left", url }, {}), /main page/);
  await assert.rejects(app.split({ side: "left", url }, { ...sender, frameId: 2 }), /main page/);
  await assert.rejects(app.split({ side: "up", url }, sender), /left or right/);
  for (const invalid of ["javascript:alert(1)", "file:///test", "edge://settings/"]) {
    await assert.rejects(app.split({ side: "left", url: invalid }, sender), /Only HTTP/);
  }
  await assert.rejects(app.split({ side: "left", url }, sender), /already in split view/);
});

test("split message failures are acknowledged and logged", async () => {
  const app = background();
  assert.equal(app.message({ type: "other" }, {}, () => {}), undefined);
  const response = await new Promise((resolve) => {
    assert.equal(app.message({ type: "split-page-link", side: "left", url }, {}, resolve), true);
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /main page/);
  assert.equal(app.errors.length, 1);
});

test("automatic drag script handles full zones, boundaries, errors, and cancellation", async () => {
  const listeners = new Map();
  const nodes = [];
  const messages = [];
  const errors = [];
  let response = { ok: true };
  class Anchor {
    href = url;
  }
  const document = {
    createElement: () => {
      const node = {
        children: [],
        style: { setProperty() {} },
        classList: { remove() {}, toggle() {} },
        getBoundingClientRect() {
          return this.className === "edge left"
            ? { left: 0, right: 240, top: 0, bottom: 760 }
            : { left: 760, right: 1000, top: 0, bottom: 760 };
        },
        setAttribute() {},
        append(...children) { this.children.push(...children); },
        attachShadow() { this.shadow = document.createElement(); return this.shadow; },
        remove() { this.removed = true; }
      };
      nodes.push(node);
      return node;
    },
    documentElement: { append() {} },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => {
      assert.equal(listeners.get(type), handler);
      listeners.delete(type);
    }
  };
  const context = vm.createContext({
    document, HTMLAnchorElement: Anchor, innerWidth: 1000,
    setTimeout: () => 1, clearTimeout() {},
    console: { error: (...args) => errors.push(args) },
    chrome: { runtime: { sendMessage: async (message) => { messages.push(message); return response; } } }
  });
  const event = (overrides = {}) => ({
    isTrusted: true, clientX: 20, clientY: 300, dataTransfer: {},
    composedPath: () => [new Anchor()],
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    ...overrides
  });
  vm.runInContext(source("split-drag.js"), context);
  const host = nodes[0];
  const [, left, right, status] = host.shadow.children;
  assert.equal(status.hidden, true);
  listeners.get("dragstart")(event({ isTrusted: false }));
  await listeners.get("drop")(event());
  assert.equal(messages.length, 0);
  listeners.get("dragstart")(event());
  assert.equal(left.style.display, "flex");
  assert.equal(right.style.display, "flex");
  assert.equal(left.style.pointerEvents, "auto");
  const middle = event({ clientX: 500 });
  listeners.get("dragover")(middle);
  assert.equal(middle.prevented, undefined);
  const edge = event();
  listeners.get("dragover")(edge);
  assert.equal(edge.prevented, true);
  assert.equal(edge.dataTransfer.dropEffect, "copy");
  await listeners.get("drop")(edge);
  assert.equal(messages[0].side, "left");
  assert.equal(messages[0].url, url);
  assert.equal(edge.stopped, true);
  assert.equal(left.style.display, "none");
  assert.equal(status.textContent, "Split view opened");
  for (const [x, side] of [[0, "left"], [120, "left"], [240, "left"], [760, "right"], [880, "right"], [1000, "right"]]) {
    listeners.get("dragstart")(event());
    const entered = event({ clientX: x });
    listeners.get("dragenter")(entered);
    assert.equal(entered.prevented, true);
    listeners.get("dragenter")(event({ clientX: x, target: left.children[0] }));
    await listeners.get("drop")(event({ clientX: x }));
    assert.equal(messages.at(-1).side, side);
  }
  const count = messages.length;
  for (const x of [241, 500, 759]) {
    listeners.get("dragstart")(event());
    const outside = event({ clientX: x });
    await listeners.get("drop")(outside);
    assert.equal(outside.prevented, undefined);
  }
  assert.equal(messages.length, count);
  response = { ok: false, error: "Already split" };
  listeners.get("dragstart")(event());
  await listeners.get("drop")(event({ clientX: 990 }));
  assert.equal(messages.at(-1).side, "right");
  assert.match(status.textContent, /Could not split: Already split/);
  assert.equal(errors.length, 1);
  listeners.get("dragstart")(event());
  listeners.get("keydown")({ key: "Escape" });
  await listeners.get("drop")(event());
  assert.equal(messages.length, count + 1);
  vm.runInContext(source("split-drag.js"), context);
  assert.equal(listeners.size, 6);
  assert.equal(nodes[0], host);
  assert.equal(host.removed, undefined);
  assert.equal(context.__arcifySplitDrag, true);
});
