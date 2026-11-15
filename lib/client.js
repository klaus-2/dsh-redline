// SPDX-License-Identifier: MIT
(() => {
  "use strict";
  const ID = "dsh-redline";
  const API_PORTS = [47477, 47478, 47479, 47480, 47481, 47482, 47483, 47484, 47485, 47486, 47487, 47488, 47489, 47490, 47491, 47492, 47493, 47494, 47495, 47496];
  const HEALTH_TIMEOUT_MS = 1000;
  const SECRET_TIMEOUT_MS = 5000;
  const UPDATE_TIMEOUT_MS = 15000;
  let API_BASE = "http://127.0.0.1:47477";
  let identifiedApiBase = "";
  let apiDiscovery = null;
  const SECRET_ROUTE = "/api/dsh-redline.secret";
  const SECRET_HEADER = "x-dsh-redline-secret";
  let INSTANCE_SECRET = "";
  const UPDATE_KEY = "dsh-redline.updated";
  let updateManager = undefined;

  const TRACE_BOOT_AT = Date.now();
  const TRACE_QUEUE = [];
  const TRACE_FLUSH_INTERVAL_MS = 200;
  const TRACE_FLUSH_RETRY_MS = 5000;
  let traceFlushBusy = false;
  let traceFlushBlockedUntil = 0;
  let lastTraceFlushAt = 0;

  function nowTs() {
    const d = new Date();
    return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  async function flushTrace() {
    if (identifiedApiBase === "" || TRACE_QUEUE.length === 0 || traceFlushBusy) return;
    if (Date.now() < traceFlushBlockedUntil) return;
    traceFlushBusy = true;
    lastTraceFlushAt = Date.now();
    try {
      while (TRACE_QUEUE.length > 0) {
        const chunk = TRACE_QUEUE.splice(0, 8);
        const detail = chunk.map((e) => `[trace] ${e.at} +${e.ms}ms ${e.msg}`).join("\n");
        try {
          const response = await fetch(`${API_BASE}/.lr/client-ping`, {
            method: "POST",
            headers: authHeaders({ "content-type": "application/json" }),
            body: JSON.stringify({ kind: "trace", detail: detail.slice(0, 2400) })
          });
          if (!response.ok) throw new Error(`status ${response.status}`);
        } catch (error) {
          TRACE_QUEUE.unshift(...chunk);
          traceFlushBlockedUntil = Date.now() + TRACE_FLUSH_RETRY_MS;
          log(`trace: flush failed (${String(error?.message ?? error).slice(0, 80)}), ${TRACE_QUEUE.length} kept for the next attempt`);
          break;
        }
      }
    } finally {
      traceFlushBusy = false;
    }
  }

  function log(...args) {
    try {
      const ts = nowTs();
      const text = args.map((a) => {
        if (a === null) return "null";
        if (typeof a === "object") {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }).join(" ");
      console.info(`[live-review client ${ts}]`, ...args);
      if (typeof window !== "undefined") {
        const at = new Date().toISOString();
        const ms = Date.now() - TRACE_BOOT_AT;
        window.__LR_LOGS__ = window.__LR_LOGS__ || [];
        window.__LR_LOGS__.push({ at, ts, ms, msg: text });
        if (window.__LR_LOGS__.length > 150) window.__LR_LOGS__.shift();
        TRACE_QUEUE.push({ at, ms, msg: text });
        if (TRACE_QUEUE.length > 160) TRACE_QUEUE.shift();
        if (Date.now() - lastTraceFlushAt >= TRACE_FLUSH_INTERVAL_MS) void flushTrace();
      }
    } catch {}
  }

  /** `x.y.z` as numbers, or undefined for anything else. */
  const versionOf = (text) => { const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text ?? "")); return m === null ? undefined : m.slice(1).map(Number); };
  /** Two versions as text: -1, 0 or 1. A text that is not a version compares as equal. */
  const compareVersions = (a, b) => { const pa = versionOf(a); const pb = versionOf(b); if (pa === undefined || pb === undefined) return 0; for (let i = 0; i < 3; i += 1) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; } return 0; };
  /** True when `candidate` is a version this copy does not run yet. */
  const isNewer = (candidate, running) => versionOf(candidate) !== undefined && versionOf(running) !== undefined && compareVersions(candidate, running) > 0;
  const HOTKEY_MODIFIER_LABELS = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta" };
  /** The key a shortcut names: the character the key produces when no modifier is held, and the
   * physical key when one is — Shift+1 produces "!", which is not what anyone means by "1". */
  const shortcutKey = (event, modifiers) => {
    if (modifiers.length === 0) return String(event.key ?? "").toLowerCase();
    const code = String(event.code ?? "");
    const letter = /^Key([A-Za-z])$/.exec(code);
    if (letter !== null) return letter[1].toLowerCase();
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (digit !== null) return digit[1];
    return String(event.key ?? "").toLowerCase();
  };
  /** A stored shortcut as it is shown: the modifiers in their canonical spelling, the key uppercased. */
  const formatHotkeyText = (text, fallback) => {
    const parts = String(text ?? "").split("+").map((part) => part.trim()).filter((part) => part !== "");
    if (parts.length === 0) return fallback.toUpperCase();
    const key = parts.at(-1);
    const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());
    return [...modifiers.map((name) => HOTKEY_MODIFIER_LABELS[name] ?? name), key.toUpperCase()].join("+");
  };

  async function resolveInstanceSecret() {
    if (INSTANCE_SECRET !== "") return INSTANCE_SECRET;
    try {
      log("resolveInstanceSecret: requesting " + SECRET_ROUTE);
      const r = await fetch(SECRET_ROUTE, { cache: "no-store", signal: AbortSignal.timeout(SECRET_TIMEOUT_MS) });
      const j = await r.json();
      if (j && j.ok && typeof j.secret === "string" && j.secret !== "") {
        INSTANCE_SECRET = j.secret;
        log("resolveInstanceSecret: secret acquired");
      } else {
        log("resolveInstanceSecret: route answered ok=" + j?.ok);
      }
    } catch (error) {
      log("resolveInstanceSecret: failed " + String(error?.message ?? error).slice(0, 80));
    }
    return INSTANCE_SECRET;
  }

  function authHeaders(extra) {
    if (identifiedApiBase === "" || identifiedApiBase !== API_BASE) throw new Error("the Redline host has not been identified");
    const headers = { ...(extra ?? {}) };
    if (INSTANCE_SECRET !== "") headers[SECRET_HEADER] = INSTANCE_SECRET;
    return headers;
  }
  let React = null;
  async function resolveApiBase() {
    if (identifiedApiBase !== "") return identifiedApiBase;
    if (apiDiscovery === null) {
      apiDiscovery = (async () => {
        log("api discovery: probing ports...");
        for (const port of API_PORTS) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/.lr/health`, { cache: "no-store", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
            if (!r.ok) continue;
            const j = await r.json().catch(() => null);
            if (j === null || j.ok !== true || j.name !== ID || j.port !== port) continue;
            log(`api discovery: host found on :${port}, fetching secret...`);
            if (await resolveInstanceSecret() === "") {
              log(`api discovery: host on :${port} ok but secret is unavailable`);
              apiDiscovery = null;
              return null;
            }
            API_BASE = `http://127.0.0.1:${port}`;
            identifiedApiBase = API_BASE;
            log(`api discovery: identified base ${API_BASE}`);
            return API_BASE;
          } catch {}
        }
        log("api discovery: no host found in port range");
        apiDiscovery = null;
        return null;
      })();
    }
    return apiDiscovery;
  }


  function RedlineSettings() {
    const [state, setState] = React.useState({ loaded: false, settings: { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d" }, screenshot: true, cropPad: 72 }, version: "", update: null, checking: false, error: "", capture: null, captureKey: "", saved: 0, installing: false, installed: "", installError: "", asked: "", keyError: "" });
    const remembered = () => { try { return localStorage.getItem(UPDATE_KEY) ?? ""; } catch { return ""; } };
    /** The version this copy will run after the next restart: the one the last install put on disk. */
    const remember = (value) => { try { localStorage.setItem(UPDATE_KEY, value); } catch {} };
    const forget = () => { try { localStorage.removeItem(UPDATE_KEY); } catch {} };
    // The capture listener and the settings it reads must not come from the render that created them.
    // The ref carries the current settings: it moves with every save and with every answer from the host.
    const captureRef = React.useRef(undefined);
    const settingsRef = React.useRef(state.settings);
    // Every save takes a number: a read or an answer that belongs to an older save must not
    // overwrite what the user chose after it.
    const saveGenerationRef = React.useRef(0);
    // Whether the host's settings were read and the read failed: a save made then would write the
    // defaults over the ones the host holds.
    const readFailedRef = React.useRef(false);
    const reload = React.useCallback(async () => {
      // A save that starts while this read is in flight owns the settings: the answer of this
      // read is older and must not overwrite the choice the user just made.
      const generation = saveGenerationRef.current;
      try {
        await resolveApiBase();
        const r = await fetch(API_BASE + "/.lr/settings", { cache: "no-store", headers: authHeaders() });
        const j = await r.json();
        if (!r.ok && j.ok !== true) {
          // A pending install means the plugin's own host half is down for a moment, and that is
          // expected: the row keeps the copy it installed and says nothing about a read it could
          // not run. Without a pending install the service is unreachable, and the panel says so.
          const pending = remembered();
          readFailedRef.current = true;
          setState((prev) => (pending === "" ? { ...prev, error: "unreachable" } : { ...prev, error: "", installed: pending }));
          return;
        }
        if (j.ok) {
          // This copy runs the version the last install put on disk: the record has nothing left to say.
          // A running version the host does not know cannot be compared, so the record stays.
          const record = remembered();
          if (record !== "" && versionOf(j.version) !== undefined && !isNewer(record, j.version)) forget();
          const answer = j.settings !== null && typeof j.settings === "object" ? j.settings : undefined;
          if (saveGenerationRef.current === generation && answer !== undefined) {
            settingsRef.current = answer;
            readFailedRef.current = false;
            setState((prev) => ({ ...prev, loaded: true, settings: answer, version: j.version, update: j.update ?? prev.update }));
          } else {
            setState((prev) => ({ ...prev, loaded: true, version: j.version, update: j.update ?? prev.update }));
          }        }
      } catch {
        // The host did not answer: the panel says the service is unreachable, and the settings it
        // shows are the defaults, not the ones the host holds.
        const pending = remembered();
        readFailedRef.current = true;
        setState((prev) => (pending === "" ? { ...prev, error: "unreachable" } : { ...prev, error: "", installed: pending }));
      }
    }, []);
    React.useEffect(() => { reload(); }, [reload]);
    const save = async (patch) => {
      // The settings the panel shows right now, not the ones the render that created this handler
      // knew about: a change made in between must not be undone by this save.
      const current = settingsRef.current;
      const previous = current;
      const merged = { ...current, ...patch, keys: { ...current.keys, ...(patch.keys ?? {}) } };
      // The ref carries the change right away: the next save must see it even before the panel
      // renders again.
      settingsRef.current = merged;
      const generation = saveGenerationRef.current + 1;
      saveGenerationRef.current = generation;
      setState((prev) => ({ ...prev, settings: merged, keyError: "" }));
      // The settings the host holds were never read and the read failed: what the panel shows is
      // the defaults, and saving them would write the defaults over the ones the host holds.
      if (readFailedRef.current) {
        settingsRef.current = previous;
        setState((prev) => ({ ...prev, settings: previous, saved: 0, keyError: "not-loaded" }));
        return;
      }
      try {
        const r = await fetch(API_BASE + "/.lr/settings", { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify(merged) });
        const j = await r.json().catch(() => ({}));
        // A save that started later owns the settings: this answer is older and must not
        // overwrite the choice the user made after it.
        if (saveGenerationRef.current !== generation) return;
        // The host owns the settings: its answer is the truth, whether it accepted the change,
        // kept the previous value, or refused it.
        if (j.ok === true && j.settings !== null && typeof j.settings === "object") {
          settingsRef.current = j.settings;
          readFailedRef.current = false;
          setState((prev) => ({ ...prev, settings: j.settings, saved: Date.now() }));
          return;
        }
        if (j.ok === false) {
          // The host refused: the settings it kept are the ones the panel shows again.
          settingsRef.current = previous;
          setState((prev) => ({ ...prev, settings: previous, saved: 0, keyError: j.error === "duplicate-key" ? "duplicate-key" : String(j.error ?? "save failed") }));
          return;
        }
        settingsRef.current = previous;
        setState((prev) => ({ ...prev, settings: previous, saved: 0, keyError: "save failed" }));
      } catch (error) {
        settingsRef.current = previous;
        setState((prev) => ({ ...prev, settings: previous, saved: 0, keyError: String(error?.message ?? "save failed").slice(0, 160) }));
      }
    };
    const checkUpdate = async () => {
      setState((prev) => ({ ...prev, checking: true }));
      try {
        await resolveApiBase();
        const r = await fetch(API_BASE + "/.lr/update", { cache: "no-store", headers: authHeaders(), signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) });
        const j = await r.json();
        if (j.update?.error !== undefined) {
          setState((prev) => ({ ...prev, checking: false, update: j.update, version: j.version ?? prev.version }));
          return;
        }
        if (!r.ok || j.update === undefined || j.update === null) {
          setState((prev) => ({ ...prev, checking: false, update: { error: typeof j.error === "string" ? j.error : `http ${r.status}` } }));
          return;
        }
        setState((prev) => ({ ...prev, checking: false, update: j.update, version: j.version ?? prev.version }));
      } catch {
        // A pending install means the plugin's own host half is down for a moment, and that
        // is expected.
        const pending = remembered();
        setState((prev) => (pending === ""
          ? { ...prev, checking: false, update: { error: "unreachable" } }
          : { ...prev, checking: false, installed: pending }));
      }
    };
    React.useEffect(() => { checkUpdate(); }, []);
    const lang = state.settings.lang === "auto" ? ((navigator.language || "en").toLowerCase().startsWith("pt") ? "pt" : (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en") : state.settings.lang;
    const L = {
      en: { title: "Point at elements on the page — the agent fixes the code", lang: "Language", langDesc: "Overlay and chat card language. Auto follows this app.", auto: "Auto (follow the app)", hotkeys: "Shortcuts", hotkeyComment: "Comment mode key", hotkeyAdjust: "Adjust mode key", hotkeyDraw: "Draw mode key", capture: "Click here and press a key", duplicateKey: "That shortcut is already used by another mode. Pick a different one.", screenshot: "Screenshot", screenshotDesc: "Attach a cropped screenshot of the marked region with each pin", pad: "Context padding (px)", links: "Project", repo: "GitHub repository", issues: "Report an issue", update: "Updates", current: "Current version", check: "Check for updates", checking: "Checking…", upToDate: "You are on the latest version", available: "Update available", open: "Open release page", none: "No releases published yet", updateNow: "Update now", installingMsg: "Installing {v}...", installedMsg: "Version {v} was installed. Restart the dsh to use it.", heldBackMsg: "Version {v} was installed instead of {asked} — pnpm holds back a release that is too recent.", localDev: "Local development copy — update with git pull.", error: "Update check failed", installError: "The update failed", saveError: "The settings were not saved", notLoaded: "The settings could not be read from the service, so they were not changed", unsupportedVersion: "That release is not a version this plugin can install", unreachable: "Redline service unreachable", savedNote: "Saved" },
      pt: { title: "Aponte para elementos da página — o agente corrige o código", lang: "Idioma", langDesc: "Idioma do overlay e do card no chat. Auto segue este aplicativo.", auto: "Automático (segue o app)", hotkeys: "Atalhos", hotkeyComment: "Tecla do modo comentário", hotkeyAdjust: "Tecla do modo ajuste", hotkeyDraw: "Tecla do modo desenho", capture: "Clique aqui e pressione uma tecla", duplicateKey: "Esse atalho já é usado por outro modo. Escolha outro.", screenshot: "Screenshot", screenshotDesc: "Anexa um recorte da região marcada a cada pin", pad: "Margem de contexto (px)", links: "Projeto", repo: "Repositório no GitHub", issues: "Reportar um problema", update: "Atualizações", current: "Versão atual", check: "Verificar atualizações", checking: "Verificando…", upToDate: "Você está na versão mais recente", available: "Atualização disponível", open: "Abrir página da versão", none: "Nenhuma versão publicada ainda", updateNow: "Atualizar agora", installingMsg: "Instalando {v}...", installedMsg: "A versão {v} foi instalada. Reinicie o dsh para usá-la.", heldBackMsg: "A versão {v} foi instalada em vez da {asked} — o pnpm retém uma versão lançada há pouco tempo.", localDev: "Cópia de desenvolvimento local — atualize com git pull.", error: "Falha ao verificar atualizações", installError: "A atualização falhou", saveError: "As configurações não foram salvas", notLoaded: "As configurações não puderam ser lidas do serviço, então não foram alteradas", unsupportedVersion: "Essa versão não é uma versão que este plugin consiga instalar", unreachable: "Serviço do Redline inacessível", savedNote: "Salvo" },
      zh: { title: "指向页面元素 — 智能体直接改代码", lang: "语言", langDesc: "浮层与聊天卡片语言。自动跟随本应用。", auto: "自动（跟随应用）", hotkeys: "快捷键", hotkeyComment: "评论模式键", hotkeyAdjust: "调整模式键", hotkeyDraw: "绘制模式键", capture: "点击后按下按键", duplicateKey: "该快捷键已被其他模式使用。请选择另一个。", screenshot: "截图", screenshotDesc: "为每个标注附加标记区域的裁剪截图", pad: "上下文边距（px）", links: "项目", repo: "GitHub 仓库", issues: "报告问题", update: "更新", current: "当前版本", check: "检查更新", checking: "检查中…", upToDate: "已是最新版本", available: "有可用更新", open: "打开发布页", none: "尚未发布任何版本", updateNow: "立即更新", installingMsg: "正在安装 {v}...", installedMsg: "版本 {v} 已安装。重启 dsh 以使用。", heldBackMsg: "安装了版本 {v} 而不是 {asked} — pnpm 会暂缓过于新鲜的版本。", localDev: "本地开发副本 — 请用 git pull 更新。", error: "检查更新失败", installError: "更新失败", saveError: "设置未保存", notLoaded: "无法从服务读取设置，因此未作更改", unsupportedVersion: "该版本不是此插件可安装的版本", unreachable: "Redline 服务不可达", savedNote: "已保存" }
    }[lang];
    const row = (label, desc, control, key) => React.createElement("div", { key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "14px 0", borderBottom: ".5px solid var(--dsw-alias-border-l2)" }, title: desc },
      React.createElement("div", { style: { minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 13, color: "var(--dsw-alias-label-primary)" } }, label),
        desc ? React.createElement("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", marginTop: 2 } }, desc) : null),
      React.createElement("div", { style: { flex: "none", display: "flex", alignItems: "center", gap: 8 } }, control));
    const selectStyle = { background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, padding: "5px 8px", fontSize: 13 };
    const linkStyle = { background: "none", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 8, padding: "5px 10px", color: "var(--dsw-alias-label-primary)", fontSize: 13, cursor: "pointer", textDecoration: "none" };
    const captureKey = (which) => {
      // A second click on the field cancels the capture: the field that is being captured is the one
      // that was clicked, whatever the render that created this handler knows about it.
      if (captureRef.current?.which === which) { cancelCapture(); return; }
      // Clicking another field replaces the capture: the listener of the previous one goes away.
      cancelCapture();
      setState((prev) => ({ ...prev, capture: which, captureKey: "" }));
      const handler = (e) => {
        // Escape ends the capture without changing the key. It is not swallowed: the app uses it
        // to close its own panels, and the capture is over either way.
        if (e.key === "Escape") { cancelCapture(); return; }
        const modifiers = [];
        if (e.ctrlKey) modifiers.push("Ctrl");
        if (e.altKey) modifiers.push("Alt");
        if (e.shiftKey) modifiers.push("Shift");
        if (e.metaKey) modifiers.push("Meta");
        // A bare modifier is not a key: keep listening so the user can press the modifiers first.
        // The key is not swallowed, so the app still sees it.
        if (["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key)) { setState((prev) => ({ ...prev, captureKey: modifiers.join("+") })); return; }
        // The shortcut names the key the user reads: with a modifier held, the character the
        // layout produces is not that key (Shift+1 produces "!"), so the physical key is used.
        const key = shortcutKey(e, modifiers);
        // Any other key ends the capture too, without changing the key.
        if (!/^[a-z0-9]$/.test(key)) { cancelCapture(); return; }
        // Only a key the capture takes is swallowed.
        e.preventDefault();
        const hotkey = [...modifiers, key].join("+");
        cancelCapture();
        save({ keys: { ...settingsRef.current.keys, [which]: hotkey } });
      };
      window.addEventListener("keydown", handler, true);
      captureRef.current = { which, cancel: () => { window.removeEventListener("keydown", handler, true); } };
    };
    const cancelCapture = () => {
      captureRef.current?.cancel();
      captureRef.current = undefined;
      setState((prev) => ({ ...prev, capture: null, captureKey: "" }));
    };
    // The capture listens on the window: it must not outlive the panel that owns it.
    React.useEffect(() => () => { captureRef.current?.cancel(); captureRef.current = undefined; }, []);
    const askHostToInstall = async (latest, requestId) => {
      const canUpdate = updateManager !== undefined && typeof updateManager.updateBundle === "function";
      const canInstall = updateManager !== undefined && typeof updateManager.installBundle === "function";
      if (!canUpdate && !canInstall) return undefined;
      const installSpec = async (spec) => {
        const reply = await updateManager.installBundle(spec, { requestId });
        if (!reply?.ok) throw new Error(reply?.error?.message ?? "plugin manager did not answer");
        return reply.value;
      };
      const refuse = (result) => {
        const refusal = String(result?.error?.diagnostic ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
        const why = refusal.find((line) => line.startsWith("dsh:")) ?? refusal.at(-1) ?? result?.error?.code ?? "install failed";
        setState((prev) => ({ ...prev, installing: false, installed: "", asked: "", installError: String(why).slice(0, 160) }));
        return { application: "refused" };
      };
      const landedOnDisk = (result) => typeof result?.version === "string" && versionOf(result.version) !== undefined;
      if (canUpdate) {
        const reply = await updateManager.updateBundle("dsh-redline", latest, { requestId });
        if (!reply?.ok) throw new Error(reply?.error?.message ?? "plugin manager did not answer");
        const result = reply.value?.result ?? reply.value;
        if (result?.application !== "failed" && result?.application !== "cancelled") return result;
        if (landedOnDisk(result)) return result;
        if (result?.error?.code === "invalid-spec" || result?.error?.code === "already-installed") return undefined;
        return refuse(result);
      }
      const result = await installSpec("dsh-redline@" + latest);
      if (result?.application !== "failed" && result?.application !== "cancelled") return result;
      if (landedOnDisk(result)) return result;
      if (result?.error?.code === "already-installed") return undefined;
      return refuse(result);
    };
    const installUpdate = async () => {
      const latest = (state.update?.latest ?? "").replace(/^v/, "");
      // The version goes into a spec and into a url: only a plain version may travel there.
      if (versionOf(latest) === undefined) {
        setState((prev) => ({ ...prev, installing: false, installError: "unsupported-version" }));
        return;
      }
      setState((prev) => ({ ...prev, installing: true, installed: "", installError: "" }));
      const requestId = ID + "-update-" + latest + "-" + Date.now();
      try {
        const result = await askHostToInstall(latest, requestId);
        if (result === undefined) {
          setState((prev) => ({ ...prev, installing: false, installError: "no-plugin-manager" }));
          return;
        }
        if (result.application === "refused") return;
        const lines = String(result?.error?.diagnostic ?? "").split("\n").map((line) => line.trim()).filter((line) => line !== "");
        const reason = lines.find((line) => line.startsWith("dsh:")) ?? lines.at(-1) ?? result?.error?.code ?? "install failed";
        const live = result?.application === "applied";
        // The host's contract names overridden as an outcome of a change: the copy is on disk and a
        // configuration of higher priority replaced the running one.
        const overridden = result?.application === "overridden";
        // The manager answers with the version of the bundle it resolved on disk. pnpm's minimumReleaseAge
        // can hold a release back, so that answer is the truth about what landed — not always the version
        // that was asked for.
        const reported = typeof result?.version === "string" && versionOf(result.version) !== undefined ? result.version : undefined;
        if (!live && !overridden && result?.application !== "restart-required" && reported === undefined) {
          setState((prev) => ({ ...prev, installing: false, installError: String(reason).slice(0, 160) }));
          return;
        }
        // The row names what the manager resolved, which is what the next start runs. When the manager names
        // nothing, the version that was asked for is the best answer there is.
        const landed = reported ?? latest;
        remember(landed);
        if (live) {
          // The new copy runs at once: it is the current version now, and there is nothing to restart for.
          setState((prev) => ({ ...prev, installing: false, installed: "", version: landed, asked: "", update: prev.update === null ? prev.update : { ...prev.update, newer: false } }));
          return;
        }
        // The copy is on disk but the dsh could not start it: the restart is what brings it in, and the
        // reason it did not start belongs next to it — a bare success line would hide a failed install.
        const startFailed = result?.application === "failed";
        setState((prev) => ({ ...prev, installing: false, installed: landed, asked: latest, installError: startFailed ? String(reason).slice(0, 160) : "" }));
        return;
      } catch (error) {
        setState((prev) => ({ ...prev, installing: false, installError: String(error?.message ?? error).slice(0, 160) }));
      }
    };
    const u = state.update;
    // The version that waits for a restart: what the last install put on disk (`state.installed`) or what the
    // host reports as installed on disk (`u.installed`). The newest of them is the one the next start will run.
    // A value that is not a version names nothing: it cannot be compared and it cannot be shown.
    const pendingVersion = [state.installed, u?.installed]
      .filter((value) => typeof value === "string" && versionOf(value) !== undefined)
      .reduce((best, value) => (best === undefined || isNewer(value, best) ? value : best), undefined);
    // Without the host the running version is unknown: the pending one is the only version there is.
    const pendingIsNewer = pendingVersion !== undefined && (versionOf(state.version) === undefined || compareVersions(pendingVersion, state.version) > 0);
    // pnpm holds back a release that is too recent, so the copy that landed can be older than the one asked
    // for. The row says which one it was instead of calling the update done.
    const heldBack = pendingVersion !== undefined && versionOf(state.version) !== undefined && compareVersions(pendingVersion, state.version) <= 0 && versionOf(state.asked ?? "") !== undefined && isNewer(state.asked, pendingVersion);
    const pendingMsg = heldBack ? L.heldBackMsg.replace("{v}", pendingVersion).replace("{asked}", state.asked) : L.installedMsg.replace("{v}", pendingVersion);
    // The pending version waits for a restart: it is named by the line under the row, so the status span
    // stays on what the update check knows.
    const updateStatus = u === null ? L.none : u.error ? L.error + " (" + u.error + ")" : state.installing ? L.installingMsg.replace("{v}", (u.latest ?? "").replace(/^v/, "")) : u.newer ? L.available + ": " + u.latest : L.upToDate;
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
      row(L.hotkeyComment, L.capture, React.createElement("input", { readOnly: true, value: state.capture === "comment" ? (state.captureKey === "" ? L.capture : state.captureKey) : formatHotkeyText(state.settings.keys.comment, "c"), onClick: () => captureKey("comment"), style: { ...selectStyle, width: 90, textAlign: "center", cursor: "pointer", fontFamily: "ui-monospace, monospace" }, "aria-label": L.hotkeyComment, title: L.capture }), "key-comment"),
      row(L.hotkeyAdjust, L.capture, React.createElement("input", { readOnly: true, value: state.capture === "adjust" ? (state.captureKey === "" ? L.capture : state.captureKey) : formatHotkeyText(state.settings.keys.adjust, "v"), onClick: () => captureKey("adjust"), style: { ...selectStyle, width: 90, textAlign: "center", cursor: "pointer", fontFamily: "ui-monospace, monospace" }, "aria-label": L.hotkeyAdjust, title: L.capture }), "key-adjust"),
      row(L.hotkeyDraw, L.capture, React.createElement("input", { readOnly: true, value: state.capture === "draw" ? (state.captureKey === "" ? L.capture : state.captureKey) : formatHotkeyText(state.settings.keys.draw, "d"), onClick: () => captureKey("draw"), style: { ...selectStyle, width: 90, textAlign: "center", cursor: "pointer", fontFamily: "ui-monospace, monospace" }, "aria-label": L.hotkeyDraw, title: L.capture }), "key-draw"),
      row(L.screenshot, L.screenshotDesc, React.createElement("label", { style: { display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" } },
        React.createElement("input", { type: "checkbox", checked: state.settings.screenshot === true, onChange: (e) => save({ screenshot: e.target.checked }), "aria-label": L.screenshot }),
        React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--dsw-alias-label-tertiary)", fontSize: 12 } },
          L.pad,
          React.createElement("input", { type: "number", min: 16, max: 200, value: state.settings.cropPad, onChange: (e) => save({ cropPad: Number(e.target.value) }), style: { ...selectStyle, width: 64 }, "aria-label": L.pad }))), "shot"),
      row(L.links, "", React.createElement("div", { style: { display: "flex", gap: 8 } },
        React.createElement("a", { href: "https://github.com/klaus-2/dsh-redline", target: "_blank", rel: "noreferrer", style: linkStyle, title: L.repo }, L.repo),
        React.createElement("a", { href: "https://github.com/klaus-2/dsh-redline/issues", target: "_blank", rel: "noreferrer", style: linkStyle, title: L.issues }, L.issues)), "links"),
      row(L.update, React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 8px", minWidth: 0 } },
        React.createElement("span", null, L.current + ": " + (state.version || pendingVersion || "—")),
        React.createElement("span", { style: { color: pendingIsNewer || state.installing ? "var(--dsw-alias-state-success-primary, #22c55e)" : u !== null && u.newer ? "var(--dsw-alias-state-success-primary, #22c55e)" : "var(--dsw-alias-label-tertiary)" } }, state.checking ? L.checking : updateStatus)),
      React.createElement("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "flex-end", flex: "none" } },
        u !== null && u.newer && !pendingIsNewer ? React.createElement("button", { onClick: installUpdate, disabled: state.installing, style: { ...linkStyle, fontWeight: 600, opacity: state.installing ? 0.6 : 1, cursor: state.installing ? "wait" : "pointer" } }, L.updateNow) : null,
        React.createElement("button", { onClick: checkUpdate, style: linkStyle }, L.check),
        u !== null && typeof u.url === "string" && u.url !== "" ? React.createElement("a", { href: u.url, target: "_blank", rel: "noreferrer", style: linkStyle, title: L.open }, L.open) : null), "update"),
      state.installError !== "" ? React.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, padding: "8px 0" } }, state.installError === "local-development" ? L.localDev : state.installError === "unsupported-version" ? L.unsupportedVersion : state.installError === "no-plugin-manager" ? "Cannot install automatically — update manually from npm" : L.installError + " (" + state.installError + ")") : null,
      state.keyError !== "" ? React.createElement("div", { style: { color: "var(--dsw-state-error-primary, #ec1313)", fontSize: 12, padding: "8px 0" } }, state.keyError === "duplicate-key" ? L.duplicateKey : state.keyError === "not-loaded" ? L.notLoaded : L.saveError + " (" + state.keyError + ")") : null,
      pendingIsNewer || heldBack ? React.createElement("div", { style: { color: "var(--dsw-alias-state-success-primary, #22c55e)", fontSize: 12, padding: "8px 0" } }, pendingMsg) : null,
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
      const UI_LOCALES = {"en":{"viewPending":"View pending annotations","sendNow":"Send the annotations to the agent now","sendBtn":"Send","discard":"Discard annotations","removePin":"Remove this pin","noComment":"(no comment)","commentTool":"Comment","sendPrompt":"Apply the page annotations.","elementFallback":"Element","untitledPage":"(untitled)","cropAlt":"Crop of the annotated element","attachmentUnavailable":"(attachment unavailable)","reportMd":"Report .md","reportJson":"Report .json","reportFailed":"Report download failed","chatCardTitle":"Browser comments (Redline)","chatCardCount":"{n} comment(s)"},"pt":{"viewPending":"Ver as anotações pendentes","sendNow":"Enviar as anotações ao agente agora","sendBtn":"Enviar","discard":"Descartar anotações","removePin":"Remover este pin","noComment":"(sem comentário)","commentTool":"Comentar","sendPrompt":"Aplique as anotações da página.","elementFallback":"Elemento","untitledPage":"(sem título)","cropAlt":"Recorte do elemento anotado","attachmentUnavailable":"(anexo indisponível)","reportMd":"Relatório .md","reportJson":"Relatório .json","reportFailed":"Falha ao baixar o relatório","chatCardTitle":"Comentários do navegador (Redline)","chatCardCount":"{n} comentário(s)"},"zh":{"viewPending":"查看待发送标注","sendNow":"立即把标注发送给智能体","sendBtn":"发送","discard":"丢弃标注","removePin":"移除此标注","noComment":"（无评论）","commentTool":"评论","sendPrompt":"应用页面批注。","elementFallback":"元素","untitledPage":"（无标题）","cropAlt":"标注元素截图","attachmentUnavailable":"（附件不可用）","reportMd":"报告 .md","reportJson":"报告 .json","reportFailed":"报告下载失败","chatCardTitle":"浏览器批注（Redline）","chatCardCount":"{n} 条批注"}};
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
    const docGeneration = new WeakMap();
    const lastRecovery = new WeakMap();
    const injectBusy = new WeakSet();
    const budgetResumeAt = new WeakMap();
    const ladderArmed = new WeakMap();
    const MAX_INJECT_ATTEMPTS = 12;
    const BUDGET_PAUSE_MS = 30000;
    const DEFERRED_RETRY_MS = 1000;
    const evtLog = [];
    let lastReport = "";

    function freshDocument(webview, event) {
      const wasInjected = injected.has(webview);
      injected.delete(webview);
      attemptCount.delete(webview);
      budgetResumeAt.delete(webview);
      docGeneration.set(webview, (docGeneration.get(webview) ?? 0) + 1);
      log(`webview [${event}]: fresh document (wasInjected=${wasInjected}) url="${guestUrl(webview).slice(0, 60)}"`);
    }

    function scheduleInject(webview, delay, reason) {
      const generation = docGeneration.get(webview) ?? 0;
      setTimeout(() => {
        if ((docGeneration.get(webview) ?? 0) !== generation) return;
        void inject(webview, reason);
      }, delay);
    }

    function scheduleRetry(webview, reason, delay, generation) {
      setTimeout(() => {
        if ((docGeneration.get(webview) ?? 0) !== generation) return;
        if (injected.has(webview)) return;
        void inject(webview, `retry:${reason}`);
      }, delay);
    }

    function backoffFor(attempts) {
      return Math.min(120 * 2 ** Math.min(attempts - 1, 5), 2000);
    }

    async function report(payload) {
      try {
        const at = payload.at ?? new Date().toISOString();
        evtLog.push({ at, kind: payload.kind, detail: payload.detail ?? payload.sessionId ?? payload.error ?? "" });
        if (evtLog.length > 8) evtLog.shift();
        const body = JSON.stringify({ ...payload, at, history: evtLog.slice(-6) });
        if (body === lastReport) return;
        lastReport = body;
        if (identifiedApiBase === "") return;
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

    function guestUrl(webview) {
      try {
        if (typeof webview.getURL === "function") {
          const own = String(webview.getURL() ?? "");
          if (own !== "") return own;
        }
      } catch {}
      return String(webview.getAttribute?.("src") ?? "");
    }

    function guestHasNoPage(url) {
      return url === "" || url.startsWith("about:") || url.startsWith("devtools:") || url.startsWith("chrome");
    }

    const MOUNT_STATE_PROBE = `(() => { const lrMountState = document.getElementById("dsh-redline-host"); if (lrMountState !== null) return "present"; if (document.readyState === "loading") return "loading"; return window.__LR_LOADED__ === true ? "loaded" : "absent"; })()`;

    async function mountState(webview) {
      try {
        const state = await webview.executeJavaScript(MOUNT_STATE_PROBE, false);
        return typeof state === "string" ? state : "absent";
      } catch {
        return "absent";
      }
    }

    async function inject(webview, reason = "scan") {
      const t0 = Date.now();
      const generation = docGeneration.get(webview) ?? 0;
      const url = guestUrl(webview);
      if (guestHasNoPage(url)) {
        log(`inject: skip (hasNoPage) reason=${reason} url="${url.slice(0, 60)}"`);
        return;
      }
      if (injected.has(webview)) {
        log(`inject: skip (already injected) reason=${reason} url="${url.slice(0, 60)}"`);
        return;
      }
      if (injectBusy.has(webview)) return;
      injectBusy.add(webview);
      try {
        let attempts = attemptCount.get(webview) ?? 0;
        if (attempts >= MAX_INJECT_ATTEMPTS) {
          if (Date.now() < (budgetResumeAt.get(webview) ?? 0)) return;
          attemptCount.delete(webview);
          budgetResumeAt.delete(webview);
          attempts = 0;
        }
        log(`inject: start attempt #${attempts + 1} reason=${reason} url="${url.slice(0, 60)}"`);

        if (identifiedApiBase === "") {
          const base = await resolveApiBase();
          if (base === null) {
            log(`inject: host not identified, deferring reason=${reason}`);
            scheduleRetry(webview, "host-unidentified", DEFERRED_RETRY_MS, generation);
            return;
          }
        }
        if ((docGeneration.get(webview) ?? 0) !== generation) return;

        const tSource0 = Date.now();
        const source = await loadOverlaySource();
        const relay = await loadBridgeSource();
        const sourceMs = Date.now() - tSource0;
        if (source === null || relay === null) {
          log(`inject: sources unavailable (${sourceMs}ms), overlay=${source !== null} relay=${relay !== null}`);
          await report({ kind: "inject-fail", at: new Date().toISOString(), url: url.slice(0, 80), error: source === null ? "overlay source indisponível" : "bridge source indisponível" });
          scheduleRetry(webview, "sources-unavailable", DEFERRED_RETRY_MS * 2, generation);
          return;
        }
        if ((docGeneration.get(webview) ?? 0) !== generation) return;

        const tExec0 = Date.now();
        const config = JSON.stringify({ apiBase: API_BASE, injectedBy: "webview" });
        const prefix = `try { for (const key of Object.keys(localStorage)) { if (key === "lr-drawings" || key.startsWith("lr-drawings:")) localStorage.removeItem(key); } } catch {}\nwindow.__LR__ = Object.assign({}, window.__LR__ || {}, ${config});\nwindow.__LR_BRIDGE_MODE__ = window.__LR_BRIDGE__ ? window.__LR_BRIDGE_MODE__ : "client";\n`;
        const bundle = `${prefix}${relay}\n${source}`;
        const repair = `${prefix}try { delete window.__LR_LOADED__; } catch {}\n${relay}\n${source}`;
        const spend = () => {
          attempts += 1;
          attemptCount.set(webview, attempts);
          if (attempts >= MAX_INJECT_ATTEMPTS) budgetResumeAt.set(webview, Date.now() + BUDGET_PAUSE_MS);
        };
        try {
          await webview.executeJavaScript(bundle, false);
          spend();
          let state = await mountState(webview);
          if (state === "loaded") {
            await webview.executeJavaScript(repair, false);
            spend();
            state = await mountState(webview);
          }
          const execMs = Date.now() - tExec0;
          const totalMs = Date.now() - t0;
          if (state !== "present") {
            log(`inject: NOT CONFIRMED (${totalMs}ms total, exec=${execMs}ms, sources=${sourceMs}ms) state=${state}`);
            scheduleRetry(webview, "not-confirmed", backoffFor(attempts), generation);
            return;
          }
          if ((docGeneration.get(webview) ?? 0) !== generation) return;
          injected.add(webview);
          log(`inject: SUCCESS (${totalMs}ms total, exec=${execMs}ms, sources=${sourceMs}ms) reason=${reason} url="${url.slice(0, 60)}"`);
          await report({ kind: "inject-ok", at: new Date().toISOString(), url: url.slice(0, 80), detail: `${totalMs}ms` });
          void syncGuestViewport().catch(() => {});
        } catch (error) {
          const errMs = Date.now() - t0;
          spend();
          log(`inject: FAIL (${errMs}ms) url="${url.slice(0, 60)}" error="${String(error).slice(0, 100)}"`);
          await report({ kind: "inject-fail", at: new Date().toISOString(), url: url.slice(0, 80), error: String(error).slice(0, 160) });
          scheduleRetry(webview, "exception", backoffFor(attempts), generation);
        }
      } finally {
        injectBusy.delete(webview);
        void flushTrace();
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
        if (guestHasNoPage(guestUrl(webview))) continue;
        if (bridgeBusy.get(webview) === true) continue;
        bridgeBusy.set(webview, true);
        try {
          if (!injected.has(webview)) {
            const last = lastRecovery.get(webview) ?? 0;
            if (Date.now() - last >= 500) {
              lastRecovery.set(webview, Date.now());
              void inject(webview, "pump-recovery");
            }
            continue;
          }
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

    const GUEST_REQUEST_TIMEOUT_MS = 8000;

    function parseViewportState(raw) {
      if (raw === null || raw === undefined || raw === "") return { w: null, z: 100 };
      if (typeof raw === "object") {
        const wRaw = (raw.w === null || raw.w === undefined || raw.w === "") ? null : Number(raw.w);
        const w = (Number.isFinite(wRaw) && wRaw > 0) ? wRaw : null;
        const zRaw = (raw.z === null || raw.z === undefined || raw.z === "") ? 100 : Number(raw.z);
        return { w, z: [50, 75, 100, 125, 150, 200].includes(zRaw) ? zRaw : 100 };
      }
      if (typeof raw === "string") {
        const s = raw.trim();
        if (s === "") return { w: null, z: 100 };
        try {
          const o = JSON.parse(s);
          if (o && typeof o === "object") return parseViewportState(o);
        } catch {}
        const n = Number(s);
        if (Number.isFinite(n) && n > 0) return { w: n, z: 100 };
      }
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return { w: raw, z: 100 };
      return { w: null, z: 100 };
    }

    async function askGuestViewport() {
      const states = [];
      for (const webview of document.querySelectorAll('webview[data-sidebar-browser-frame="webview"]')) {
        if (!injected.has(webview)) continue;
        if (guestHasNoPage(guestUrl(webview))) continue;
        if (bridgeBusy.get(webview) === true) continue;
        bridgeBusy.set(webview, true);
        states.push((async () => {
          try {
            const state = await webview.executeJavaScript(
              `(() => { const host = document.getElementById("dsh-redline-host"); if (host === null) return null; return host.getAttribute("data-lr-viewport"); })()`,
              false
            );
            return typeof state === "string" ? state : (state == null ? "" : String(state));
          } catch {
            return null;
          } finally {
            bridgeBusy.set(webview, false);
            void flushTrace();
          }
        })());
      }
      if (states.length === 0) return null;
      const settled = await Promise.race([
        Promise.all(states),
        new Promise((resolve) => setTimeout(() => resolve(null), GUEST_REQUEST_TIMEOUT_MS))
      ]);
      if (settled === null) return null;
      const raws = settled.filter((s) => s !== null);
      return raws.length === 1 ? raws[0] : raws[0] ?? null;
    }

    async function syncGuestViewport() {
      const state = await askGuestViewport();
      if (state === null) return;
      log(`guest viewport: ${state}`);
      report({ kind: "diag", detail: `viewport: ${state}` });
    }

    function startBridgePump() {
      if (bridgePumpTimer !== undefined) return;
      bridgePumpTimer = setInterval(() => {
        pumpBridge().catch(() => {});
      }, 200);
    }

    function armFallbackLadder(webview) {
      const generation = docGeneration.get(webview) ?? 0;
      if (ladderArmed.get(webview) === generation) return;
      ladderArmed.set(webview, generation);
      [400, 1500, 4000, 8000].forEach((delay) => {
        setTimeout(() => {
          if (injected.has(webview)) return;
          log(`timer (${delay}ms): checking inject url="${guestUrl(webview).slice(0, 60)}"`);
          void inject(webview, `timer:${delay}`);
        }, delay);
      });
    }

    function wireWebview(webview) {
      if (!(webview instanceof Element) || webview.dataset.liveReviewWired === "1") return;
      webview.dataset.liveReviewWired = "1";
      log(`wireWebview: attached, src="${String(webview.getAttribute?.("src") ?? "").slice(0, 60)}" url="${guestUrl(webview).slice(0, 60)}"`);

      webview.addEventListener("did-start-loading", () => {
        freshDocument(webview, "did-start-loading");
        armFallbackLadder(webview);
      });
      webview.addEventListener("dom-ready", () => {
        freshDocument(webview, "dom-ready");
        scheduleInject(webview, 40, "dom-ready");
      });
      webview.addEventListener("did-navigate", () => {
        freshDocument(webview, "did-navigate");
        scheduleInject(webview, 120, "did-navigate");
      });
      webview.addEventListener("did-navigate-in-page", () => {
        void (async () => {
          if (await mountState(webview) === "present") return;
          freshDocument(webview, "did-navigate-in-page");
          scheduleInject(webview, 120, "did-navigate-in-page");
        })();
      });
      armFallbackLadder(webview);
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
      .lr-node, .lr-node * { box-sizing: border-box; }
      .lr-node { width: fit-content; max-width: min(480px, 100%); margin: 2px 0 6px auto; padding: 10px 12px 12px;
        border: 1px solid var(--dsw-alias-border-l1, #00000014); border-radius: 14px;
        background: var(--dsw-specific-tip, #f7f8fa); font-family: Inter, var(--dsw-font-family, system-ui, sans-serif);
        color: var(--dsw-alias-label-primary, #17191c); min-width: 0; }
      .lr-node-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600;
        color: var(--dsw-alias-label-secondary, #4b4f57); }
      .lr-node-head svg { flex: none; }
      .lr-node-title { flex: 1 1 auto; min-width: 0; }
      .lr-node-count { flex: none; white-space: nowrap; }
      .lr-node-pin { display: flex; gap: 10px; margin-top: 10px; padding-top: 10px;
        border-top: 1px solid var(--dsw-alias-border-l1, #00000014); align-items: flex-start; }
      .lr-node-idx { flex: none; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 999px;
        background: var(--dsw-alias-state-business-primary, #e5484d); color: #fff; font-size: 11px;
        font-weight: 600; margin-top: 1px; }
      .lr-node-main { width: 300px; max-width: 100%; min-width: 0; }
      .lr-node-comment { font-size: 13px; font-weight: 600; line-height: 19px; white-space: pre-wrap;
        word-break: break-word; color: var(--dsw-alias-label-primary, #17191c); }
      .lr-node-target { margin-top: 2px; font: 11px/16px var(--ds-font-family-code, ui-monospace, monospace);
        color: var(--dsw-alias-label-tertiary, #a0a4ab); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lr-node-img { display: block; width: 100%; max-width: 100%; margin-top: 8px;
        border: 1px solid var(--dsw-alias-border-l1, #00000014); border-radius: 8px; background: #fff; }
      .lr-node-missing { display: inline-block; margin-top: 8px; font-size: 11px;
        color: var(--dsw-alias-label-tertiary, #a0a4ab); }
      .lr-node-sections { margin-top: 10px; padding-top: 8px;
        border-top: 1px solid var(--dsw-alias-border-l1, #00000014); font-size: 12px; }
      .lr-node-sections-label { cursor: pointer; color: var(--dsw-alias-label-secondary, #4b4f57); }
      .lr-node-section { margin-top: 6px; white-space: pre-wrap; word-break: break-word;
        color: var(--dsw-alias-label-primary, #17191c); }
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












    const NODE_KIND = "dsh-redline-annotations";

    function cardPins(value) {
      if (!Array.isArray(value)) return [];
      return value
        .filter((pin) => pin !== null && typeof pin === "object")
        .map((pin) => ({
          tag: typeof pin.tag === "string" ? pin.tag.slice(0, 64) : "",
          selector: typeof pin.selector === "string" ? pin.selector.slice(0, 2000) : "",
          comment: typeof pin.comment === "string" ? pin.comment.slice(0, 4000) : "",
          screenshotPath: typeof pin.screenshotPath === "string" ? (pin.screenshotPath.split(/[\\/]/).pop() ?? "").replace(/[^A-Za-z0-9._-]/g, "") : ""
        }));
    }

    function cardSections(value) {
      if (!Array.isArray(value)) return [];
      return value
        .filter((section) => section !== null && typeof section === "object")
        .map((section) => ({
          name: typeof section.name === "string" ? section.name.slice(0, 200) : "",
          text: typeof section.text === "string" ? section.text : ""
        }))
        .filter((section) => section.text !== "");
    }

    function redlineNodeDefinition() {
      return {
        kind: NODE_KIND,
        target: "chat",
        match(event) {
          if (event?.type !== "user/message") return null;
          if (event?.surfaceOp !== "append") return null;
          if (event.data?.source?.kind !== ID) return null;
          return { id: String(event.data.id), role: "start", exclusive: true };
        },
        start(_context, match) {
          const source = match.event?.data?.source;
          return {
            pins: cardPins(source?.pins),
            pageTitle: typeof source?.pageTitle === "string" ? source.pageTitle : "",
            sections: cardSections(source?.sections)
          };
        },
        update(context) {
          return context.state;
        },
        buildViewNode(context) {
          return {
            key: context.key,
            kind: NODE_KIND,
            id: context.id,
            target: "chat",
            anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
            location: context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" },
            visibility: "visible",
            data: context.state
          };
        }
      };
    }

    function RedlineAnnotationsCard({ node }) {
      const data = node?.data ?? {};
      const pins = cardPins(data.pins);
      const pageTitle = typeof data.pageTitle === "string" ? data.pageTitle : "";
      const sections = cardSections(data.sections);
      const cropNames = [...new Set(pins.map((pin) => pin.screenshotPath).filter((name) => name !== ""))];
      const [images, setImages] = React.useState({});
      React.useEffect(() => {
        if (cropNames.length === 0) return;
        let alive = true;
        const created = [];
        resolveApiBase().then((base) => {
          if (!alive || base === null) return null;
          return authHeaders();
        }).then((headers) => {
          if (!alive || headers === null) {
            if (alive) setImages((prev) => {
              const next = { ...prev };
              for (const name of cropNames) if (next[name] === undefined) next[name] = "";
              return next;
            });
            return;
          }
          for (const name of cropNames) {
            fetch(`${API_BASE}/.lr/attachments/${name}`, { headers: authHeaders() })
              .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`http ${response.status}`))))
              .then((blob) => {
                if (!alive) return;
                const url = URL.createObjectURL(blob);
                created.push(url);
                setImages((prev) => ({ ...prev, [name]: url }));
              })
              .catch(() => { if (alive) setImages((prev) => ({ ...prev, [name]: "" })); });
          }
        }).catch(() => {
          if (alive) setImages((prev) => {
            const next = { ...prev };
            for (const name of cropNames) if (next[name] === undefined) next[name] = "";
            return next;
          });
        });
        return () => {
          alive = false;
          for (const url of created) URL.revokeObjectURL(url);
        };
      }, [cropNames.join("|")]);
      return h(
        "div",
        { className: "lr-node" },
        h(
          "div",
          { className: "lr-node-head" },
          h("span", { className: "lr-lead", dangerouslySetInnerHTML: { __html: chatIcon } }),
          h("span", { className: "lr-node-title" }, t("chatCardTitle")),
          h("span", { className: "lr-node-count" }, t("chatCardCount").replace("{n}", String(pins.length)))
        ),
        pins.map((pin, index) =>
          h(
            "div",
            { className: "lr-node-pin", key: `${index}-${pin.selector}` },
            h("span", { className: "lr-node-idx" }, String(index + 1)),
            h(
              "div",
              { className: "lr-node-main" },
              h("div", { className: "lr-node-comment" }, pin.comment || t("noComment")),
              h("div", { className: "lr-node-target" }, `<${pin.tag}> ${pin.selector}${pageTitle !== "" ? ` — ${pageTitle}` : ""}`),
              pin.screenshotPath !== "" && h(
                "div",
                { className: "lr-node-crop" },
                typeof images[pin.screenshotPath] === "string" && images[pin.screenshotPath] !== ""
                  ? h("img", { className: "lr-node-img", alt: t("cropAlt"), src: images[pin.screenshotPath] })
                  : images[pin.screenshotPath] === "" ? h("span", { className: "lr-node-missing" }, t("attachmentUnavailable")) : null
              )
            )
          )
        ),
        sections.length > 0 && h(
          "details",
          { className: "lr-node-sections" },
          h("summary", { className: "lr-node-sections-label" }, sections.map((section) => section.name).filter((name) => name !== "").join(" · ")),
          sections.map((section, index) => h("div", { className: "lr-node-section", key: `${index}-${section.name}` }, section.text))
        )
      );
    }

    function startStatusArming() {
      if (startStatusArming.timer !== undefined) return;
      let lastCmdId = "";
      startStatusArming.timer = setInterval(async () => {
        try {
          const r = await fetch(`${API_BASE}/.lr/status?fields=cmd`, { cache: "no-store", headers: authHeaders() });
          if (!r.ok) return;
          const j = await r.json();

          if (j.cmd && typeof j.cmd.id === "string" && j.cmd.id !== lastCmdId) {
            lastCmdId = j.cmd.id;
            try {
              if (j.cmd.op === "slots-snapshot") {
                const snap = clientCtx?.slots?.snapshot?.("conversation.chat.node");
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
        } catch {}
      }, 1500);
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
      const downloadReport = async (format) => {
        try {
          const response = await fetch(`${API_BASE}/.lr/report?sessionId=${encodeURIComponent(sessionIdRef.current)}&format=${format}`, { cache: "no-store", headers: authHeaders() });
          if (!response.ok) throw new Error(`http ${response.status}`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `redline-report-${state.snapshotId ?? new Date().toISOString().slice(0, 10)}.${format}`;
          anchor.click();
          URL.revokeObjectURL(url);
          setState((prev) => ({ ...prev, reportError: false }));
        } catch {
          setState((prev) => ({ ...prev, reportError: true }));
        }
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
                  h("div", { className: "lr-tip-title" }, pin.text || pin.comment || t("elementFallback")),
                  h("div", { className: "lr-tip-target" }, h("code", {}, `${pin.tag}${pin.role ? ` · role=${pin.role}` : ""}`)),
                  h("div", { className: "lr-tip-page" }, state.pageTitle || t("untitledPage"))
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
                "div",
                { className: "lr-report", style: { display: "flex", gap: "6px", marginBottom: "8px" } },
                h("button", { className: "lr-report-md", title: t("reportMd"), onClick: () => downloadReport("md"), style: { all: "unset", cursor: "pointer", padding: "3px 10px", borderRadius: "999px", background: "var(--dsw-alias-bg-subtle, rgba(255,255,255,0.08))", color: "inherit", fontSize: "12px" } }, t("reportMd")),
                h("button", { className: "lr-report-json", title: t("reportJson"), onClick: () => downloadReport("json"), style: { all: "unset", cursor: "pointer", padding: "3px 10px", borderRadius: "999px", background: "var(--dsw-alias-bg-subtle, rgba(255,255,255,0.08))", color: "inherit", fontSize: "12px" } }, t("reportJson"))
              ),
              state.reportError === true && h("div", { className: "lr-report-error", style: { color: "#ff8589", fontSize: "12px", marginBottom: "8px" } }, t("reportFailed")),
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










    function startOnce() {
      log(`startOnce: readyState="${document.readyState}" webviews=${document.querySelectorAll("webview").length}`);
      apiReady = apiReady ?? resolveApiBase();
      apiReady.then((base) => {
        log(`startOnce: apiReady resolved to ${base}`);
        flushTrace();
        for (const webview of document.querySelectorAll("webview")) freshDocument(webview, "api-ready");
        scan();
        void reportScan().catch(() => {});
      }, (error) => log(`startOnce: apiReady rejected ${String(error?.message ?? error).slice(0, 120)}`));
      if (started) return;
      started = true;
      injectBarStyles();
      if (React) startStatusArming();
      startBridgePump();
      scan();
      reportScan();
      const observer = new MutationObserver(() => {
        scan();
        clearTimeout(startOnce.scanTimer);
        startOnce.scanTimer = setTimeout(reportScan, 800);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      log("watcher ativo — aguardando páginas do navegador comum");
    }

    async function reportScan() {
      const webviews = [...document.querySelectorAll("webview")];
      for (const webview of webviews) {
        if (!injected.has(webview)) {
          const attempts = attemptCount.get(webview) ?? 0;
          if (attempts < 6) {
            log(`reportScan: webview un-injected (attempt #${attempts}), calling inject()`);
            await inject(webview);
          }
        }
      }
    }

    return {
      inject: React ? ["slots", "remote", "uiConversation"] : ["remote"],
      name: "dsh-redline-client",
      apply(ctx) {
        log("plugin.apply() called");
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

            try {
              const dispose = ctx.uiConversation.events.register(redlineNodeDefinition());
              if (typeof dispose === "function" && typeof ctx.effect === "function") {
                ctx.effect(() => dispose, "dsh-redline: chat node definition");
              }
            } catch (error) {
              report({ kind: "diag", detail: `conversation node registration failed: ${String(error).slice(0, 140)}` });
            }
            ctx.slots.inject("conversation.chat.node", () =>
              ctx.slots.register({ name: "conversation.chat.node", key: NODE_KIND }, RedlineAnnotationsCard)
            );
          }

          registerSettingsSection(ctx);
          ctx.slots.inject("conversation.chat.turnTail", () =>
            ctx.slots.register({ name: "conversation.chat.turnTail", id: "dsh-redline" }, createViewCapture())
          );
          try { report({ kind: "diag", detail: `client aplicado (react=${React ? "sim" : "não"}): slots dock + chat.node + turnTail registrados` }); } catch {}
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
