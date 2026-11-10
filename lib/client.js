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
      const r = await fetch(SECRET_ROUTE, { cache: "no-store", signal: AbortSignal.timeout(SECRET_TIMEOUT_MS) });
      const j = await r.json();
      if (j && j.ok && typeof j.secret === "string" && j.secret !== "") INSTANCE_SECRET = j.secret;
    } catch {}
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
    if (apiDiscovery === null) {
      apiDiscovery = (async () => {
        for (const port of API_PORTS) {
          try {
            const r = await fetch(`http://127.0.0.1:${port}/.lr/health`, { cache: "no-store", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
            if (!r.ok) continue;
            const j = await r.json().catch(() => null);
            if (j === null || j.ok !== true || j.name !== ID || j.port !== port) continue;
            if (await resolveInstanceSecret() === "") return null;
            API_BASE = `http://127.0.0.1:${port}`;
            identifiedApiBase = API_BASE;
            return API_BASE;
          } catch {}
        }
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
    /** The host's answer to an install: what it landed, and why it refused when it refused.
     * undefined when there is no host that installs, so the plugin's own route takes it. */
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
      // The host refuses to update a dependency saved as a tarball url, and it refuses to install a
      // package the profile already holds. Both are the profile's shape, not the release's: the
      // plugin's own route installs the version with pnpm, which rewrites the dependency as a
      // registry spec and leaves the profile updatable from then on.
      // A failure that names a version is not a refusal: the copy is on disk and did not start.
      const landedOnDisk = (result) => typeof result?.version === "string" && versionOf(result.version) !== undefined;
      if (canUpdate) {
        // updateBundle keeps the dependency saved as a registry spec; a tarball URL would
        // leave the profile with a dependency the host refuses to update.
        const reply = await updateManager.updateBundle("dsh-redline", latest, { requestId });
        if (!reply?.ok) throw new Error(reply?.error?.message ?? "plugin manager did not answer");
        // The host answers an update with the step it reached and the outcome of that step.
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
          const response = await fetch(API_BASE + "/.lr/update/install", { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ version: latest }) });
          const answer = await response.json().catch(() => ({}));
          if (!answer.ok) {
            setState((prev) => ({ ...prev, installing: false, installError: answer.error === "local-development" ? "local-development" : String(answer.error ?? "install failed").slice(0, 160) }));
            return;
          }
          const installed = typeof answer.installed === "string" && answer.installed !== "" ? answer.installed : latest;
          remember(installed);
          setState((prev) => ({ ...prev, installing: false, installed, asked: latest }));
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
      state.installError !== "" ? React.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, padding: "8px 0" } }, state.installError === "local-development" ? L.localDev : state.installError === "unsupported-version" ? L.unsupportedVersion : L.installError + " (" + state.installError + ")") : null,
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
        const config = JSON.stringify({ apiBase: API_BASE, injectedBy: "webview" });
        await webview.executeJavaScript(
          `try { for (const key of Object.keys(localStorage)) { if (key === "lr-drawings" || key.startsWith("lr-drawings:")) localStorage.removeItem(key); } } catch {}\nwindow.__LR__ = Object.assign({}, window.__LR__ || {}, ${config});\nwindow.__LR_BRIDGE_MODE__ = window.__LR_BRIDGE__ ? window.__LR_BRIDGE_MODE__ : "client";\n${relay}\n${source}`,
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
