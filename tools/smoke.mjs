import { createServer } from "node:http";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
const targetUrl = `http://127.0.0.1:${TARGET_PORT}/`;

{
  const r = await fetch(`${base}/.lr/health`);
  const j = await r.json();
  check("health", r.status === 200 && j.ok === true && j.port === lr.port);
}

let sessionCookie = "";
{
  const r = await fetch(`${base}/p/${enc(targetUrl)}`);
  const html = await r.text();
  const setCookie = r.headers.get("set-cookie") ?? "";
  sessionCookie = /lr_session=[a-z0-9-]+/i.exec(setCookie)?.[0] ?? "";
  check("page: status 200 + html", r.status === 200 && /text\/html/.test(r.headers.get("content-type") ?? ""));
  check("page: overlay injetado", html.includes("/.lr/overlay.js"));
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
  const r = await fetch(`${base}/.lr/proxy/${enc(`http://127.0.0.1:${TARGET_PORT}/style.css`)}`);
  const css = await r.text();
  check("css: reescrito url()", css.includes(`/.lr/proxy/${enc(`http://127.0.0.1:${TARGET_PORT}/bg.png`)}`));
}

{
  const r = await fetch(`${base}/.lr/overlay.js`);
  check("overlay.js servido", r.status === 200 && /text\/javascript/.test(r.headers.get("content-type") ?? ""));
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
  const r = await fetch(`${base}/.lr/annotations`, { method: "OPTIONS" });
  check("v2: preflight OPTIONS 204 + CORS", r.status === 204 && r.headers.get("access-control-allow-origin") === "*");
  const s = await fetch(`${base}/.lr/status`);
  const sj = await s.json();
  check("v2: status endpoint", s.status === 200 && sj.ok === true && Array.isArray(sj.events));
  const p = await fetch(`${base}/.lr/client-ping`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ at: "smoke" }) });
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
  let r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  let j = await r.json();
  check("annotations: pendente para próxima mensagem", r.status === 200 && j.ok === true && j.delivered === "pending-next-message" && j.kind === "pending" && j.count === 2, JSON.stringify(j).slice(0, 120));
  check("annotations: crop por pin salvo em attachments (+1 arquivo)", countShots() === shotsBefore + 1, `${shotsBefore} → ${countShots()}`);


  const newShot = readdirSync(shotDir).find((f) => f.endsWith(".jpg") || f.endsWith(".png"));
  let ar = await fetch(`${base}/.lr/attachments/${newShot}`);
  check("attachments: recorte servido (200 image/jpeg)", ar.status === 200 && (ar.headers.get("content-type") ?? "").includes("image/") && (await ar.arrayBuffer()).byteLength > 0);
  ar = await fetch(`${base}/.lr/attachments/..%2F..%2Fsettings.yaml`);
  check("attachments: traversal bloqueado (404)", ar.status === 404);
  ar = await fetch(`${base}/.lr/attachments/inexistente.jpg`);
  check("attachments: arquivo inexistente (404)", ar.status === 404);



  payload.pins[0].screenshotPath = join(shotDir, "crop-simulado.jpg");
  const { text } = formatContext({ pageUrl: targetUrl, pageTitle: "Alvo", pins: payload.pins, screenshotPath: null });
  check("context: cabeçalho", text.startsWith("# Browser comments (Redline)"));
  check("context: seletor presente", text.includes("body h1:nth-of-type(1)"));
  check("context: comentário presente", text.includes("mude o título"));
  check("context: mudança visual presente", text.includes("color: #000 -> red"));
  check("context: screenshot por comentário presente", text.includes("Screenshot (cropped around the target)"));


  r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [], screenshot: null }) });
  j = await r.json();
  check("annotations: limpar pendente", r.status === 200 && j.kind === "cleared", JSON.stringify(j));
  r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [], screenshot: null }) });
  j = await r.json();
  check("annotations: limpar sem pendente", r.status === 200 && j.kind === "initial-empty", JSON.stringify(j));
  r = await fetch(`${base}/.lr/annotations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageUrl: targetUrl, pageTitle: "Alvo", pins: [], screenshot: null }) });
  j = await r.json();
  check("annotations: limpar sem pendente", r.status === 200 && j.kind === "initial-empty", JSON.stringify(j));
}

{
  const r = await fetch(`${base}/p/nao-e-url`);
  check("page: alvo inválido → 400 com uso", r.status === 400 && (await r.text()).includes("Redline"));
}

target.close();
lr.close();
console.log(failures === 0 ? "\nTODOS OS CHECKS PASSARAM" : `\n${failures} FALHA(S)`);
process.exit(failures === 0 ? 0 : 1);
