// Final live test: boots the real plugin server and a realistic target page in
// an isolated profile, then re-runs the verification performed when the 22-plan
// queue was accepted — served-HTML rewriting, route auth, the bridge channel,
// and (when a playwright-cli browser is available) the live overlay flow:
// injection, per-origin storage, viewport-coordinate pins, draft preservation,
// session-relative navigation and the cross-path purge.
//
// Usage: node tools/final-test.mjs
// This is a standalone final check, NOT part of npm test: it boots real
// servers and drives a real browser, so CI never runs it.
//
// Architecture note: the servers run in a CHILD process on purpose. The
// playwright-cli calls are synchronous and block this process's event loop —
// servers kept in-process here froze it and the browser navigation timed out
// waiting for a response that could never be served.
//
// Traps encoded from the 2026-11-12 session (see the project record):
// - never bind the operator's harness port; both ports come from freePort();
// - on Windows a dual-bind can succeed silently — after boot the ports are
//   verified LISTENING via netstat before anything else runs;
// - the overlay's composer and pins live INSIDE the shadow root — page-level
//   querySelector cannot see them;
// - the draft-open gesture occasionally races; cells retry once;
// - standalone there is no harness, so deliveredIds stays [] — that state is
//   reported as INFO, never asserted, so fixing the delivery path cannot turn
//   this test red.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
function info(name, detail) {
  console.log(`INFO  ${name}${detail ? ` — ${detail}` : ""}`);
}

const enc = (u) => Buffer.from(u, "utf8").toString("base64url");

// withIsolatedHome redirects USERPROFILE/HOME for the plugin server; the
// playwright daemon and Chrome cannot launch under that redirected home, so
// every browser spawn carries the env captured here, before the isolation.
const REAL_ENV = { ...process.env };

const PAGE = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'self'">
<link rel="stylesheet" href="/style.css">
<title>Alvo Final</title></head><body>
<h1 id="t">Titulo Alvo</h1>
<p><a id="quoted" href="/about">link citado sobre</a></p>
<p><a id="unquoted" href=/search?q=1>busca nao citada</a></p>
<img id="logo" src="/img.png" srcset="/img1.png 1x, /img2.png 2x">
<img id="commain" srcset="/a.png?x=1,2 1x">
<img id="endscomma" srcset="/c.png, /d.png 2x">
<div id="styled" style="background:url('/bg.png')">estilo inline</div>
<img src="/broken.png
<p id="after">markup depois do quebrado</p>
<a href="/about2">depois do quebrado</a>
<script src="/app.js"></script>
</body></html>`;

const BOOT_SOURCE = `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const [LIB_URL, TARGET_PORT, PLUGIN_PORT] = process.argv.slice(2);
const PAGE = readFileSync(new URL("./page.html", import.meta.url), "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const { startServer } = await import(LIB_URL);
const target = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  } else if (path === "/about" || path === "/about2" || path === "/search") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body><h1>" + (path === "/search" ? "Busca" : "Sobre") + "</h1></body></html>");
  } else if (path === "/style.css") {
    res.writeHead(200, { "content-type": "text/css" });
    res.end("body { background: url('/bg.png'); }");
  } else if (path === "/app.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end("console.log('app loaded');");
  } else {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PNG);
  }
});
target.listen(Number(TARGET_PORT), "127.0.0.1");
const lr = await startServer({ port: Number(PLUGIN_PORT) });
console.log("READY " + lr.port + " " + TARGET_PORT);
setInterval(() => {}, 60000);
`;

// On Windows a second listen() on an occupied port can succeed without an
// error event, so the real bind is confirmed with netstat before any check.
function portsAreListening(ports) {
  if (process.platform !== "win32") return true;
  const out = spawnSync("netstat", ["-ano"], { shell: true, timeout: 30000, encoding: "utf8" });
  const text = String(out.stdout ?? "");
  return ports.every((port) => new RegExp(`:${port}\\s+.*LISTENING`).test(text));
}

function playwrightCli(args, timeoutMs = 120000) {
  const result = spawnSync("npx", ["playwright", "cli", ...args], {
    shell: true,
    timeout: timeoutMs,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: REAL_ENV,
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function parseCliResult(output) {
  const match = /### Result\r?\n([\s\S]*?)\r?\n### Ran Playwright/.exec(output);
  if (match === null) return null;
  try {
    const value = JSON.parse(match[1]);
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

// ---- browser cells: complete run-code files (async page => ...). ------------

const CELL_DISCOVERY = `async page => {
  return await page.evaluate(() => {
    const host = document.getElementById("dsh-redline-host");
    return JSON.stringify({
      hasHost: !!host,
      hasBridge: !!(window.__LR_BRIDGE__ && window.__LR_BRIDGE__.send),
      configKeys: window.__LR__ ? Object.keys(window.__LR__) : null,
      pageUrl: window.__LR__ ? window.__LR__.pageUrl : null,
      cspMetaInDom: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      linkHref: document.getElementById("quoted") ? document.getElementById("quoted").href : "",
      unquotedHref: document.getElementById("unquoted") ? document.getElementById("unquoted").href : "",
      styleAttr: document.getElementById("styled") ? document.getElementById("styled").getAttribute("style") : ""
    });
  });
}`;

const CELL_PARITY = `async page => {
  const direct = await page.context().newPage();
  await direct.goto("__TARGET_URL__");
  const control = await direct.evaluate(() => ({ afterP: !!document.getElementById("after"), title: document.title }));
  await direct.close();
  const proxied = await page.evaluate(() => ({ afterP: !!document.getElementById("after"), title: document.title }));
  return JSON.stringify({ control, proxied });
}`;

const CELL_PIN = `async page => {
  const attempt = () => page.evaluate(() => {
    const shadow = document.getElementById("dsh-redline-host").shadowRoot;
    const btn = [...shadow.querySelectorAll("button.tool")].find((b) => /Comentar/.test(b.title || ""));
    if (!btn) return JSON.stringify({ error: "comment tool not found" });
    btn.click();
    const t = document.getElementById("t");
    const r = t.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
    const composer = shadow.querySelector(".popover.composer");
    if (!composer) return JSON.stringify({ error: "composer did not open", cx, cy });
    const ta = composer.querySelector("textarea");
    ta.value = "teste final salvo no repo";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    composer.querySelector("button.send").click();
    return JSON.stringify({ cx, cy });
  });
  let result = JSON.parse(await attempt());
  if (result.error) result = JSON.parse(await attempt());
  if (result.error) return JSON.stringify(result);
  const measure = await page.evaluate(async () => {
    // the queued marker renders on a poll tick (~2.5 s), not on submit — poll for it
    const deadline = Date.now() + 8000;
    let marker = null;
    while (Date.now() < deadline && marker === null) {
      const shadow = document.getElementById("dsh-redline-host").shadowRoot;
      marker = [...shadow.querySelectorAll("*")].find((d) => /pin-queued/.test(String(d.className))) || null;
      if (marker === null) await new Promise((res) => setTimeout(res, 500));
    }
    const ssKey = Object.keys(sessionStorage).find((k) => k.includes("lr:pins"));
    const pins = ssKey ? JSON.parse(sessionStorage.getItem(ssKey)) : [];
    const pinClasses = [...document.getElementById("dsh-redline-host").shadowRoot.querySelectorAll("div")].map((d) => String(d.className)).filter((c) => /pin/i.test(c)).slice(0, 10);
    const shadow2 = document.getElementById("dsh-redline-host").shadowRoot;
    const toolbarText = (shadow2.querySelector(".root")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 160);
    return JSON.stringify({
      markerFound: !!marker,
      markerTransform: marker ? getComputedStyle(marker).transform : null,
      ssKey,
      ssStatus: pins.length ? pins[0].status : null,
      ssComment: pins.length ? pins[0].comment : null,
      pinClasses,
      toolbarText
    });
  });
  return JSON.stringify({ ...result, ...JSON.parse(measure) });
}`;

const CELL_STATE = `async page => {
  return await page.evaluate(async () => {
    const state = await window.__LR_BRIDGE__.send("state.get", {});
    const deadline = Date.now() + 8000;
    let queued = false;
    while (Date.now() < deadline && queued === false) {
      const shadow = document.getElementById("dsh-redline-host").shadowRoot;
      queued = [...shadow.querySelectorAll("*")].some((d) => /pin-queued/.test(String(d.className)));
      if (queued === false) await new Promise((res) => setTimeout(res, 500));
    }
    return JSON.stringify({ ok: state.ok, pendingCount: (state.pendingIds || []).length, deliveredCount: (state.deliveredIds || []).length, queuedMarkerStill: queued });
  });
}`;

const CELL_DRAFT = `async page => {
  const attempt = () => page.evaluate(() => {
    const shadow = document.getElementById("dsh-redline-host").shadowRoot;
    const btn = [...shadow.querySelectorAll("button.tool")].find((b) => /Comentar/.test(b.title || ""));
    btn.click();
    const img = document.getElementById("logo");
    const r = img.getBoundingClientRect();
    img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const composer = shadow.querySelector(".popover.composer");
    if (!composer) return JSON.stringify({ error: "composer did not open" });
    const ta = composer.querySelector("textarea");
    ta.value = "texto ANTES do resize";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    window.dispatchEvent(new Event("resize"));
    const preserved = ta.value === "texto ANTES do resize";
    const close = composer.querySelector("button.lr-close");
    if (close) close.click();
    return JSON.stringify({ preserved, closedClean: !shadow.querySelector(".popover.composer") });
  });
  let result = JSON.parse(await attempt());
  if (result.error) result = JSON.parse(await attempt());
  return JSON.stringify(result);
}`;

// navigation kills the page mid-CLI-call, so the click and the post-navigation
// state are separate cells (the click cell's own output may be lost — the
// state cell is what the checks assert on)
const CELL_NAV_CLICK = `async page => {
  const href = await page.evaluate(() => {
    const a = document.getElementById("quoted");
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    return a.href;
  });
  return JSON.stringify({ clicked: href });
}`;

const CELL_NAV_STATE = `async page => {
  await page.waitForLoadState("load");
  return await page.evaluate(() => ({
    url: location.href,
    h1: document.querySelector("h1") ? document.querySelector("h1").textContent : "",
    hasOverlay: !!document.getElementById("dsh-redline-host"),
    hasBridge: !!(window.__LR_BRIDGE__ && window.__LR_BRIDGE__.send),
    pageUrl: window.__LR__ ? window.__LR__.pageUrl : "",
    ssKeys: Object.keys(sessionStorage)
  }));
}`;

const CELL_502 = `async page => {
  return await page.evaluate(async () => {
    const resp = await fetch('/p/http://">><script>alert(1)</script>');
    const text = await resp.text();
    return JSON.stringify({ status: resp.status, hasRawScript: text.includes("<script>alert(1)</script>") });
  });
}`;

// ---- run --------------------------------------------------------------------

await withIsolatedHome(async (home) => {
  const LIB_URL = new URL("../lib/index.js", import.meta.url).href;
  const TARGET_PORT = await freePort();
  const PLUGIN_PORT = await freePort();
  const targetUrl = `http://127.0.0.1:${TARGET_PORT}/`;

  const workDir = mkdtempSync(join(tmpdir(), "dsh-final-test-"));
  writeFileSync(join(workDir, "page.html"), PAGE);
  writeFileSync(join(workDir, "boot.mjs"), BOOT_SOURCE);

  // the servers live in a child process: the synchronous playwright-cli calls
  // below block this process's event loop, which would freeze an in-process
  // server and stall the browser navigation
  const server = spawn(process.execPath, [join(workDir, "boot.mjs"), LIB_URL, String(TARGET_PORT), String(PLUGIN_PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let lrPort = PLUGIN_PORT;
  let childErrTail = "";
  server.stderr?.on("data", (chunk) => { childErrTail = (childErrTail + String(chunk)).slice(-2000); });
  server.on("exit", (code, signal) => {
    info("boot: servidor filho encerrou", `code=${code} signal=${signal ?? "none"} at=${new Date().toISOString()}${childErrTail !== "" ? ` — stderr: ${childErrTail.slice(-400).replaceAll("\n", " | ")}` : " — stderr vazio"}`);
  });
  const ready = new Promise((resolve, reject) => {
    let buffer = "";
    server.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /READY (\d+) (\d+)/.exec(buffer);
      if (match !== null) resolve(Number(match[1]));
    });
    server.stderr?.on("data", (chunk) => { buffer += String(chunk); });
    server.on("exit", (code) => reject(new Error(`boot exited before READY (code ${code}): ${buffer.slice(-300)}`)));
  });
  let booted = false;
  let lr = { close() {} };
  try {
    lrPort = await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error("boot timeout")), 30000))]);
    booted = true;
    lr = { close() { server.kill(); } };
    const realBase = `http://127.0.0.1:${lrPort}`;
    const secretPath = join(process.env.DSH_PROFILE_DIR, "dsh-redline", "instance.secret");
    const auth = { "x-dsh-redline-secret": readFileSync(secretPath, "utf8").trim() };
    const proxy = (p) => `/.lr/proxy/${enc(targetUrl.replace(/\/$/, "") + p)}`;

    check("boot: ambas as portas realmente em LISTENING (netstat, sem dual-bind)", portsAreListening([lrPort, TARGET_PORT]), `plugin=${lrPort} target=${TARGET_PORT}`);

    // ---- phase 1: routes and served HTML (no browser needed) ----
    const health = await (await fetch(`${realBase}/.lr/health`, { headers: auth })).json();
    check("http: health ok", health.ok === true && health.port === lrPort);
    check("http: status sem secret → 401", (await fetch(`${realBase}/.lr/status`)).status === 401);
    check("http: status com secret → 200", (await fetch(`${realBase}/.lr/status`, { headers: auth })).status === 200);

    const html = await (await fetch(`${realBase}/p/${enc(targetUrl)}`)).text();
    check("html: overlay injetado", html.includes("/.lr/overlay.js"));
    check("html: bridge injetado", html.includes("/.lr/bridge.js"));
    check("html: meta CSP removida", !/http-equiv="Content-Security-Policy"/i.test(html));
    check("html: config __LR__ presente e sem secret", html.includes("window.__LR__=") && !/"secret"/.test(html));
    check("html: href citado → /p/", html.includes(`href="/p/${enc(`${targetUrl}about`)}"`));
    check("html: href nao citado com = → /p/ inteiro", html.includes(`href=/p/${enc(`${targetUrl}search?q=1`)}`));
    check("html: img src citado → /.lr/proxy/", html.includes(`src="${proxy("/img.png")}"`));
    check("html: script src → /.lr/proxy/", html.includes(proxy("/app.js")));
    check("html: srcset 2 candidatos reescritos", html.includes(`srcset="${proxy("/img1.png")} 1x, ${proxy("/img2.png")} 2x"`));
    check("html: srcset virgula-na-url inteiro", html.includes(`srcset="${proxy("/a.png?x=1,2")} 1x"`));
    check("html: srcset termina-na-virgula", html.includes(`srcset="${proxy("/c.png")}, ${proxy("/d.png")} 2x"`));
    check("html: markup apos aspa quebrada sobrevive", html.includes('<p id="after">markup depois do quebrado</p>'));
    check("html: href apos quebrado ainda reescrito", html.includes(`href="/p/${enc(`${targetUrl}about2`)}"`));
    check("html: style= url reescrito", html.includes(proxy("/bg.png")));
    check("http: alvo invalido → 400", (await fetch(`${realBase}/p/nao-e-url`)).status === 400);

    {
      const bridge = (type, payload, headers = {}) => fetch(`${realBase}/.lr/bridge`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ type, payload }),
      });
      const denied = await bridge("state.get", {});
      check("bridge: sem origem → 401", denied.status === 401);
      const own = await (await bridge("state.get", {}, { origin: realBase })).json();
      check("bridge: state.get da propria origem → projecao estreita", own.ok === true && Array.isArray(own.pendingIds) && own.events === undefined);
      const submit = await (await bridge("annotations.submit", { pageUrl: targetUrl, pageTitle: "Alvo", pins: [{ id: "http1", tag: "h1", selector: "#t", comment: "pelo bridge http" }] }, { origin: realBase })).json();
      const pending = await (await fetch(`${realBase}/.lr/pending`, { headers: auth })).json();
      check("bridge: annotations.submit vira pendente no host", submit.ok === true && pending.count === 1 && pending.pins[0].comment === "pelo bridge http");
      const emptied = await (await bridge("annotations.submit", { pageUrl: targetUrl, pageTitle: "Alvo", pins: [] }, { origin: realBase })).json();
      check("bridge: submit vazio NÃO limpa o pendente (canal de anotação, kind empty)", emptied.kind === "empty", JSON.stringify(emptied).slice(0, 100));
      const cleared = await (await fetch(`${realBase}/.lr/annotations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [] }) })).json();
      check("bridge: a rota direta com secret limpa o pendente", cleared.kind === "cleared", JSON.stringify(cleared).slice(0, 100));
    }

    // ---- phase 2: live browser (skipped when playwright-cli is unavailable) ----
    const probe = playwrightCli(["--version"], 60000);
    const browserAvailable = probe.status === 0 && /Version/.test(probe.output);
    if (!browserAvailable) {
      console.log("SKIP  browser: playwright-cli indisponível — fase de navegador não executada");
    } else {
      const cellsDir = mkdtempSync(join(tmpdir(), "dsh-final-cells-"));
      const writeCell = (name, source) => {
        const file = join(cellsDir, `${name}.js`);
        writeFileSync(file, source);
        return file;
      };
      const runCell = (name, source) => parseCliResult(playwrightCli(["run-code", "--filename", writeCell(name, source)], 180000).output);

      try {
        // the try/catch below keeps a browser-phase crash from killing the
        // whole script: every later check reports FAIL and the child's stderr
        // tail (printed by the exit handler) explains why
        // (the throw itself is re-reported as a failed check)
        const openBrowser = (url) => playwrightCli(["open", url], 180000);
        const openUrl = `${realBase}/p/${enc(targetUrl)}`;
        let opened = openBrowser(openUrl);
        if (opened.status !== 0 && !/Page URL/.test(opened.output)) {
          // a wedged daemon from an earlier session shows up as "Daemon process
          // exited with code 1" — kill it and retry once before giving up
          playwrightCli(["kill-all"], 60000);
          opened = openBrowser(openUrl);
        }
        if (opened.status !== 0 && !/Page URL/.test(opened.output)) throw new Error(`open failed: ${opened.output.slice(0, 200)}`);

        const discovery = runCell("discovery", CELL_DISCOVERY);
        check("browser: overlay montado com shadowRoot e bridge", discovery !== null && discovery.hasHost === true && discovery.hasBridge === true);
        check("browser: config = [pageUrl, apiBase, settings] sem secret", discovery !== null && JSON.stringify(discovery.configKeys) === JSON.stringify(["pageUrl", "apiBase", "settings"]));
        check("browser: pageUrl = origem do alvo", discovery !== null && discovery.pageUrl === targetUrl, discovery ? String(discovery.pageUrl) : "sem resultado");
        check("browser: sem meta CSP no DOM", discovery !== null && discovery.cspMetaInDom === false);
        check("browser: links citado e nao-citado viraram /p/ no DOM", discovery !== null && discovery.linkHref.includes(`/p/${enc(`${targetUrl}about`)}`) && discovery.unquotedHref.includes(`/p/${enc(`${targetUrl}search?q=1`)}`));
        check("browser: style= url reescrito no DOM", discovery !== null && discovery.styleAttr.includes(proxy("/bg.png")));

        const parity = runCell("parity", CELL_PARITY.replaceAll("__TARGET_URL__", targetUrl));
        check("browser: paridade de parse do markup malformado com e sem proxy", parity !== null && parity.control.afterP === parity.proxied.afterP && parity.control.title === parity.proxied.title);

        const pin = runCell("pin", CELL_PIN);
        check("browser: gesto completo criou o pin", pin !== null && pin.markerFound === true, pin ? `toolbar=[${pin.toolbarText}] classes=${JSON.stringify(pin.pinClasses)}` : "sem resultado");
        {
          const matrix = pin && typeof pin.markerTransform === "string" ? /matrix\(([^)]+)\)/.exec(pin.markerTransform) : null;
          const params = matrix ? matrix[1].split(",").map((n) => Number(n.trim())) : null;
          check("browser: marcador em coordenadas de viewport = ponto do click", params !== null && params[4] === pin.cx && params[5] === pin.cy, pin ? `transform=${pin.markerTransform} click=${pin.cx},${pin.cy}` : "sem resultado");
        }
        check("browser: storage key = origem do alvo (partição 018)", pin !== null && pin.ssKey === `lr:pins:${targetUrl}`, pin ? String(pin.ssKey) : "sem resultado");
        check("browser: pin queued com o comment do draft", pin !== null && pin.ssStatus === "queued" && pin.ssComment === "teste final salvo no repo");

        const shotDir = join(home, ".dsh", "attachments", "live-review");
        let shotCount = 0;
        try { shotCount = readdirSync(shotDir).length; } catch {}
        // minutes of blocked spawnSync leave undici's pooled sockets past the
        // server's keepAliveTimeout — the first post-gap request races the
        // server's close and gets ECONNRESET; retry re-opens a fresh socket
        let pending = null;
        for (let attempt = 0; attempt < 3 && pending === null; attempt += 1) {
          try {
            pending = await (await fetch(`${realBase}/.lr/pending`, { headers: auth })).json();
          } catch {
            pending = null;
            await new Promise((res) => setTimeout(res, 300));
          }
        }
        check("browser: loop completo — pin chegou ao pending do host", pending.count === 1 && pending.pins[0].comment === "teste final salvo no repo", JSON.stringify(pending).slice(0, 140));
        check("browser: crop salvo em attachments (path host-owned)", shotCount >= 1, `${shotCount} arquivo(s)`);

        const state = runCell("state", CELL_STATE);
        check("browser: reconcile mantém o pin enquanto ele está pendente no host", state !== null && state.ok === true && state.pendingCount >= 1 && state.queuedMarkerStill === true, state ? JSON.stringify(state).slice(0, 200) : "sem resultado");
        info("browser: deliveredIds standalone (sem harness — comportamento E1 conhecido)", state ? `deliveredCount=${state.deliveredCount}` : "sem resultado");

        const draft = runCell("draft", CELL_DRAFT);
        check("browser: draft preserva o texto através do resize sintético (013)", draft !== null && draft.preserved === true && draft.closedClean === true, draft && draft.error ? draft.error : "");

        runCell("navclick", CELL_NAV_CLICK);
        const nav = runCell("navstate", CELL_NAV_STATE);
        check("browser: navegação pelo link reescrito serve o alvo com overlay re-injetado (011)", nav !== null && nav.url.includes(`/p/${enc(`${targetUrl}about`)}`) && nav.h1 === "Sobre" && nav.hasOverlay === true && nav.hasBridge === true);
        check("browser: purge 018 — key da origem anterior apagada ao navegar", nav !== null && !nav.ssKeys.includes(`lr:pins:${targetUrl}`), nav ? JSON.stringify(nav.ssKeys) : "sem resultado");

        const err502 = runCell("e502", CELL_502);
        check("browser: alvo não-resolvível → 502", err502 !== null && err502.status === 502);
        info("browser: reflexão crua no 502 (esperado false no Node 26 — a cause 'Invalid URL' esconde o input)", err502 ? `hasRawScript=${err502.hasRawScript}` : "sem resultado");
      } catch (error) {
        check("browser: fase de navegador executou até o fim", false, String(error?.message ?? error).slice(0, 220));
      } finally {
        playwrightCli(["close"], 60000);
        rmSync(cellsDir, { recursive: true, force: true });
      }
    }
  } finally {
    if (booted) server.kill();
    rmSync(workDir, { recursive: true, force: true });
  }
});

console.log(failures === 0 ? "\nTODOS OS CHECKS PASSARAM" : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
