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
  const chrome = {
    commands: { onCommand: { addListener: (handler) => { listener = handler; } } },
    tabs: { query: async () => [{ url }] },
    scripting: { executeScript: async (options) => { injections.push(options); } },
    runtime: {
      getURL: (file) => `chrome-extension://test/${file}`,
      getContexts: async () => [],
      sendMessage: async (message) => { messages.push(message); return { ok: true }; }
    },
    offscreen: { createDocument: async (options) => { documents.push(options); } }
  };
  overrides(chrome);
  const context = vm.createContext({
    chrome,
    console: {
      error: (...args) => errors.push(args),
      warn: (...args) => warnings.push(args)
    }
  });
  vm.runInContext(source("background.js"), context);
  return {
    messages, errors, documents, injections, warnings,
    copy: (tab) => context.copyPageUrl(tab),
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
  assert.deepEqual(manifest.permissions, ["activeTab", "clipboardWrite", "offscreen", "scripting"]);
  assert.ok(existsSync(path.join(extensionPath, manifest.background.service_worker)));
  assert.match(source("offscreen.html"), /<script src="offscreen.js"><\/script>/);
  assert.match(source("offscreen.html"), /<textarea id="clipboard"/);
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
