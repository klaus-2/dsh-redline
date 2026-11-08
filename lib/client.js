// SPDX-License-Identifier: MIT
(() => {
  "use strict";
  const ID = "dsh-redline";
  const API_PORTS = [47477, 47478, 47479, 47480, 47481, 47482, 47483, 47484, 47485, 47486, 47487, 47488, 47489, 47490, 47491, 47492, 47493, 47494, 47495, 47496];
  let API_BASE = "http://127.0.0.1:47477";
  const SECRET_ROUTE = "/api/dsh-redline.secret";
  const SECRET_HEADER = "x-dsh-redline-secret";
  let INSTANCE_SECRET = "";
  const UPDATE_KEY = "dsh-redline.updated";
  let updateManager = undefined;

  async function resolveInstanceSecret() {
    if (INSTANCE_SECRET !== "") return INSTANCE_SECRET;
    try {
      const r = await fetch(SECRET_ROUTE, { cache: "no-store" });
      const j = await r.json();
      if (j && j.ok && typeof j.secret === "string" && j.secret !== "") INSTANCE_SECRET = j.secret;
    } catch {}
    return INSTANCE_SECRET;
  }

  function authHeaders(extra) {
    const headers = { ...(extra ?? {}) };
    if (INSTANCE_SECRET !== "") headers[SECRET_HEADER] = INSTANCE_SECRET;
    return headers;
  }
  let React = null;
  async function resolveApiBase() {
    for (const port of API_PORTS) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/.lr/health`, { cache: "no-store" });
        if (r.ok) { API_BASE = `http://127.0.0.1:${port}`; await resolveInstanceSecret(); return API_BASE; }
      } catch {}
    }
    await resolveInstanceSecret();
    return API_BASE;
  }


  function RedlineSettings() {
    const [state, setState] = React.useState({ loaded: false, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "", update: null, checking: false, error: "", capture: null, saved: 0, installing: false, installed: "", installError: "" });
    const remembered = () => { try { return localStorage.getItem(UPDATE_KEY) ?? ""; } catch { return ""; } };
    const reload = React.useCallback(async () => {
      try {
        const r = await fetch(API_BASE + "/.lr/settings", { cache: "no-store", headers: authHeaders() });
        const j = await r.json();
        if (j.ok) setState((prev) => ({ ...prev, loaded: true, settings: j.settings, version: j.version, update: j.update ?? prev.update }));
      } catch {
        const pending = remembered();
        setState((prev) => (pending === "" ? { ...prev, error: "unreachable" } : { ...prev, error: "", installed: pending }));
      }
    }, []);
    React.useEffect(() => { reload(); }, [reload]);
    const save = async (patch) => {
      const merged = { ...state.settings, ...patch, keys: { ...state.settings.keys, ...(patch.keys ?? {}) } };
      setState((prev) => ({ ...prev, settings: merged }));
      try {
        await fetch(API_BASE + "/.lr/settings", { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify(merged) });
        setState((prev) => ({ ...prev, saved: Date.now() }));
      } catch {}
    };
    const checkUpdate = async () => {
      setState((prev) => ({ ...prev, checking: true }));
      try {
        const r = await fetch(API_BASE + "/.lr/update", { cache: "no-store", headers: authHeaders() });
        const j = await r.json();
        setState((prev) => ({ ...prev, checking: false, update: j.update ?? null, version: j.version ?? prev.version }));
      } catch { setState((prev) => ({ ...prev, checking: false })); }
    };
    React.useEffect(() => { checkUpdate(); }, []);
    const lang = state.settings.lang === "auto" ? ((navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en") : state.settings.lang;
    const L = {
      en: { title: "Point at elements on the page — the agent fixes the code", lang: "Language", langDesc: "Overlay and chat card language. Auto follows this app.", auto: "Auto (follow the app)", hotkeys: "Shortcuts", hotkeyComment: "Comment mode key", hotkeyAdjust: "Adjust mode key", capture: "Click here and press a key", screenshot: "Screenshot", screenshotDesc: "Attach a cropped screenshot of the marked region with each pin", pad: "Context padding (px)", links: "Project", repo: "GitHub repository", issues: "Report an issue", update: "Updates", current: "Current version", check: "Check for updates", checking: "Checking…", upToDate: "You are on the latest version", available: "Update available", open: "Open release page", none: "No releases published yet", updateNow: "Update now", installingMsg: "Installing {v}...", installedMsg: "Version {v} was installed. Restart the dsh to use it.", localDev: "Local development copy — update with git pull.", error: "Update check failed", unreachable: "Redline service unreachable", savedNote: "Saved" },
      pt: { title: "Aponte para elementos da página — o agente corrige o código", lang: "Idioma", langDesc: "Idioma do overlay e do card no chat. Auto segue este aplicativo.", auto: "Automático (segue o app)", hotkeys: "Atalhos", hotkeyComment: "Tecla do modo comentário", hotkeyAdjust: "Tecla do modo ajuste", capture: "Clique aqui e pressione uma tecla", screenshot: "Screenshot", screenshotDesc: "Anexa um recorte da região marcada a cada pin", pad: "Margem de contexto (px)", links: "Projeto", repo: "Repositório no GitHub", issues: "Reportar um problema", update: "Atualizações", current: "Versão atual", check: "Verificar atualizações", checking: "Verificando…", upToDate: "Você está na versão mais recente", available: "Atualização disponível", open: "Abrir página da versão", none: "Nenhuma versão publicada ainda", updateNow: "Atualizar agora", installingMsg: "Instalando {v}...", installedMsg: "A versão {v} foi instalada. Reinicie o dsh para usá-la.", localDev: "Cópia de desenvolvimento local — atualize com git pull.", error: "Falha ao verificar atualizações", unreachable: "Serviço do Redline inacessível", savedNote: "Salvo" },
      zh: { title: "指向页面元素 — 智能体直接改代码", lang: "语言", langDesc: "浮层与聊天卡片语言。自动跟随本应用。", auto: "自动（跟随应用）", hotkeys: "快捷键", hotkeyComment: "评论模式键", hotkeyAdjust: "调整模式键", capture: "点击后按下按键", screenshot: "截图", screenshotDesc: "为每个标注附加标记区域的裁剪截图", pad: "上下文边距（px）", links: "项目", repo: "GitHub 仓库", issues: "报告问题", update: "更新", current: "当前版本", check: "检查更新", checking: "检查中…", upToDate: "已是最新版本", available: "有可用更新", open: "打开发布页", none: "尚未发布任何版本", updateNow: "立即更新", installingMsg: "正在安装 {v}...", installedMsg: "版本 {v} 已安装。重启 dsh 以使用。", localDev: "本地开发副本 — 请用 git pull 更新。", error: "检查更新失败", unreachable: "Redline 服务不可达", savedNote: "已保存" }
    }[lang];
    const row = (label, desc, control, key) => React.createElement("div", { key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "14px 0", borderBottom: ".5px solid var(--dsw-alias-border-l2)" }, title: desc },
      React.createElement("div", { style: { minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 13, color: "var(--dsw-alias-label-primary)" } }, label),
        desc ? React.createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", marginTop: 2 } }, desc) : null),
      React.createElement("div", { style: { flex: "none", display: "flex", alignItems: "center", gap: 8 } }, control));
    const selectStyle = { background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, padding: "5px 8px", fontSize: 13 };
    const linkStyle = { background: "none", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, padding: "5px 10px", color: "var(--dsw-alias-label-primary)", fontSize: 13, cursor: "pointer", textDecoration: "none" };
    const captureKey = (which) => {
      setState((prev) => ({ ...prev, capture: which }));
      const handler = (e) => {
        e.preventDefault();
        if (/^[a-z0-9]$/i.test(e.key)) save({ keys: { ...state.settings.keys, [which]: e.key.toLowerCase() } });
        window.removeEventListener("keydown", handler, true);
        setState((prev) => ({ ...prev, capture: null }));
      };
      window.addEventListener("keydown", handler, true);
    };
    const installUpdate = async () => {
      const latest = (state.update?.latest ?? "").replace(/^v/, "");
      if (latest === "") return;
      setState((prev) => ({ ...prev, installing: true, installed: "", installError: "" }));
      const requestId = ID + "-update-" + latest + "-" + Date.now();
      try {
        if (updateManager !== undefined && typeof updateManager.installBundle === "function") {
          const remember = (value) => { try { localStorage.setItem(UPDATE_KEY, value); } catch {} };
          const installSpec = async (spec) => {
            const reply = await updateManager.installBundle(spec, { requestId });
            if (!reply?.ok) throw new Error(reply?.error?.message ?? "plugin manager did not answer");
            return reply.value;
          };
          let result = await installSpec("dsh-redline@" + latest);
          if (result?.error?.code === "already-installed") {
            result = await installSpec("https://registry.npmjs.org/dsh-redline/-/dsh-redline-" + latest + ".tgz");
          }
          const lines = String(result?.error?.diagnostic ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
          const reason = lines.find((line) => line.startsWith("dsh:")) ?? lines.at(-1) ?? result?.error?.code ?? "install failed";
          const live = result?.application === "applied";
          if (!live && result?.application !== "restart-required" && result?.version !== latest) {
            setState((prev) => ({ ...prev, installing: false, installError: String(reason).slice(0, 160) }));
            return;
          }
          const applied = live ? latest : (result?.version ?? latest);
          remember(applied);
          setState((prev) => ({ ...prev, installing: false, installed: applied }));
          return;
        }
        const r = await fetch(API_BASE + "/.lr/update/install", { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ version: latest }) });
        const j = await r.json().catch(() => ({}));
        if (j.ok) {
          try { localStorage.setItem(UPDATE_KEY, j.installed ?? latest); } catch {}
          setState((prev) => ({ ...prev, installing: false, installed: j.installed ?? latest }));
        }
        else setState((prev) => ({ ...prev, installing: false, installError: j.error === "local-development" ? "local-development" : String(j.error ?? "install failed").slice(0, 160) }));
      } catch (error) {
        setState((prev) => ({ ...prev, installing: false, installError: String(error?.message ?? error).slice(0, 160) }));
      }
    };
    const u = state.update;
    const installedNewer = u !== null && typeof u.installed === "string" && u.installed !== "" && u.installed !== state.version;
    const updateStatus = u === null ? L.none : u.error ? L.error + " (" + u.error + ")" : installedNewer ? L.installedMsg.replace("{v}", u.installed) : state.installing ? L.installingMsg.replace("{v}", (u.latest ?? "").replace(/^v/, "")) : u.newer ? L.available + ": " + u.latest : L.upToDate;
    return React.createElement("div", { "data-dsh-redline-settings": "" },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, paddingBottom: 8 } },
        React.createElement("img", { src: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="54" viewBox="0 0 96 54"><rect width="96" height="54" rx="6" fill="#101214"/><rect x="8" y="20" width="30" height="12" rx="3" fill="#e5484d"><animate attributeName="fill" values="#e5484d;#60a5fa;#e5484d" dur="3s" repeatCount="indefinite"/></rect><rect x="8" y="14" width="34" height="24" rx="5" fill="none" stroke="#f59e0b" stroke-width="1.5"><animate attributeName="opacity" values="0;1;1;0" dur="3s" repeatCount="indefinite"/></rect><rect x="52" y="12" width="36" height="16" rx="4" fill="#1f242b" stroke="#2a2f36"/><text x="70" y="23" text-anchor="middle" fill="#34d399" font-size="6" font-family="monospace">1 pin ✓</text><text x="52" y="44" fill="#6b7280" font-size="6" font-family="monospace">agent applied the change</text></svg>'), width: 96, height: 54, alt: "", style: { borderRadius: 6, border: "1px solid var(--dsw-alias-border-l1)", flex: "none" }, title: L.title }),
        React.createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary)", lineHeight: "18px" } }, L.title)),
      state.error !== "" ? React.createElement("div", { style: { color: "var(--dsw-state-error-primary, #ec1313)", fontSize: 12, padding: "8px 0" } }, L.unreachable + " (" + state.error + ")") : null,
      row(L.lang, L.langDesc, React.createElement("select", { value: state.settings.lang, style: selectStyle, onChange: (e) => save({ lang: e.target.value }), "aria-label": L.lang },
        React.createElement("option", { value: "auto" }, L.auto),
        React.createElement("option", { value: "en" }, "English"),
        React.createElement("option", { value: "pt" }, "Português (Brasil)"),
        React.createElement("option", { value: "zh" }, "简体中文")), "lang"),
      row(L.hotkeyComment, L.capture, React.createElement("input", { readOnly: true, value: state.capture === "comment" ? L.capture : (state.settings.keys.comment || "c").toUpperCase(), onClick: () => captureKey("comment"), style: { ...selectStyle, width: 90, textAlign: "center", cursor: "pointer", fontFamily: "ui-monospace, monospace" }, "aria-label": L.hotkeyComment, title: L.capture }), "key-comment"),
      row(L.hotkeyAdjust, L.capture, React.createElement("input", { readOnly: true, value: state.capture === "adjust" ? L.capture : (state.settings.keys.adjust || "v").toUpperCase(), onClick: () => captureKey("adjust"), style: { ...selectStyle, width: 90, textAlign: "center", cursor: "pointer", fontFamily: "ui-monospace, monospace" }, "aria-label": L.hotkeyAdjust, title: L.capture }), "key-adjust"),
      row(L.screenshot, L.screenshotDesc, React.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" } },
        React.createElement("input", { type: "checkbox", checked: state.settings.screenshot === true, onChange: (e) => save({ screenshot: e.target.checked }), "aria-label": L.screenshot }),
        React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--dsw-alias-label-tertiary)", fontSize: 12 } },
          L.pad,
          React.createElement("input", { type: "number", min: 16, max: 200, value: state.settings.cropPad, onChange: (e) => save({ cropPad: Number(e.target.value) }), style: { ...selectStyle, width: 64 }, "aria-label": L.pad }))), "shot"),
      row(L.links, "", React.createElement("div", { style: { display: "flex", gap: 8 } },
        React.createElement("a", { href: "https://github.com/klaus-2/dsh-redline", target: "_blank", rel: "noreferrer", style: linkStyle, title: L.repo }, L.repo),
        React.createElement("a", { href: "https://github.com/klaus-2/dsh-redline/issues", target: "_blank", rel: "noreferrer", style: linkStyle, title: L.issues }, L.issues)), "links"),
      row(L.update, React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 8px", minWidth: 0 } },
        React.createElement("span", null, L.current + ": " + (state.version || state.installed || "—")),
        React.createElement("span", { style: { color: installedNewer || state.installing ? "var(--dsw-alias-state-success-primary, #22c55e)" : u !== null && u.newer ? "var(--dsw-alias-state-success-primary, #22c55e)" : "var(--dsw-alias-label-tertiary)" } }, state.checking ? L.checking : updateStatus)),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "flex-end", flex: "none" } },
        u !== null && u.newer && !installedNewer ? React.createElement("button", { onClick: installUpdate, disabled: state.installing, style: { ...linkStyle, fontWeight: 600, opacity: state.installing ? 0.6 : 1, cursor: state.installing ? "wait" : "pointer" } }, L.updateNow) : null,
        React.createElement("button", { onClick: checkUpdate, style: linkStyle }, L.check),
        u !== null && typeof u.url === "string" && u.url !== "" ? React.createElement("a", { href: u.url, target: "_blank", rel: "noreferrer", style: linkStyle, title: L.open }, L.open) : null), "update"),
      state.installError !== "" ? React.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, padding: "8px 0" } }, state.installError === "local-development" ? L.localDev : L.error + " (" + state.installError + ")") : null,
      state.installed !== "" && state.installed !== state.version ? React.createElement("div", { style: { color: "var(--dsw-alias-state-success-primary, #22c55e)", fontSize: 12, padding: "8px 0" } }, L.installedMsg.replace("{v}", state.installed)) : null,
      state.saved ? React.createElement("div", { style: { color: "var(--dsw-alias-state-success-primary, #22c55e)", fontSize: 12, paddingBottom: 10 } }, "✓ " + L.savedNote) : null);
  }

  function registerSettingsSection(ctx) {
    ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: "dsh-redline",
      order: 95,
      label: () => "Redline",
      inject: () => ({})
    }, RedlineSettings));
  }

  function buildPlugin(require) {
      const UI_LOCALES = {"en":{"viewPending":"View pending annotations","sendNow":"Send the annotations to the agent now","sendBtn":"Send","discard":"Discard annotations","removePin":"Remove this pin","noComment":"(no comment)","commentTool":"Comment","sendPrompt":"Apply the page annotations."},"pt":{"viewPending":"Ver as anotações pendentes","sendNow":"Enviar as anotações ao agente agora","sendBtn":"Enviar","discard":"Descartar anotações","removePin":"Remover este pin","noComment":"(sem comentário)","commentTool":"Comentar","sendPrompt":"Aplique as anotações da página."},"zh":{"viewPending":"查看待发送标注","sendNow":"立即把标注发送给智能体","sendBtn":"发送","discard":"丢弃标注","removePin":"移除此标注","noComment":"（无评论）","commentTool":"评论","sendPrompt":"应用页面批注。"}};
  const UI_LANG = (() => { const l = (navigator.language || "en").toLowerCase(); return l.startsWith("pt") ? "pt" : l.startsWith("zh") ? "zh" : "en"; })();
  const t = (key) => UI_LOCALES[UI_LANG][key] ?? UI_LOCALES.en[key] ?? key;

    try { React = require("react"); } catch { log("react indisponível no client — card do composer desativado"); }
    const h = React ? React.createElement : () => null;
    let started = false;
    let apiReady = null;
    let clientCtx = null;
    let lastViewedSession = "";
    let overlaySource;
    let bridgeSource;
    let bridgePumpTimer;

    const injected = new WeakSet();

    const attemptCount = new WeakMap();
    const evtLog = [];
    let lastReport = "";

    function log(...args) {
      try {
        console.info("[live-review client]", ...args);
      } catch {}
    }

    async function report(payload) {
      try {
        evtLog.push({ at: payload.at ?? new Date().toISOString(), kind: payload.kind, detail: payload.detail ?? payload.sessionId ?? payload.error ?? "" });
        if (evtLog.length > 8) evtLog.shift();
        const body = JSON.stringify({ ...payload, history: evtLog.slice(-6) });
        if (body === lastReport) return;
        lastReport = body;
        await fetch(`${API_BASE}/.lr/client-ping`, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body
        });
      } catch {}
    }

    async function loadOverlaySource() {
      if (overlaySource !== undefined) return overlaySource;
      try {
        const response = await fetch(`${API_BASE}/.lr/overlay.js`, { cache: "no-store", headers: authHeaders() });
        if (!response.ok) return null;
        overlaySource = await response.text();
        return overlaySource;
      } catch {
        return null;
      }
    }

    async function loadBridgeSource() {
      if (bridgeSource !== undefined) return bridgeSource;
      try {
        const response = await fetch(`${API_BASE}/.lr/bridge.js`, { cache: "no-store", headers: authHeaders() });
        if (!response.ok) return null;
        bridgeSource = await response.text();
        return bridgeSource;
      } catch {
        return null;
      }
    }

    async function inject(webview) {
      if (injected.has(webview)) return;
      const attempts = (attemptCount.get(webview) ?? 0) + 1;
      attemptCount.set(webview, attempts);
      const url = String(webview.getAttribute?.("src") ?? "");
      if (url === "" || url.startsWith("about:") || url.startsWith("devtools:") || url.startsWith("chrome")) return;
      const source = await loadOverlaySource();
      const relay = await loadBridgeSource();
      if (source === null || relay === null) {
        await report({ kind: "inject-fail", at: new Date().toISOString(), url: url.slice(0, 80), error: source === null ? "overlay source indisponível" : "bridge source indisponível" });
        return;
      }
      try {
        // The page keeps the config it already has (settings, drawings); the
        // client only adds what the page cannot know. The instance secret
        // never crosses into the page: the bridge answers from the host.
        const config = JSON.stringify({ apiBase: API_BASE, injectedBy: "webview" });
        await webview.executeJavaScript(
          `window.__LR__ = Object.assign({}, window.__LR__ || {}, ${config});\nwindow.__LR_BRIDGE_MODE__ = window.__LR_BRIDGE__ ? window.__LR_BRIDGE_MODE__ : "client";\n${relay}\n${source}`,
          false
        );
        injected.add(webview);
        await report({ kind: "inject-ok", at: new Date().toISOString(), url: url.slice(0, 80) });
      } catch (error) {
        await report({ kind: "inject-fail", at: new Date().toISOString(), url: url.slice(0, 80), error: String(error).slice(0, 160) });
      }
    }

    // The guest has no channel back to the app: the DSH browser webview runs
    // with nodeIntegration off, contextIsolation on and no preload, so there
    // is no ipcRenderer and no ipc-message. The only door is the one the
    // plugin opens itself: the client drains the queue the page left behind
    // and answers it, with the instance secret held here in the app context.
    const bridgeBusy = new WeakMap();
    const BRIDGE_BATCH = 20;

    async function bridgeCall(message) {
      const type = typeof message?.type === "string" ? message.type : "";
      const payload = message?.payload !== null && typeof message?.payload === "object" ? message.payload : {};
      try {
        const response = await fetch(`${API_BASE}/.lr/bridge`, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ type, payload })
        });
        const data = await response.json().catch(() => ({}));
        return { id: message.id, ok: response.ok && data.ok === true, data, error: data.error ?? (response.ok ? "" : `HTTP ${response.status}`) };
      } catch (error) {
        return { id: message.id, ok: false, data: null, error: String(error?.message ?? error).slice(0, 120) };
      }
    }

    async function drainBridge(webview) {
      const raw = await webview.executeJavaScript(`window.__LR_BRIDGE_DRAIN__ ? window.__LR_BRIDGE_DRAIN__(${BRIDGE_BATCH}) : '[]'`, false);
      const messages = JSON.parse(typeof raw === "string" ? raw : "[]");
      for (const message of messages.slice(0, BRIDGE_BATCH)) {
        const answer = await bridgeCall(message);
        // The relay reads a JSON array of answers.
        const payload = JSON.stringify(JSON.stringify([answer]));
        await webview.executeJavaScript(`window.__LR_BRIDGE_DELIVER__ ? window.__LR_BRIDGE_DELIVER__(${payload}) : null`, false);
      }
    }

    async function pumpBridge() {
      for (const webview of [...document.querySelectorAll("webview")]) {
        if (!injected.has(webview)) continue;
        if (bridgeBusy.get(webview) === true) continue;
        bridgeBusy.set(webview, true);
        try {
          await drainBridge(webview);
        } catch (error) {
          // A transport that is down must not be silent: the host log is the
          // only place where this shows up.
          await report({ kind: "diag", at: new Date().toISOString(), detail: `bridge: ${String(error?.message ?? error).slice(0, 160)}` }).catch(() => {});
        } finally {
          bridgeBusy.set(webview, false);
        }
      }
    }

    function startBridgePump() {
      if (bridgePumpTimer !== undefined) return;
      bridgePumpTimer = setInterval(() => {
        pumpBridge().catch(() => {});
      }, 200);
    }

    function wireWebview(webview) {
      if (!(webview instanceof Element) || webview.dataset.liveReviewWired === "1") return;
      webview.dataset.liveReviewWired = "1";
      webview.addEventListener("dom-ready", () => {
        setTimeout(() => inject(webview), 60);
      });
      webview.addEventListener("did-navigate", () => {
        injected.delete(webview);
        setTimeout(() => inject(webview), 120);
      });
      webview.addEventListener("did-navigate-in-page", () => {
        injected.delete(webview);
        setTimeout(() => inject(webview), 120);
      });
      [400, 1500, 4000, 8000].forEach((delay) => {
        setTimeout(() => inject(webview), delay);
      });
    }

    function scan() {
      document.querySelectorAll('webview[data-sidebar-browser-frame="webview"]').forEach(wireWebview);
      document.querySelectorAll("webview:not([data-live-review-wired])").forEach(wireWebview);
    }


    function createViewCapture() {
      return function ViewCaptureTail(props) {
        try {
          const sid = String(props?.sessionId ?? props?.session?.id ?? "");
          if (sid !== "" && sid !== lastViewedSession) {
            lastViewedSession = sid;
            report({ kind: "view", at: new Date().toISOString(), sessionId: sid });
          }
        } catch {}
        return null;
      };
    }



    const BAR_CSS = `
      .lr-dock, .lr-dock *, .lr-dock :before, .lr-dock :after { box-sizing: border-box; }
      .lr-dock { z-index: 4; width: calc(100% - var(--dsh-composer-side-clearance, 12px) * 2 - var(--dsh-composer-dock-inset, 8px) * 4);
        max-width: calc(var(--dsh-composer-card-max-width, 780px) - 4 * var(--dsh-composer-dock-inset, 8px));
        font-family: Inter, var(--dsw-font-family, system-ui, sans-serif); flex: none; margin: 0 auto; position: relative; }
      .lr-anchor { width: fit-content; max-width: 100%; position: relative; }
      .lr-capsule { border: 1px solid var(--dsw-alias-border-l1, #00000014); background: var(--dsw-specific-tip, #f7f8fa);
        max-width: 100%; height: 36px; color: var(--dsw-alias-label-primary, #17191c); border-radius: 12px;
        align-items: center; display: inline-flex; overflow: hidden; box-shadow: 0 1px 2px #00000008; }
      .lr-summary { min-width: 0; height: 100%; color: inherit; cursor: pointer; background: 0 0; border: 0;
        align-items: center; gap: 8px; padding: 4px 8px 4px 12px; display: flex; }
      .lr-summary:hover, .lr-clear:hover, .lr-remove:hover { background: var(--dsw-alias-interactive-bg-hover, #2631480f); }
      .lr-lead { color: var(--dsw-alias-label-tertiary, #61666b); flex: none; place-items: center; display: grid; }
      .lr-count { text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: 24px; overflow: hidden; }
      .lr-clear { color: var(--dsw-alias-label-tertiary, #61666b); cursor: pointer; background: 0 0; border: 0;
        flex: none; place-items: center; padding: 0; display: grid; border-left: 1px solid var(--dsw-alias-border-l1, #00000014); width: 32px; height: 100%; }
      .lr-details { z-index: 20; border: 1px solid var(--dsw-alias-border-l1, #00000014);
        background: var(--dsw-alias-bg-base, #fff); border-radius: 14px; width: min(420px, 100vw - 32px);
        max-height: min(360px, 52vh); position: absolute; bottom: calc(100% + 8px); left: 0; overflow: auto;
        box-shadow: 0 12px 32px #0000001f, 0 2px 8px #0000000f; }
      .lr-list { margin: 0; padding: 6px; list-style: none; }
      .lr-row { border-radius: 10px; min-width: 0; display: flex; position: relative; }
      .lr-row + .lr-row { border-top: 1px solid var(--dsw-alias-border-l1, #00000014); }
      .lr-row:hover { background: var(--dsw-alias-interactive-bg-hover, #2631480f); }
      .lr-row-main { min-width: 0; color: inherit; text-align: left; cursor: pointer; background: 0 0; border: 0;
        border-radius: 10px; flex-direction: column; flex: auto; gap: 7px; padding: 10px 38px 10px 10px; display: flex; }
      .lr-target-line { align-items: center; gap: 7px; min-width: 0; display: flex; }
      .lr-index { background: var(--dsw-alias-state-business-primary, #e5484d); width: 18px; height: 18px;
        color: var(--dsw-alias-label-primary-foreground, #fff); border-radius: 999px; flex: none; place-items: center;
        font-size: 11px; font-weight: 600; line-height: 18px; display: grid; }
      .lr-badge { border: 1px solid var(--dsw-alias-border-l1, #00000014); background: var(--dsw-alias-bg-module-platform, #f5f6f7);
        max-width: 96px; color: var(--dsw-alias-label-tertiary, #61666b);
        font: 12px/18px var(--ds-font-family-code, ui-monospace, monospace); text-overflow: ellipsis; white-space: nowrap;
        border-radius: 999px; flex: none; padding: 1px 7px; overflow: hidden; }
      .lr-target { min-width: 0; color: var(--dsw-alias-label-secondary, #4b4f57); text-overflow: ellipsis;
        white-space: nowrap; font-size: 13px; line-height: 20px; overflow: hidden; }
      .lr-comment { color: var(--dsw-alias-label-primary, #17191c); white-space: pre-wrap; font-size: 14px;
        font-weight: 500; line-height: 21px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4;
        -webkit-box-orient: vertical; }
      .lr-remove { opacity: 0; border-radius: 999px; width: 28px; height: 28px; position: absolute; top: 7px; right: 7px;
        color: var(--dsw-alias-label-tertiary, #61666b); cursor: pointer; background: 0 0; border: 0; flex: none;
        place-items: center; padding: 0; display: grid; }
      .lr-row:hover .lr-remove, .lr-remove:focus-visible { opacity: 1; }
      .lr-tip { position: absolute; bottom: calc(100% + 10px); left: 0; width: max-content; max-width: 300px;
        background: #16181d; color: #eef0f3; border-radius: 12px; padding: 12px 14px;
        box-shadow: 0 12px 32px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.07);
        font-family: Inter, var(--dsw-font-family, system-ui, sans-serif); pointer-events: none; }
      .lr-tip-title { font-size: 14px; font-weight: 600; color: #ffffff; margin: 0 0 6px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lr-tip-target { font-size: 13px; color: #9aa0aa; margin: 0 0 6px; }
      .lr-tip-target code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .lr-tip-page { font-size: 12px; color: #6d7480; margin: 0; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; }
    `;

    function injectBarStyles() {
      if (document.querySelector("style[data-plugin-css='dsh-redline/bar']")) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-redline";
      tag.dataset.pluginCss = "dsh-redline/bar";
      tag.textContent = BAR_CSS;
      document.head.appendChild(tag);
    }






    const SEND_PROMPT_KEY = "sendPrompt";

    function composerTextarea() {
      const visible = [...document.querySelectorAll("textarea")].filter((t) => t.offsetParent !== null);
      return visible.length > 0 ? visible[visible.length - 1] : null;
    }

    function setComposerValue(textarea, text) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(textarea, text);
      else textarea.value = text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function sessionTarget(sessionId) {
      const sessions = clientCtx?.get?.("sessions");
      if (!sessions || typeof sessions.scope !== "function" || sessionId === "") return null;
      let scope = null;
      try { scope = sessions.scope(sessionId); } catch { return null; }
      if (scope === undefined || scope === null) return null;
      let conversation = null;
      try { conversation = scope.get("conversation"); } catch { conversation = null; }
      return { conversation: conversation ?? null };
    }

    function readDraftText(shell) {
      if (!shell) return null;
      try {
        const snap = shell.snapshot;
        if (snap && typeof snap.draft === "string") return snap.draft;
      } catch {}
      try {
        const doc = shell.draftSnapshot;
        if (doc && typeof doc.text === "string") return doc.text;
      } catch {}
      try {
        const proj = shell.projection;
        if (proj && typeof proj.clipboardText === "string") return proj.clipboardText;
      } catch {}
      return null;
    }

    async function deliverPending() {
      const askedSession = lastViewedSession;
      try {
        const response = await fetch(`${API_BASE}/.lr/deliver`, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ sessionId: askedSession })
        });
        const data = await response.json();
        if (!data.ok || !data.hasPending) return false;
        const targetId = data.sessionId || askedSession;

        const conversationSvc = clientCtx?.get?.("conversation");
        const input = typeof conversationSvc?.input === "object" && conversationSvc.input !== null ? conversationSvc.input : undefined;
        const shell = typeof input?.shell === "function" ? input.shell(targetId) : undefined;
        let draft = readDraftText(shell);
        if (draft !== null && draft.trim() !== "" && shell?.actions && typeof shell.actions.submit === "function") {
          shell.actions.submit();
          return true;
        }


        // empty composer: write the prompt into the composer the way a user
        // would (native value setter + input event) so submit() carries it in
        // every composer variant; conversation.send stays as the last fallback
        // because outside composer-plus it only queues the message.
        if (draft === null || draft.trim() === "") {
          const textarea = composerTextarea();
          if (textarea !== null) {
            setComposerValue(textarea, t(SEND_PROMPT_KEY));
            await new Promise((resolve) => setTimeout(resolve, 150));
            draft = readDraftText(shell);
            if (draft === null || draft.trim() === "") draft = textarea.value;
          }
        }

        if (typeof draft === "string" && draft.trim() !== "" && shell?.actions && typeof shell.actions.submit === "function") {
          shell.actions.submit();
          return true;
        }

        const target = sessionTarget(targetId);
        if (target !== null && target.conversation && typeof target.conversation.send === "function") {
          report({ kind: "diag", detail: "deliver: fallback conversation.send (composer textarea ausente)" });
          await target.conversation.send(t(SEND_PROMPT_KEY));
          return true;
        }
        report({ kind: "diag", detail: "deliver: sem shell e sem conversation.send" });
        return false;
      } catch (error) {
        log("deliverPending falhou:", String(error).slice(0, 140));
        return false;
      }
    }












    const CARD_MAP_KEY = "lr-card-map-v1";
    const cardStore = {
      armedAt: 0,
      armedRpcId: null,
      armedMessageId: null,
      data: null,
      lastSeenAt: 0,
      map: (() => {
        try { return JSON.parse(localStorage.getItem(CARD_MAP_KEY) ?? "{}") ?? {}; } catch { return {}; }
      })(),
      listeners: new Set(),
      notify() { for (const fn of [...this.listeners]) { try { fn(); } catch {} } },


      claimByMessageId(messageId, data) {
        if (typeof messageId === "string" && messageId !== "" && this.map[messageId] === undefined) {
          this.map[messageId] = data;
          const keys = Object.keys(this.map);
          if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete this.map[k];
          try { localStorage.setItem(CARD_MAP_KEY, JSON.stringify(this.map)); } catch {}
        }
        this.armedAt = 0;
        this.armedRpcId = null;
        this.armedMessageId = null;
        this.data = null;
        try { report({ kind: "diag", detail: `card: claim messageId=${String(messageId).slice(0, 8)}` }); } catch {}
        this.notify();
      }
    };

    const CARD_CSS = [
      ".lr-attached{width:fit-content;max-width:min(480px,100%);margin:2px 0 6px auto;padding:10px 12px 12px;border:1px solid var(--dsw-alias-border-l1,#00000014);border-radius:14px;background:var(--dsw-specific-tip,#f7f8fa);font-family:Inter,var(--dsw-font-family,system-ui,sans-serif);color:var(--dsw-alias-label-primary,#17191c);box-sizing:border-box;min-width:0}",
      ".lr-attached-head{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#4b4f57)}",
      ".lr-attached-head svg{flex:none}",
      ".lr-attached-pin{display:flex;gap:10px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1,#00000014);align-items:flex-start}",
      ".lr-attached-idx{flex:none;display:grid;place-items:center;width:18px;height:18px;border-radius:999px;background:var(--dsw-alias-state-business-primary,#e5484d);color:#fff;font-size:11px;font-weight:600;margin-top:1px}",
      ".lr-attached-main{width:300px;max-width:100%;min-width:0}",
      ".lr-attached-comment{font-size:13px;font-weight:600;line-height:19px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#17191c)}",
      ".lr-attached-target{margin-top:2px;font:11px/16px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#a0a4ab);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".lr-attached-img{display:block;width:100%;max-width:100%;margin-top:8px;border:1px solid var(--dsw-alias-border-l1,#00000014);border-radius:8px;background:#fff}"
    ].join("");
    function injectCardStyles() {
      if (document.querySelector("style[data-plugin-css='dsh-redline/card']")) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-redline";
      tag.dataset.pluginCss = "dsh-redline/card";
      tag.textContent = CARD_CSS;
      document.head.appendChild(tag);
    }

    function startStatusArming() {
      if (startStatusArming.timer !== undefined) return;
      const bootAt = Date.now();
      let lastCmdId = "";
      startStatusArming.timer = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/.lr/status`, { cache: "no-store", headers: authHeaders() });
          if (!r.ok) return;
          const j = await r.json();

          if (j.cmd && typeof j.cmd.id === "string" && j.cmd.id !== lastCmdId) {
            lastCmdId = j.cmd.id;
            try {
              if (j.cmd.op === "slots-snapshot") {
                const snap = clientCtx?.slots?.snapshot?.("conversation.chat.user.before");
                report({ kind: "diag", detail: `card: snapshot completo: ${JSON.stringify(snap)?.slice(0, 2200) ?? "vazio/undefined"}` });
              }
              if (j.cmd.op === "dom-probe") {
                const slotNames = [...new Set([...document.querySelectorAll("[data-slot]")].map((el) => el.getAttribute("data-slot")))];
                const firstUser = document.querySelector('[data-chat-flow-kind="user"]');
                const nodeAnchor = firstUser?.querySelector('[data-slot="conversation.chat.node"]');
                const inside = nodeAnchor ? nodeAnchor.outerHTML.replace(/\s+/g, " ").slice(0, 700) : "(sem anchor chat.node dentro da bolha user)";
                report({ kind: "diag", detail: `card: DOM probe v2 — slotsRenderizados=${JSON.stringify(slotNames)} | chatNodeAnchorNaBolha=${nodeAnchor ? "sim" : "não"} | ${inside}` });
              }
            } catch (error) {
              report({ kind: "diag", detail: `card: cmd ${j.cmd.op} falhou: ${String(error).slice(0, 120)}` });
            }
            fetch(`${API_BASE}/.lr/client-ping`, { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ kind: "cmd-done", id: j.cmd.id }) }).catch(() => {});
          }
          const ld = j?.lastDelivered;
          if (!ld || typeof ld.at !== "number" || ld.at <= cardStore.lastSeenAt) return;
          cardStore.lastSeenAt = ld.at;


          if (ld.at < bootAt - 5000) return;
          cardStore.armedAt = Date.now();
          cardStore.armedRpcId = typeof ld.rpcId === "string" && ld.rpcId !== "" ? ld.rpcId : null;
          cardStore.armedMessageId = typeof ld.messageId === "string" && ld.messageId !== "" ? ld.messageId : null;
          cardStore.data = {
            pageTitle: typeof ld.pageTitle === "string" ? ld.pageTitle : "",
            pageUrl: typeof ld.pageUrl === "string" ? ld.pageUrl : "",
            screenshotPath: typeof ld.screenshotPath === "string" ? ld.screenshotPath : null,
            pins: (Array.isArray(ld.pins) ? ld.pins : []).map((p) => ({
              tag: typeof p?.tag === "string" ? p.tag : "",
              comment: typeof p?.comment === "string" ? p.comment : "",
              selector: typeof p?.selector === "string" ? p.selector.slice(0, 120) : "",
              screenshotPath: typeof p?.screenshotPath === "string" && p.screenshotPath !== "" ? p.screenshotPath : null
            }))
          };
          try { report({ kind: "diag", detail: `card: arm pins=${cardStore.data.pins.length} rpcId=${cardStore.armedRpcId ? cardStore.armedRpcId.slice(0, 8) : "—"} messageId=${cardStore.armedMessageId ? cardStore.armedMessageId.slice(0, 8) : "—"}` }); } catch {}
          if (cardStore.armedMessageId !== null) {


            cardStore.claimByMessageId(cardStore.armedMessageId, cardStore.data);
            applyCardsToDom();
          }
          cardStore.notify();
        } catch {}
      }, 1500);
    }

    function LiveReviewMessageCard() {







      return null;
    }

    function PendingCommentsCard() {
      const [state, setState] = React.useState({ count: 0, pins: [], pageTitle: "", open: false, hovered: false });
      const sessionIdRef = React.useRef("");
      sessionIdRef.current = lastViewedSession;
      React.useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const response = await fetch(`${API_BASE}/.lr/pending?sessionId=${encodeURIComponent(sessionIdRef.current)}`, { cache: "no-store", headers: authHeaders() });
            const data = await response.json();
            if (alive) setState((prev) => (prev.count === data.count && prev.snapshotId === data.snapshotId ? prev : { ...prev, count: data.count ?? 0, pins: data.pins ?? [], pageTitle: data.pageTitle ?? "", snapshotId: data.snapshotId ?? null }));
          } catch {}
        };
        tick();
        const timer = setInterval(tick, 1500);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);
      const clear = async () => {
        try {
          await fetch(`${API_BASE}/.lr/pending/clear`, {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ sessionId: sessionIdRef.current })
          });
          setState((prev) => ({ ...prev, count: 0, pins: [], open: false, hovered: false }));
        } catch {}
      };
      const removePin = async (pinId) => {
        try {
          await fetch(`${API_BASE}/.lr/pending/remove-pin`, {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ sessionId: sessionIdRef.current, pinId })
          });
          const response = await fetch(`${API_BASE}/.lr/pending?sessionId=${encodeURIComponent(sessionIdRef.current)}`, { cache: "no-store", headers: authHeaders() });
          const data = await response.json();
          setState((prev) => ({ ...prev, count: data.count ?? 0, pins: data.pins ?? [], open: (data.count ?? 0) > 0 && prev.open }));
        } catch {}
      };
      if (state.count === 0) return null;
      return h(
        "div",
        { className: "lr-dock" },
        h(
          "div",
          { className: "lr-anchor" },
          state.hovered &&
            h(
              "div",
              { className: "lr-tip" },
              state.pins.slice(0, 3).map((pin) =>
                h(
                  "div",
                  { key: pin.id, style: { marginBottom: "10px" } },
                  h("div", { className: "lr-tip-title" }, pin.text || pin.comment || "Elemento"),
                  h("div", { className: "lr-tip-target" }, h("code", {}, `${pin.tag}${pin.role ? ` · role=${pin.role}` : ""}`)),
                  h("div", { className: "lr-tip-page" }, state.pageTitle || "(sem título)")
                )
              )
            ),
          h(
            "div",
            { className: "lr-capsule", onMouseEnter: () => setState((prev) => ({ ...prev, hovered: true })), onMouseLeave: () => setState((prev) => ({ ...prev, hovered: false })) },
            h(
              "button",
              { className: "lr-summary", title: t("viewPending"), onClick: () => setState((prev) => ({ ...prev, open: !prev.open })) },
              h("span", { className: "lr-lead", dangerouslySetInnerHTML: { __html: chatIcon } }),
              h("span", { className: "lr-count" }, `${state.count} web element${state.count === 1 ? "" : "s"}`)
            ),
            h(
              "button",
              {
                className: "lr-send",
                title: t("sendNow"),
                onClick: async () => {
                  const ok = await deliverPending();
                  if (!ok) setState((prev) => ({ ...prev, deliverError: true }));
                },
                style: {
                  all: "unset", cursor: "pointer", marginLeft: "4px",
                  padding: "4px 10px", borderRadius: "999px",
                  background: "var(--dsw-alias-state-business-primary, #e5484d)", color: "#fff",
                  fontSize: "12px", fontWeight: 500
                }
              },
              t("sendBtn")
            ),
            h("button", { className: "lr-clear", title: t("discard"), onClick: clear }, "✕")
          ),
          state.open &&
            h(
              "div",
              { className: "lr-details" },
              h(
                "ul",
                { className: "lr-list" },
                state.pins.map((pin) =>
                  h(
                    "li",
                    { className: "lr-row", key: pin.id },
                    h(
                      "button",
                      { className: "lr-row-main", title: pin.comment },
                      h("span", { className: "lr-target-line" }, h("span", { className: "lr-index" }, String(pin.index)), h("span", { className: "lr-badge" }, `<${pin.tag}>`), h("span", { className: "lr-target" }, pin.selector.slice(0, 70))),
                      h("span", { className: "lr-comment" }, pin.comment || t("noComment"))
                    ),
                    h("button", { className: "lr-remove", title: t("removePin"), onClick: () => removePin(pin.id) }, "✕")
                  )
                )
              )
            )
        )
      );
    }

    const chatIcon =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M12 8v8M8 12h8"/></svg>';










    function buildCardElement(data) {
      const card = document.createElement("div");
      card.className = "lr-attached";
      const head = document.createElement("div");
      head.className = "lr-attached-head";
      const icon = document.createElement("span");
      icon.innerHTML = chatIcon;
      head.append(icon, document.createTextNode(`# Browser comments (Redline) — ${(data.pins ?? []).length} comment${(data.pins ?? []).length === 1 ? "" : "s"}`));
      card.append(head);
      (data.pins ?? []).forEach((pin, index) => {
        const row = document.createElement("div");
        row.className = "lr-attached-pin";
        const idx = document.createElement("span");
        idx.className = "lr-attached-idx";
        idx.textContent = String(index + 1);
        const main = document.createElement("div");
        main.className = "lr-attached-main";
        const comment = document.createElement("div");
        comment.className = "lr-attached-comment";
        comment.textContent = pin.comment || t("noComment");
        const target = document.createElement("div");
        target.className = "lr-attached-target";
        target.textContent = `<${pin.tag}> ${pin.selector}${data.pageTitle ? ` — ${data.pageTitle}` : ""}`;
        main.append(comment, target);

        if (typeof pin.screenshotPath === "string" && pin.screenshotPath !== "") {
          const name = pin.screenshotPath.split(/[\\/]/).pop()?.replace(/[^A-Za-z0-9._-]/g, "") ?? "";
          if (name !== "") {
            const img = document.createElement("img");
            img.className = "lr-attached-img";
            img.alt = "Recorte do elemento anotado";
            img.src = "";
            fetch(`${API_BASE}/.lr/attachments/${name}`, { headers: authHeaders() })
              .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("http " + r.status))))
              .then((blob) => { img.src = URL.createObjectURL(blob); })
              .catch(() => { img.replaceWith(document.createTextNode("(anexo indisponível)")); });
            main.append(img);
          }
        }
        row.append(idx, main);
        card.append(row);
      });
      return card;
    }

    function applyCardsToDom() {
      if (!document.body) return;
      injectCardStyles();
      for (const [messageId, data] of Object.entries(cardStore.map)) {
        if (typeof messageId !== "string" || messageId.length < 8 || data === null || typeof data !== "object") continue;
        const row = document.querySelector(`[data-chat-anchor-key*="input-message${messageId}"]`);
        if (row === null) continue;
        const stack = row.querySelector(".dsh-recall-stack");
        if (stack !== null) {


          if (stack.__lrCardDone === true) continue;
          stack.__lrCardDone = true;
          stack.insertBefore(buildCardElement(data), stack.firstChild);
        } else {




          if (row.__lrCardDone === true) continue;
          row.__lrCardDone = true;
          const card = buildCardElement(data);
          if (row.parentNode !== null) row.parentNode.insertBefore(card, row);
          else row.insertBefore(card, row.firstChild);
        }
      }
    }

    function startOnce() {
      apiReady = apiReady ?? resolveApiBase();
      apiReady.then(() => { scan(); reportScan(); });
      if (started) return;
      started = true;
      injectBarStyles();
      if (React) startStatusArming();
      startBridgePump();
      scan();
      reportScan();
      const observer = new MutationObserver(() => {
        scan();
        applyCardsToDom();
        clearTimeout(startOnce.scanTimer);
        startOnce.scanTimer = setTimeout(reportScan, 800);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      log("watcher ativo — aguardando páginas do navegador comum");
    }

    async function reportScan() {
      const webviews = [...document.querySelectorAll("webview")];
      for (const webview of webviews) {
        if (!injected.has(webview) && (attemptCount.get(webview) ?? 0) < 6) await inject(webview);
      }
    }

    return {
      inject: React ? ["slots", "remote"] : ["remote"],
      name: "dsh-redline-client",
      apply(ctx) {
        try {
          clientCtx = ctx;
          const injectScope = (deps, setup) => {
            if (typeof ctx.inject !== "function") return [];
            const fiber = ctx.inject(deps, setup);
            return [() => fiber.dispose?.()];
          };
          for (const off of injectScope(["remote.pluginManager"], (scope) => {
            updateManager = scope.remote?.pluginManager;
            scope.effect(() => () => { updateManager = undefined; }, "dsh-redline: update installer");
          })) if (typeof ctx.effect === "function") ctx.effect(() => off, "dsh-redline: update installer scope");
          if (typeof ctx.effect === "function") {
            ctx.effect(() => () => {
              if (bridgePumpTimer !== undefined) {
                clearInterval(bridgePumpTimer);
                bridgePumpTimer = undefined;
              }
            }, "dsh-redline: bridge pump");
          }

          if (React) {
            ctx.slots.inject("conversation.input.dock", () =>
              ctx.slots.register({ name: "conversation.input.dock", id: "dsh-redline", order: 5 }, PendingCommentsCard)
            );


            ctx.slots.inject("conversation.chat.user.before", () =>
              ctx.slots.register(
                {
                  name: "conversation.chat.user.before",
                  id: "dsh-redline-card",
                  order: -100,
                  select: (owner) => (owner && owner.kind === "user" && owner.source && typeof owner.source === "object" && typeof owner.source.rpcId === "string" && owner.source.rpcId !== "" ? { rpcId: owner.source.rpcId } : null)
                },
                LiveReviewMessageCard
              )
            );
          }

          registerSettingsSection(ctx);
          ctx.slots.inject("conversation.chat.turnTail", () =>
            ctx.slots.register({ name: "conversation.chat.turnTail", id: "dsh-redline" }, createViewCapture())
          );
          try { report({ kind: "diag", detail: `client aplicado (react=${React ? "sim" : "não"}): slots dock + user.before + turnTail registrados` }); } catch {}
          if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => startOnce());
          else startOnce();
        } catch (error) {
          log("apply falhou:", String(error).slice(0, 160));
          report({ kind: "apply-fail", at: new Date().toISOString(), error: String(error).slice(0, 160) });
        }
      }
    };
  }

  try {
    window.__ModuleLoader__.load({
      id: ID,
      factory: (require) => {
        const plugin = buildPlugin(require);
        try {
          if (typeof module !== "undefined" && module && "exports" in module) module.exports = plugin;
        } catch {}
        return plugin;
      }
    });
  } catch (error) {
    if (!/duplicate/i.test(String(error))) throw error;
  }
})();
