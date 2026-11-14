import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withIsolatedHome, freePort } from "./lib/harness.mjs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const pluginDir = fileURLToPath(new URL("..", import.meta.url));

await withIsolatedHome(async (home) => {
  const targetPort = await freePort();
  const pluginPort = await freePort();
  const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Guest Target</title></head>
<body style="font-family:sans-serif;padding:40px"><h1 id="t">Target</h1><button id="btn">Clique</button></body></html>`;

  const bootDir = mkdtempSync(join(tmpdir(), "lr-guest-"));
  const pageFile = join(bootDir, "page.html");
  writeFileSync(pageFile, PAGE, "utf8");
  const BOOT = `
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const [LIB_URL, TARGET_PORT, PLUGIN_PORT] = process.argv.slice(2);
const PAGE = readFileSync(${JSON.stringify(pageFile)}, "utf8");
const { startServer } = await import(LIB_URL);
const target = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
});
await new Promise((r) => target.listen(TARGET_PORT, "127.0.0.1", r));
const lr = await startServer({ port: PLUGIN_PORT });
console.log(JSON.stringify({ ok: true, lrPort: lr.port, targetPort: TARGET_PORT }));
`;
  const bootFile = join(bootDir, "boot.mjs");
  writeFileSync(bootFile, BOOT, "utf8");

  const libUrl = new URL("../lib/index.js", import.meta.url).href;
  const child = spawn(process.execPath, [bootFile, libUrl, String(targetPort), String(pluginPort)], {
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
    windowsHide: true
  });
  let ready = null;
  child.stdout.on("data", (chunk) => {
    const line = String(chunk);
    const at = line.indexOf("{");
    if (at !== -1 && ready === null) {
      try { ready = JSON.parse(line.slice(at)); } catch {}
    }
  });
  const deadline = Date.now() + 20000;
  while (ready === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  check("the plugin server booted", ready !== null, JSON.stringify(ready));
  if (ready === null) {
    child.kill();
    rmSync(bootDir, { recursive: true, force: true });
    return;
  }

  const base = `http://127.0.0.1:${ready.lrPort}`;
  const pageUrl = `http://127.0.0.1:${ready.targetPort}/`;
  const overlaySource = readFileSync(join(pluginDir, "lib", "overlay.js"), "utf8");
  const bridgeSource = readFileSync(join(pluginDir, "lib", "bridge.js"), "utf8");

  const harnessWebview = {
    dataset: {},
    getAttribute: (name) => (name === "src" ? "about:blank#lease-abc" : null),
    getURL: () => pageUrl,
    executeJavaScript: async (code) => {
      harnessWebview.executed.push(code);
      return "[]";
    },
    executed: [],
    addEventListener: () => {}
  };

  const secret = readFileSync(join(home, ".dsh", "profiles", "desktop", "dsh-redline", "instance.secret"), "utf8").trim();
  const appWindow = {
    __ModuleLoader__: { load: (spec) => { appWindow.__loaded = spec; } },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    setTimeout,
    clearTimeout,
    document: {
      readyState: "complete",
      querySelectorAll: (selector) => (typeof selector === "string" && selector.includes("webview") ? [harnessWebview] : []),
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      documentElement: {}
    },
    navigator: { language: "pt-BR" },
    console,
    fetch: async (url) => {
      const target = String(url);
      if (target.includes("/api/dsh-redline.secret")) return new Response(JSON.stringify({ ok: true, secret }), { status: 200, headers: { "content-type": "application/json" } });
      if (target.endsWith("/.lr/health")) return new Response(JSON.stringify({ ok: true, name: "dsh-redline", port: ready.lrPort }), { status: 200, headers: { "content-type": "application/json" } });
      if (target.endsWith("/.lr/overlay.js")) return new Response(overlaySource, { status: 200, headers: { "content-type": "text/javascript" } });
      if (target.endsWith("/.lr/bridge.js")) return new Response(bridgeSource, { status: 200, headers: { "content-type": "text/javascript" } });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
  };

  const vm = await import("node:vm");
  const sandbox = {
    window: appWindow,
    document: appWindow.document,
    console,
    navigator: appWindow.navigator,
    localStorage: appWindow.localStorage,
    fetch: appWindow.fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    queueMicrotask,
    AbortController,
    AbortSignal,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    structuredClone: globalThis.structuredClone,
    MutationObserver: class { observe() {} },
    Element: class Element {}
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(pluginDir, "lib", "client.js"), "utf8"), sandbox, { filename: "client.js" });
  const spec = appWindow.__loaded;
  const stub = { useState: () => [undefined, () => {}], useEffect: () => {}, useRef: () => ({ current: undefined }), useCallback: (fn) => fn, useMemo: () => undefined, createElement: () => ({}), memo: (fn) => fn, Fragment: "Fragment" };
  const plugin = spec.factory(() => stub);
  const slots = [];
  const ctx = {
    slots: { inject: () => [], register: (s, c) => { slots.push({ s, c }); return { dispose() {} }; } },
    inject: () => [],
    effect: () => {},
    commands: { register: () => {} },
    connection: { fetch: { register: () => {} } },
    remote: {},
    agent: { id: "session-check" }
  };
  plugin.apply(ctx);

  const deadlineInject = Date.now() + 8000;
  while (harnessWebview.executed.length === 0 && Date.now() < deadlineInject) await new Promise((r) => setTimeout(r, 100));

  const injected = harnessWebview.executed.find((code) => code.includes("window.__LR__ = Object.assign"));
  check("the client injected the overlay into a guest whose src is the lease token",
    injected !== undefined,
    `executed ${harnessWebview.executed.length} scripts`);
  check("the injected bundle carries the bridge relay before the overlay",
    injected !== undefined && injected.indexOf("__LR_BRIDGE__") < injected.indexOf("__LR_LOADED__"),
    (injected ?? "").slice(0, 120));

  const emptyWebview = {
    dataset: {},
    getAttribute: (name) => (name === "src" ? "about:blank#lease-empty" : null),
    getURL: () => "about:blank#lease-empty",
    executeJavaScript: async (code) => { emptyWebview.executed.push(code); return "[]"; },
    executed: [],
    addEventListener: () => {}
  };
  const emptySandbox = { ...sandbox, window: { ...appWindow, document: { ...appWindow.document, querySelectorAll: (s) => (typeof s === "string" && s.includes("webview") ? [emptyWebview] : []) } } };
  emptySandbox.document = emptySandbox.window.document;
  vm.createContext(emptySandbox);
  vm.runInContext(readFileSync(join(pluginDir, "lib", "client.js"), "utf8"), emptySandbox, { filename: "client-empty.js" });
  const emptySpec = emptySandbox.window.__loaded;
  const emptyPlugin = emptySpec.factory(() => stub);
  emptyPlugin.apply(ctx);
  const emptyDeadline = Date.now() + 4000;
  while (emptyWebview.executed.length === 0 && Date.now() < emptyDeadline) await new Promise((r) => setTimeout(r, 100));
  check("the client did not inject into a guest that never navigated",
    !emptyWebview.executed.some((code) => code.includes("window.__LR__ = Object.assign")),
    `executed ${emptyWebview.executed.length} scripts`);

  child.kill();
  rmSync(bootDir, { recursive: true, force: true });
});

process.exit(failures === 0 ? 0 : 1);
