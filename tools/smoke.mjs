import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import vm from "node:vm";
import { startServer, formatContext } from "../lib/index.js";

const enc = (u) => Buffer.from(u, "utf8").toString("base64url");
let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TARGET_PORT = 48001;
const target = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "script-src 'self'" });
    res.end(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"><link rel="stylesheet" href="/style.css"></head><body><h1 id="t">Alvo</h1><img src="/img.png"><a href="/about">sobre</a><script src="/app.js"></script></body></html>`);
  } else if (path === "/about") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body><h1>Sobre</h1></body></html>");
  } else if (path === "/style.css") {
    res.writeHead(200, { "content-type": "text/css" });
    res.end("body { background: url('/bg.png'); }");
  } else {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.from([0x89, 0x50]));
  }
});
await new Promise((r) => target.listen(TARGET_PORT, "127.0.0.1", r));

const lr = await startServer({ port: 47950 });
console.log(`plugin server on :${lr.port}, target on :${TARGET_PORT}`);
const base = `http://127.0.0.1:${lr.port}`;
const secret = readFileSync(join(homedir(), ".dsh", "profiles", "desktop", "dsh-redline", "instance.secret"), "utf8").trim();
const auth = { "x-dsh-redline-secret": secret };
const api = (extra) => ({ ...auth, ...(extra ?? {}) });
const targetUrl = `http://127.0.0.1:${TARGET_PORT}/`;

{
  const r = await fetch(`${base}/.lr/health`, { headers: auth });
  const j = await r.json();
  check("health", r.status === 200 && j.ok === true && j.port === lr.port);
}

{
  const denied = await fetch(`${base}/.lr/status`);
  check("auth: sem secret → 401", denied.status === 401 && denied.headers.get("access-control-allow-origin") === null);
  const wrong = await fetch(`${base}/.lr/status`, { headers: { "x-dsh-redline-secret": "0".repeat(64) } });
  check("auth: secret errado → 401", wrong.status === 401);
  const granted = await fetch(`${base}/.lr/status`, { headers: auth });
  check("auth: secret certo → 200", granted.status === 200);
  const attacker = await fetch(`${base}/.lr/status`, { headers: { origin: "https://example.com" } });
  check("auth: origin de terceiro sem secret → 401 sem CORS", attacker.status === 401 && attacker.headers.get("access-control-allow-origin") === null);
  const vendor = await fetch(`${base}/.lr/vendor/html2canvas.min.js`);
  check("vendor público para <script src>", vendor.status === 200 && (await vendor.text()).length > 1000);
}

let sessionCookie = "";
{
  const r = await fetch(`${base}/p/${enc(targetUrl)}`);
  const html = await r.text();
  const setCookie = r.headers.get("set-cookie") ?? "";
  sessionCookie = /lr_session=[a-z0-9-]+/i.exec(setCookie)?.[0] ?? "";
  check("page: status 200 + html", r.status === 200 && /text\/html/.test(r.headers.get("content-type") ?? ""));
  check("page: overlay injetado", html.includes("/.lr/overlay.js"));
  check("page: bridge injetado", html.includes("/.lr/bridge.js"));
  check("page: config window.__LR__", html.includes("window.__LR__="));
  check("page: CSP meta removida", !/http-equiv="Content-Security-Policy"/i.test(html));
  check("page: CSP header removido", !/content-security-policy/i.test(r.headers.get("content-type") ?? "") && (r.headers.get("content-security-policy") ?? "ausente") === "ausente");
  check("page: link a reescrito para /p/", html.includes(`/p/${enc(`http://127.0.0.1:${TARGET_PORT}/about`)}`));
  check("page: img reescrito para /.lr/proxy/", html.includes(`/.lr/proxy/${enc(`http://127.0.0.1:${TARGET_PORT}/img.png`)}`));
  check("page: script reescrito", html.includes(`/.lr/proxy/${enc(`http://127.0.0.1:${TARGET_PORT}/app.js`)}`));
  check("page: cookie de sessão emitido", sessionCookie !== "");
}

{
  const raw = await fetch(`${base}/p/http://127.0.0.1:${TARGET_PORT}/`);
  const rawHtml = await raw.text();
  check("page: forma CRUA com trailing slash", raw.status === 200 && rawHtml.includes("/.lr/overlay.js"), `status=${raw.status}`);
  const noScheme = await fetch(`${base}/p/127.0.0.1:${TARGET_PORT}`);
  check("page: forma SEM esquema", noScheme.status === 200 && (await noScheme.text()).includes("window.__LR__="), `status=${noScheme.status}`);
}

{
  const r = await fetch(`${base}/.lr/proxy/${enc(`http://127.0.0.1:${TARGET_PORT}/style.css`)}`, { headers: auth });
  const css = await r.text();
  check("css: reescrito url()", css.includes(`/.lr/proxy/${enc(`http://127.0.0.1:${TARGET_PORT}/bg.png`)}`));
}

{
  const r = await fetch(`${base}/.lr/overlay.js`, { headers: auth });
  check("overlay.js servido", r.status === 200 && /text\/javascript/.test(r.headers.get("content-type") ?? ""));
  const publicOverlay = await fetch(`${base}/.lr/overlay.js`);
  check("overlay.js é asset público (a tag <script> não manda header)", publicOverlay.status === 200);
  const publicBridge = await fetch(`${base}/.lr/bridge.js`);
  check("bridge.js é asset público", publicBridge.status === 200 && (await publicBridge.text()).includes("__LR_BRIDGE__"));
  const overlaySource = await r.text();
  const REQUIRED_SYMBOLS = [
    "function loadPins",
    "function savePins",
    "function renderPins",
    "function mountShadow",
    "function el(",
    "function setHint",
    "function postSnapshot",
    "function openAdjustPanel",
    "function wirePanelDrag",
    "const PANEL_POS_KEY",
    "const EDITABLE_PROPS",
    "const PROP_META",
    "const t = (key) =>"
  ];
  const missing = REQUIRED_SYMBOLS.filter((sym) => !overlaySource.includes(sym));
  check("overlay: símbolos do núcleo presentes", overlaySource.startsWith("// SPDX-License-Identifier: MIT") && missing.length === 0, missing.join(", "));
  const selfRef = overlaySource.slice(overlaySource.indexOf("const UI_LOCALES"), overlaySource.indexOf("const t = (key)")).match(/: t\("/g);
  check("overlay: locales sem autorreferência", selfRef === null, String(selfRef ? selfRef.length : 0));
}

{
  const r = await fetch(`${base}/about`, { headers: { cookie: sessionCookie } });
  const html = await r.text();
  check("fallthrough: /about proxiado ao alvo", r.status === 200 && html.includes("Sobre"));
  check("fallthrough: html do alvo reescrito", !html.includes("<base") && html.includes("window.__LR__="));
}

{
  const r = await fetch(`${base}/.lr/annotations`, { method: "OPTIONS", headers: { ...auth, origin: "https://example.com" } });
  check("v2: preflight OPTIONS 204 + CORS", r.status === 204 && r.headers.get("access-control-allow-origin") === "https://example.com" && r.headers.get("access-control-allow-headers")?.includes("x-dsh-redline-secret") === true);
  const s = await fetch(`${base}/.lr/status`, { headers: auth });
  const sj = await s.json();
  check("v2: status endpoint", s.status === 200 && sj.ok === true && Array.isArray(sj.events));
  const p = await fetch(`${base}/.lr/client-ping`, { method: "POST", headers: api({ "content-type": "application/json" }), body: JSON.stringify({ at: "smoke" }) });
  check("v2: client-ping", p.status === 200 && (await p.json()).ok === true);
}

{

  const SHOT = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  const shotDir = join(homedir(), ".dsh", "attachments", "live-review");
  const countShots = () => { try { return readdirSync(shotDir).length; } catch { return 0; } };
  const shotsBefore = countShots();
  const payload = {
    pageUrl: targetUrl,
    pageTitle: "Alvo",
    pins: [
      { id: "1", tag: "h1", selector: "body h1:nth-of-type(1)", text: "Alvo", comment: "mude o título", changes: [{ prop: "color", before: "#000", after: "red" }], shot: SHOT },
      { id: "2", tag: "img", selector: "body img:nth-of-type(1)", text: "", comment: "aumente a logo", changes: [] }
    ],
    screenshot: null
  };
  let r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: api({ "content-type": "application/json" }), body: JSON.stringify(payload) });
  let j = await r.json();
  check("annotations: pendente para próxima mensagem", r.status === 200 && j.ok === true && j.delivered === "pending-next-message" && j.kind === "pending" && j.count === 2, JSON.stringify(j).slice(0, 120));
  check("annotations: crop por pin salvo em attachments (+1 arquivo)", countShots() === shotsBefore + 1, `${shotsBefore} → ${countShots()}`);


  const newShot = readdirSync(shotDir).find((f) => f.endsWith(".jpg") || f.endsWith(".png"));
  let ar = await fetch(`${base}/.lr/attachments/${newShot}`, { headers: auth });
  check("attachments: recorte servido (200 image/jpeg)", ar.status === 200 && (ar.headers.get("content-type") ?? "").includes("image/") && (await ar.arrayBuffer()).byteLength > 0);
  ar = await fetch(`${base}/.lr/attachments/..%2F..%2Fsettings.yaml`, { headers: auth });
  check("attachments: traversal bloqueado (404)", ar.status === 404);
  ar = await fetch(`${base}/.lr/attachments/inexistente.jpg`, { headers: auth });
  check("attachments: arquivo inexistente (404)", ar.status === 404);



  payload.pins[0].screenshotPath = join(shotDir, "crop-simulado.jpg");
  const { text } = formatContext({ pageUrl: targetUrl, pageTitle: "Alvo", pins: payload.pins, screenshotPath: null });
  check("context: cabeçalho", text.startsWith("# Browser comments (Redline)"));
  check("context: seletor presente", text.includes("body h1:nth-of-type(1)"));
  check("context: comentário presente", text.includes("mude o título"));
  check("context: mudança visual presente", text.includes("color: #000 -> red"));
  check("context: screenshot por comentário presente", text.includes("Screenshot (cropped around the target)"));


  r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: api({ "content-type": "application/json" }), body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [], screenshot: null }) });
  j = await r.json();
  check("annotations: limpar pendente", r.status === 200 && j.kind === "cleared", JSON.stringify(j));
  r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: api({ "content-type": "application/json" }), body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [], screenshot: null }) });
  j = await r.json();
  check("annotations: limpar sem pendente", r.status === 200 && j.kind === "initial-empty", JSON.stringify(j));
  r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: api({ "content-type": "application/json" }), body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [], screenshot: null }) });
  j = await r.json();
  check("annotations: limpar sem pendente", r.status === 200 && j.kind === "initial-empty", JSON.stringify(j));
}

{
  // The bridge is the only route the page may reach without the instance
  // secret. Node lets us set Origin by hand; a browser sets it and forbids
  // scripts from changing it, which is the whole point of the check.
  const bridgeBody = (type, payload = {}) => JSON.stringify({ type, payload });
  const bridgePost = (type, payload = {}, headers = {}) =>
    fetch(`${base}/.lr/bridge`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: bridgeBody(type, payload) });

  const denied = await bridgePost("state.get");
  check("bridge: sem credencial → 401", denied.status === 401);

  const own = await bridgePost("state.get", {}, { origin: base });
  check("bridge: página do próprio host → 200", own.status === 200);
  const ownState = await own.json();
  check("bridge: state.get devolve só a projeção estreita", ownState.ok === true && typeof ownState.lang === "string" && Array.isArray(ownState.pendingIds) && ownState.settings !== undefined && ownState.events === undefined && ownState.diag === undefined, JSON.stringify(ownState).slice(0, 120));

  const foreign = await bridgePost("state.get", {}, { origin: "https://evil.example" });
  check("bridge: origem de terceiro → 401", foreign.status === 401);

  const unsupported = await bridgePost("settings.update", {}, { ...auth });
  check("bridge: tipo fora da allowlist → 400", unsupported.status === 400);

  const read = await fetch(`${base}/.lr/status`, { headers: { origin: base } });
  check("bridge: a origem do host não abre as rotas de leitura", read.status === 401);
  const control = await fetch(`${base}/.lr/settings`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ lang: "en" }) });
  check("bridge: a origem do host não abre as rotas de controle", control.status === 401);

  const submitted = await bridgePost("annotations.submit", { pageUrl: targetUrl, pageTitle: "Alvo", pins: [{ id: "b1", tag: "h1", selector: "#t", comment: "pela bridge" }] }, { origin: base });
  const submittedBody = await submitted.json();
  check("bridge: annotations.submit guarda o snapshot", submitted.status === 200 && submittedBody.ok === true && submittedBody.count === 1);
  const pending = await (await fetch(`${base}/.lr/pending`, { headers: auth })).json();
  check("bridge: o snapshot da bridge vira pendente", pending.count === 1 && pending.pins[0].comment === "pela bridge", JSON.stringify(pending).slice(0, 120));

  const drawings = await bridgePost("drawings.save", { items: [{ type: "stroke", x: 1, y: 2 }] }, { origin: base });
  check("bridge: drawings.save guarda os traços", drawings.status === 200 && (await drawings.json()).count === 1);
  const diag = await bridgePost("diag", { detail: "smoke" }, { origin: base });
  check("bridge: diag aceita a linha de diagnóstico", diag.status === 200 && (await diag.json()).ok === true);

  const emptied = await bridgePost("annotations.submit", { pageUrl: targetUrl, pageTitle: "Alvo", pins: [] }, { origin: base });
  const emptiedBody = await emptied.json();
  const stillPending = await (await fetch(`${base}/.lr/pending`, { headers: auth })).json();
  check("bridge: annotations.submit vazio não apaga o pendente", emptied.status === 200 && emptiedBody.kind === "empty" && stillPending.count === 1, JSON.stringify(emptiedBody).slice(0, 120));
}

{
  // The whole page path, end to end: the page the host serves carries the
  // relay and the overlay, the relay runs as a browser would run it (same
  // origin, Origin header, no credential), and the annotation lands in the
  // host.
  const page = await fetch(`${base}/p/${enc(targetUrl)}`);
  const pageHtml = await page.text();
  const config = JSON.parse(/window\.__LR__=(\{.*?\});window\.__LR_BRIDGE_MODE__/.exec(pageHtml)[1]);
  check("page: o config não carrega o segredo", !("secret" in config), Object.keys(config).join(", "));

  const relaySource = await (await fetch(`${base}/.lr/bridge.js`)).text();
  const windowStub = { __LR__: config };
  const sandbox = {
    window: windowStub,
    fetch: async (url, init) => {
      const headers = { ...(init.headers ?? {}), origin: base };
      return fetch(url, { ...init, headers });
    },
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(relaySource, sandbox, { filename: "bridge.js" });
  const answer = await windowStub.__LR_BRIDGE__.send("annotations.submit", {
    pageUrl: targetUrl,
    pageTitle: "Alvo",
    pins: [{ id: "e2e", tag: "h1", selector: "#t", comment: "pela página" }]
  });
  check("page: a anotação da página chega ao host", answer.ok === true && answer.count === 1, JSON.stringify(answer).slice(0, 140));
  const e2ePending = await (await fetch(`${base}/.lr/pending`, { headers: auth })).json();
  check("page: a anotação fica pendente para a próxima mensagem", e2ePending.count === 1 && e2ePending.pins[0].comment === "pela página", JSON.stringify(e2ePending).slice(0, 140));
  await fetch(`${base}/.lr/bridge`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ type: "annotations.submit", payload: { pageUrl: targetUrl, pageTitle: "Alvo", pins: [] } }) });
}

{
  const r = await fetch(`${base}/p/nao-e-url`);
  check("page: alvo inválido → 400 com uso", r.status === 400 && (await r.text()).includes("Redline"));
}

target.close();
lr.close();
console.log(failures === 0 ? "\nTODOS OS CHECKS PASSARAM" : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
