import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { collectCallArguments, createMountModel, createReactStub, evaluateExpression, evaluateObjectLiteral, extractArrowConst, extractFunction, extractObjectLiteral, fakeClientCtx, findByClass, findByText, findElements, flush, freePort, jsonResponse, loadClientModule, makeLocalStorage, renderOnce, runCleanups, storageShim, waitFor, withIsolatedHome } from "./harness.mjs";

// The bridge relay runs in the page, not in the app: it is loaded in its own
// sandbox so the suite can drive both transports without a browser.
function loadBridgeModule(file, options = {}) {
  const source = readFileSync(file, "utf8");
  const windowStub = { ...(options.window ?? {}) };
  const sandbox = {
    window: windowStub,
    fetch: options.fetch ?? (async () => { throw new Error("fetch was not stubbed"); }),
    setTimeout: options.setTimeout ?? setTimeout,
    clearTimeout: options.clearTimeout ?? clearTimeout,
    console: options.console ?? { log() {}, warn() {}, error() {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file });
  return { window: windowStub, sandbox };
}

const REQUIRED_OVERLAY_SYMBOLS = [
  "function loadPins",
  "function savePins",
  "function renderPins",
  "function mountShadow",
  "function discardDraft",
  "function revealSelector",
  "function setHint",
  "function postSnapshot",
  "function openAdjustPanel",
  "function imageDetailsSection",
  "function imageFormatHint",
  "function imageScaleNote",
  "function pxToRem",
  "function remToPx",
  "function rootFontSizePx",
  "function normalizeViewportPresets",
  "function viewportCustomRow",
  "function overflowWidth",
  "function dictateLocale",
  "function dictateButton",
  "function tourSteps",
  "function tourBubblePosition",
  "const EDITABLE_PROPS",
  "const PROP_META",
  "const t = (key) =>"
];

function localeKeys(source) {
  const literal = extractObjectLiteral(source, "const UI_LOCALES");
  const locales = evaluateObjectLiteral(literal, "UI_LOCALES");
  if (locales === undefined) return undefined;
  const out = {};
  for (const [code, dictionary] of Object.entries(locales)) out[code] = Object.keys(dictionary);
  return out;
}

function translationKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/\bt\(\s*["'`]([A-Za-z0-9_.:-]+)["'`]\s*\)/g)) keys.add(match[1]);
  for (const match of source.matchAll(/\bt\(\s*["'`]\s*\+\s*([A-Za-z0-9_.:-]+)\s*\)/g)) keys.add(`${match[1]}.*`);
  return [...keys];
}

function editableProps(source) {
  const match = /const EDITABLE_PROPS = (\[[^\]]*\])/.exec(source);
  if (match === null) return [];
  return JSON.parse(match[1]);
}

export async function runClientSuite(harness, { pluginDir }) {
  const clientPath = path.join(pluginDir, "lib", "client.js");
  const overlayPath = path.join(pluginDir, "lib", "overlay.js");
  const templatePath = path.join(pluginDir, "overlay.template.js");
  const client = readFileSync(clientPath, "utf8");
  const overlay = readFileSync(overlayPath, "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const template = readFileSync(templatePath, "utf8");

  harness.section("client: bundle contract");
  harness.includes("the client registers with the module loader", client, "__ModuleLoader__.load");
  {
    const requires = collectCallArguments(client, "require");
    const bare = requires.filter((argument) => !/^\s*["'][^./][^"']*["']\s*$/.test(argument));
    harness.check("every require is a bare package specifier", bare.length === 0, bare.join(" | "));
    const relative = requires.filter((argument) => /["']\.[^"']*["']/.test(argument));
    harness.check("the client never requires a relative path", relative.length === 0, relative.join(" | "));
    const json = requires.filter((argument) => /\.json["']/.test(argument));
    harness.check("the client never requires a JSON file", json.length === 0, json.join(" | "));
  }
  {
    const secretHeader = /SECRET_HEADER = "([^"]+)"/.exec(client)?.[1] ?? "";
    harness.check("the client knows the secret header", secretHeader !== "");
    harness.includes("the client reads the secret from the host", client, "/api/${j.name}.secret");
    harness.excludes("the client never hands the secret to the page", client, "secret: INSTANCE_SECRET");
    harness.excludes("the page config never carries a secret", client, "__LR__.secret");
    harness.includes("the client keeps the page config it finds", client, "Object.assign({}, window.__LR__ || {}");

    const unprotected = [];
    for (const argument of collectCallArguments(client, "fetch")) {
      if (!argument.includes("/.lr/") && !argument.includes("API_BASE")) continue;
      if (argument.includes("/.lr/health")) continue;
      if (!argument.includes("authHeaders")) unprotected.push(argument.slice(0, 80));
    }
    harness.check("every loopback call carries the secret", unprotected.length === 0, unprotected.join(" | "));

    // The overlay no longer talks to the private API: it goes through the
    // bridge, and the page holds no secret at all.
    const overlayCalls = [];
    for (const argument of collectCallArguments(overlay, "fetch")) {
      if (!argument.includes("/.lr/") && !argument.includes("API_BASE")) continue;
      overlayCalls.push(argument.slice(0, 80));
    }
    const overlayPrivate = overlayCalls.filter((argument) => !argument.includes("/.lr/vendor/"));
    harness.check("the overlay never calls the private API directly", overlayPrivate.length === 0, overlayPrivate.join(" | "));
    harness.check("the overlay makes no loopback call at all", overlayCalls.length === 0, overlayCalls.join(" | "));
    harness.includes("the overlay still loads the public vendor asset", overlay, "/.lr/vendor/html2canvas.min.js");
    harness.excludes("the overlay does not know the secret header", overlay, "SECRET_HEADER");
    harness.includes("the overlay talks to the bridge", overlay, "bridgeSend");
    harness.check("the overlay submits the annotations through the bridge", overlay.includes('bridgeSend("annotations.submit"'));
    harness.check("the overlay reads the state through the bridge", overlay.includes('bridgeSend("state.get"'));
    harness.check("the overlay saves the drawings through the bridge", overlay.includes('bridgeSend("drawings.save"'));
  }

  harness.section("client: the dock surfaces resolve a background");
  harness.excludes("the dock and settings no longer use the unresolved bg-base variable", client, "--dsw-alias-bg-base");
  {
    const detailsRule = /\.lr-details\s*\{[^}]*\}/.exec(client)?.[0] ?? "";
    harness.check("the dock details panel paints with the capsule background",
      detailsRule !== "" && detailsRule.includes("background: var(--dsw-specific-tip, #f7f8fa)"),
      detailsRule.slice(0, 120));
  }

  harness.section("client: overlay el icon classification");
  {
    const isIcon = extractFunction(overlay, "isIconMarkup");
    const run = isIcon === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`(ICON_MARKUP) => {
      ${isIcon}
      return JSON.stringify({ real: isIconMarkup("<svg>ICON</svg>"), labelSvg: isIconMarkup("<svg>"), hostile: isIconMarkup("<svg onload=1>"), text: isIconMarkup("plain"), nullish: isIconMarkup(null) });
    }`, "isIconMarkup")(new Set(["<svg>ICON</svg>"])));
    const elStart = overlay.indexOf("function el(tag");
    const elBody = elStart === -1 ? "" : overlay.slice(elStart, overlay.indexOf("node.append(child)", elStart));
    harness.check("overlay: el parses only icon-table strings as markup and keeps every other string as text",
      run !== undefined && run.real === true && run.labelSvg === false && run.hostile === false &&
      run.text === false && run.nullish === false && elBody.includes("isIconMarkup(child)"),
      run === undefined ? "isIconMarkup missing" : JSON.stringify(run));
  }

  harness.section("client: overlay paint order");
  {
    const popoverZ = Number(/\.popover \{ z-index: (\d+)/.exec(overlay)?.[1] ?? 0);
    const absZ = Number(/absLayer\.style\.cssText = "[^"]*z-index:(\d+)/.exec(overlay)?.[1] ?? 0);
    const fixedZ = Number(/fixedLayer\.style\.cssText = "[^"]*z-index:(\d+)/.exec(overlay)?.[1] ?? 0);
    harness.check("overlay: popovers paint above the pin and fixed layers",
      popoverZ > absZ && popoverZ > fixedZ && absZ > 0 && fixedZ > 0,
      JSON.stringify({ popoverZ, absZ, fixedZ }));
  }

  harness.section("client: overlay footer button contrast");
  {
    const cancelRule = /\.lr-cancel \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    const cancelHover = /\.lr-cancel:hover \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    harness.check("overlay: the cancel button keeps readable text in the dark palette",
      cancelRule.includes("background: var(--n-100)") && cancelRule.includes("color: var(--n-700)") &&
      cancelHover.includes("color: var(--n-950)"),
      JSON.stringify({ cancelRule: cancelRule.slice(0, 90), cancelHover: cancelHover.slice(0, 60) }));

    const darkCancel = /\.root\.dark \.lr-cancel \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    const chipIcon = /\.chip svg \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    harness.check("overlay: dark footer and chip icons keep their own explicit colors and size",
      darkCancel.includes("background: var(--n-200)") && darkCancel.includes("color: var(--n-950)") &&
      chipIcon.includes("width: 12px") && chipIcon.includes("height: 12px"),
      JSON.stringify({ darkCancel, chipIcon }));
  }

  harness.section("client: overlay inspector row wrapping");
  {
    const rowRule = /\.lr-row \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    const tokenRule = /\.lr-token-row \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    const wideRule = /\.lr-row-wide \.lr-token-row \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    harness.check("overlay: token suggestions wrap below the control instead of overflowing the panel",
      rowRule.includes("flex-wrap: wrap") && tokenRule.includes("flex: 1 1 100%") &&
      tokenRule.includes("min-width: 0") && wideRule.includes("flex: initial"),
      JSON.stringify({ rowRule: rowRule.slice(0, 80), tokenRule: tokenRule.slice(0, 110), wideRule: wideRule.slice(0, 50) }));
  }

  harness.section("client: host identification before authentication");
  {
    const secret = "regression-placeholder-secret";
    const validHealth = (port) => jsonResponse({ ok: true, name: "dsh-redline", port });
    const build = (health, { secretResponse = () => jsonResponse({ ok: true, secret }), abortSignal = AbortSignal } = {}) => {
      const stub = createReactStub();
      const calls = [];
      const intervals = [];
      let observed = false;
      const { module } = loadClientModule(clientPath, {
        react: stub.React,
        setTimeout: () => 0,
        clearTimeout() {},
        document: {
          readyState: "complete",
          documentElement: {},
          createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
          head: { appendChild() {} },
          body: { appendChild() {} },
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener() {},
          removeEventListener() {}
        },
        sandbox: {
          setTimeout: () => 0,
          clearTimeout() {},
          setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
          clearInterval() {},
          MutationObserver: class { observe() { observed = true; } },
          AbortSignal: abortSignal
        },
        fetch: async (url, options) => {
          const target = String(url);
          calls.push({ url: target, headers: options?.headers ?? {}, signal: options?.signal });
          if (target === "/api/dsh-redline.secret") return secretResponse(options?.signal);
          const probe = new URL(target);
          if (probe.pathname === "/.lr/health") return health(Number(probe.port), options?.signal);
          if (probe.pathname === "/.lr/settings") return jsonResponse({ ok: true, settings: { lang: "en", keys: { comment: "x", adjust: "y" }, screenshot: false, cropPad: 96 }, version: "1.0.23" });
          if (probe.pathname === "/.lr/update") return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
          return jsonResponse({});
        }
      });
      const ctx = fakeClientCtx({});
      module.apply(ctx.ctx);
      ctx.resolve();
      const section = ctx.slots.find((slot) => slot.spec.name === "settings.section");
      const rendered = renderOnce(stub, section.component, {});
      for (const effect of rendered.effects) effect();
      return {
        calls, intervals, stub, section, effects: rendered.effects,
        started: () => observed,
        probes: () => calls.filter((call) => call.url.endsWith("/.lr/health")),
        privateCalls: () => calls.filter((call) => call.url.includes("/.lr/") && !call.url.endsWith("/.lr/health") && !call.url.includes("/.lr/client-ping")),
        secretCalls: () => calls.filter((call) => call.url === "/api/dsh-redline.secret")
      };
    };
    const rejected = build((port) => port === 47477 ? jsonResponse({ ok: true, name: "other-listener", port }) : port === 47478 ? validHealth(port) : jsonResponse({}, 503));
    await flush(4);
    for (const timer of rejected.intervals) await timer.fn();
    harness.check("the client rejects a health answer that does not identify redline", rejected.started() && rejected.probes().length === 2 && rejected.probes()[1].url === "http://127.0.0.1:47478/.lr/health" && rejected.privateCalls().length > 0 && rejected.privateCalls().every((call) => call.url.startsWith("http://127.0.0.1:47478/")), `probes=${rejected.probes().length}, private ports=${rejected.privateCalls().map((call) => new URL(call.url).port).join(",")}`);

    const exhausted = build(() => jsonResponse({}, 503));
    await waitFor(() => exhausted.probes().length === 20);
    await flush(4);
    for (const timer of exhausted.intervals) await timer.fn();
    harness.check("the exhaustion fixture probes all twenty candidates including the default", exhausted.started() && exhausted.probes().length === 20 && exhausted.probes().every((call, index) => new URL(call.url).port === String(47477 + index)), `probes=${exhausted.probes().length}`);
    harness.check("the settings slot remains registered when discovery is exhausted", exhausted.section.spec.id === "dsh-redline" && exhausted.effects.length >= 2);
    harness.check("the client never authenticates to an unidentified fallback host", exhausted.secretCalls().length === 0 && exhausted.privateCalls().length === 0 && exhausted.calls.every((call) => !("x-dsh-redline-secret" in call.headers)), `secret acquisitions=${exhausted.secretCalls().length}, private requests=${exhausted.privateCalls().length}`);

    let releaseHealth;
    const pendingHealth = new Promise((resolve) => { releaseHealth = resolve; });
    const delayed = build((port) => port === 47477 ? pendingHealth : jsonResponse({}, 503));
    await flush(4);
    const before = delayed.stub.getStates()[0];
    harness.check("initial settings effects wait while host identification is pending", delayed.started() && delayed.effects.length >= 2 && delayed.probes().length === 1 && delayed.secretCalls().length === 0 && delayed.privateCalls().length === 0 && before.loaded === false && before.checking === true, `probes=${delayed.probes().length}, private requests=${delayed.privateCalls().length}, loaded=${before.loaded}, checking=${before.checking}`);
    releaseHealth(validHealth(47477));
    await flush(4);
    const loaded = await waitFor(() => delayed.stub.getStates()[0].loaded === true && delayed.stub.getStates()[0].update?.latest === "v1.0.24" && delayed.stub.getStates()[0].checking === false, 500, 10);
    const after = delayed.stub.getStates()[0];
    const settingsCalls = delayed.privateCalls().filter((call) => call.url.endsWith("/.lr/settings"));
    const updateCalls = delayed.privateCalls().filter((call) => call.url.endsWith("/.lr/update"));
    harness.check("initial settings and update effects work after delayed host identification", loaded && after.error === "" && after.version === "1.0.23" && after.settings.keys.comment === "x" && after.settings.cropPad === 96 && settingsCalls.length === 1 && updateCalls.length === 1 && [...settingsCalls, ...updateCalls].every((call) => call.url.startsWith("http://127.0.0.1:47477/") && call.headers["x-dsh-redline-secret"] === secret), `loaded=${after.loaded}, settings requests=${settingsCalls.length}, update requests=${updateCalls.length}, error=${after.error}`);
    harness.check("concurrent startup and settings effects share one discovery", delayed.probes().length === 1 && delayed.secretCalls().length === 1, `probes=${delayed.probes().length}, secret acquisitions=${delayed.secretCalls().length}`);
    const adopted = build((port) => port === 47477 ? validHealth(port) : jsonResponse({}, 503));
    await flush(4);
    harness.check("the client adopts a health answer that identifies redline", adopted.started() && adopted.probes().length === 1 && adopted.secretCalls().length === 1 && adopted.stub.getStates()[0].loaded === true && adopted.privateCalls().length === 2 && adopted.privateCalls().every((call) => call.url.startsWith("http://127.0.0.1:47477/") && call.headers["x-dsh-redline-secret"] === secret), `probes=${adopted.probes().length}, secret acquisitions=${adopted.secretCalls().length}, private requests=${adopted.privateCalls().length}`);

    const invalidHealth = [
      ["non-JSON", () => new Response("<html>not Redline</html>", { status: 200 })],
      ["null JSON", () => jsonResponse(null)],
      ["ok true alone", () => jsonResponse({ ok: true })],
      ["wrong name", (port) => jsonResponse({ ok: true, name: "other-listener", port })],
      ["wrong port", (port) => jsonResponse({ ok: true, name: "dsh-redline", port: port + 1 })],
      ["string port", (port) => jsonResponse({ ok: true, name: "dsh-redline", port: String(port) })],
      ["missing ok", (port) => jsonResponse({ name: "dsh-redline", port })],
      ["false ok", (port) => jsonResponse({ ok: false, name: "dsh-redline", port })],
      ["non-boolean ok", (port) => jsonResponse({ ok: "true", name: "dsh-redline", port })],
      ["unsuccessful status", (port) => jsonResponse({ ok: true, name: "dsh-redline", port }, 503)],
      ["network error", () => { throw new Error("no listener"); }]
    ];
    const rejectedFixtures = [];
    for (const [name, reply] of invalidHealth) {
      const fixture = build((port) => port === 47477 ? reply(port) : port === 47478 ? validHealth(port) : jsonResponse({}, 503));
      rejectedFixtures.push(fixture);
      await flush(4);
      harness.check(`the client rejects ${name} health and adopts the later Redline host`, fixture.started() && fixture.probes().length === 2 && fixture.probes()[1].url === "http://127.0.0.1:47478/.lr/health" && fixture.secretCalls().length === 1 && fixture.stub.getStates()[0].loaded === true && fixture.privateCalls().length === 2 && fixture.privateCalls().every((call) => call.url.startsWith("http://127.0.0.1:47478/") && call.headers["x-dsh-redline-secret"] === secret), `probes=${fixture.probes().length}, secret acquisitions=${fixture.secretCalls().length}, private requests=${fixture.privateCalls().length}`);
    }

    const invalid = build((port) => jsonResponse({ ok: true, name: "other-listener", port }));
    const absent = build(() => { throw new Error("no listener"); });
    await flush(4);
    for (const [name, fixture] of [["invalid payloads", invalid], ["network errors", absent]]) {
      for (const timer of fixture.intervals) await timer.fn();
      const state = fixture.stub.getStates()[0];
      harness.check(`the client withholds credentials after twenty ${name}`, fixture.started() && fixture.probes().length === 20 && fixture.probes().every((call, index) => new URL(call.url).port === String(47477 + index)) && fixture.secretCalls().length === 0 && fixture.privateCalls().length === 0 && state.loaded === false && state.checking === false && state.error === "unreachable", `probes=${fixture.probes().length}, secret acquisitions=${fixture.secretCalls().length}, private requests=${fixture.privateCalls().length}, error=${state.error}`);
    }
    harness.check("health probes never carry credentials", [rejected, exhausted, delayed, adopted, invalid, absent, ...rejectedFixtures].every((fixture) => fixture.probes().every((call) => Object.keys(call.headers).every((key) => !/secret/i.test(key)))));

    const controlledDeadlines = () => {
      const deadlines = [];
      return {
        deadlines,
        abortSignal: {
          timeout(ms) {
            const controller = new AbortController();
            deadlines.push({ ms, controller });
            return controller.signal;
          }
        }
      };
    };
    const stalledResponse = (phase) => {
      const state = { started: false, pending: false, aborted: false, signal: undefined, response: undefined };
      return {
        state,
        respond(signal) {
          state.started = true;
          state.pending = true;
          state.signal = signal;
          if (phase === "fetch") {
            return new Promise((resolve, reject) => {
              signal?.addEventListener("abort", () => {
                state.pending = false;
                state.aborted = true;
                reject(signal.reason);
              }, { once: true });
            });
          }
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok":'));
              signal?.addEventListener("abort", () => {
                state.pending = false;
                state.aborted = true;
                controller.error(signal.reason);
              }, { once: true });
            }
          });
          state.response = new Response(body, { status: 200, headers: { "content-type": "application/json" } });
          return state.response;
        }
      };
    };
    const boundedFixtures = [];
    for (const phase of ["fetch", "body"]) {
      const control = controlledDeadlines();
      const stalled = stalledResponse(phase);
      const fixture = build((port, signal) => port === 47477 ? stalled.respond(signal) : port === 47478 ? validHealth(port) : jsonResponse({}, 503), { abortSignal: control.abortSignal });
      boundedFixtures.push(fixture);
      await flush(4);
      for (const timer of fixture.intervals) await timer.fn();
      const before = fixture.stub.getStates()[0];
      harness.check(`the stalled health ${phase} fixture starts and remains pending`, fixture.started() && fixture.effects.length >= 2 && stalled.state.started && stalled.state.pending && !stalled.state.aborted && (phase === "fetch" || (stalled.state.response?.bodyUsed === true && stalled.state.response.body.locked)) && fixture.probes().length === 1 && fixture.secretCalls().length === 0 && fixture.privateCalls().length === 0 && before.loaded === false && before.checking === true, `started=${stalled.state.started}, pending=${stalled.state.pending}, body used=${stalled.state.response?.bodyUsed}, probes=${fixture.probes().length}, private requests=${fixture.privateCalls().length}`);
      const deadline = control.deadlines.find((entry) => entry.controller.signal === stalled.state.signal);
      harness.check(`a stalled health ${phase} receives the 1000ms request deadline`, deadline?.ms === 1000 && stalled.state.signal instanceof AbortSignal && !stalled.state.signal.aborted, `deadline=${deadline?.ms}, signal supplied=${stalled.state.signal !== undefined}`);
      if (deadline !== undefined) deadline.controller.abort(new DOMException("fixture deadline expired", "TimeoutError"));
      await flush(4);
      const after = fixture.stub.getStates()[0];
      harness.check(`the client advances to the next host after a health ${phase} deadline`, stalled.state.aborted && !stalled.state.pending && fixture.probes().length === 2 && fixture.probes()[1].url === "http://127.0.0.1:47478/.lr/health" && fixture.secretCalls().length === 1 && after.loaded === true && after.checking === false && after.error === "" && after.version === "1.0.23" && after.settings.cropPad === 96 && after.update?.latest === "v1.0.24" && fixture.privateCalls().length === 2 && fixture.privateCalls().every((call) => call.url.startsWith("http://127.0.0.1:47478/") && call.headers["x-dsh-redline-secret"] === secret), `aborted=${stalled.state.aborted}, probes=${fixture.probes().length}, secret acquisitions=${fixture.secretCalls().length}, private requests=${fixture.privateCalls().length}, loaded=${after.loaded}, checking=${after.checking}, error=${after.error}`);
    }
    for (const phase of ["fetch", "body"]) {
      const control = controlledDeadlines();
      const stalled = stalledResponse(phase);
      const fixture = build((port) => port === 47477 ? validHealth(port) : jsonResponse({}, 503), { secretResponse: stalled.respond, abortSignal: control.abortSignal });
      boundedFixtures.push(fixture);
      await flush(4);
      const before = fixture.stub.getStates()[0];
      harness.check(`the stalled secret ${phase} fixture starts and remains pending`, fixture.started() && fixture.effects.length >= 2 && stalled.state.started && stalled.state.pending && !stalled.state.aborted && (phase === "fetch" || (stalled.state.response?.bodyUsed === true && stalled.state.response.body.locked)) && fixture.probes().length === 1 && fixture.secretCalls().length === 1 && before.loaded === false && before.checking === true, `started=${stalled.state.started}, pending=${stalled.state.pending}, body used=${stalled.state.response?.bodyUsed}, probes=${fixture.probes().length}, secret acquisitions=${fixture.secretCalls().length}`);
      for (const timer of fixture.intervals) await timer.fn();
      harness.check(`the client publishes no private destination during a stalled secret ${phase}`, fixture.privateCalls().length === 0, `private requests=${fixture.privateCalls().length}`);
      const deadline = control.deadlines.find((entry) => entry.controller.signal === stalled.state.signal);
      harness.check(`a stalled secret ${phase} receives the 5000ms request deadline`, deadline?.ms === 5000 && stalled.state.signal instanceof AbortSignal && !stalled.state.signal.aborted, `deadline=${deadline?.ms}, signal supplied=${stalled.state.signal !== undefined}`);
      if (deadline !== undefined) deadline.controller.abort(new DOMException("fixture deadline expired", "TimeoutError"));
      await flush(4);
      for (const timer of fixture.intervals) await timer.fn();
      const after = fixture.stub.getStates()[0];
      harness.check(`the client becomes unreachable after a secret ${phase} deadline`, stalled.state.aborted && !stalled.state.pending && fixture.probes().length === 1 && fixture.secretCalls().length === 1 && fixture.privateCalls().length === 0 && after.loaded === false && after.checking === false && after.error === "unreachable", `aborted=${stalled.state.aborted}, probes=${fixture.probes().length}, secret acquisitions=${fixture.secretCalls().length}, private requests=${fixture.privateCalls().length}, loaded=${after.loaded}, checking=${after.checking}, error=${after.error}`);
    }
    let releaseSecret;
    const pendingSecret = new Promise((resolve) => { releaseSecret = resolve; });
    const secretControl = controlledDeadlines();
    const delayedSecret = build((port) => port === 47477 ? validHealth(port) : jsonResponse({}, 503), { secretResponse: () => pendingSecret, abortSignal: secretControl.abortSignal });
    await flush(4);
    for (const timer of delayedSecret.intervals) await timer.fn();
    const secretBefore = delayedSecret.stub.getStates()[0];
    harness.check("the client keeps private requests blocked while a valid secret is pending", delayedSecret.started() && delayedSecret.effects.length >= 2 && delayedSecret.probes().length === 1 && delayedSecret.secretCalls().length === 1 && delayedSecret.privateCalls().length === 0 && secretBefore.loaded === false && secretBefore.checking === true, `probes=${delayedSecret.probes().length}, secret acquisitions=${delayedSecret.secretCalls().length}, private requests=${delayedSecret.privateCalls().length}, loaded=${secretBefore.loaded}, checking=${secretBefore.checking}`);
    releaseSecret(jsonResponse({ ok: true, secret }));
    await flush(4);
    const secretAfter = delayedSecret.stub.getStates()[0];
    const delayedSettings = delayedSecret.privateCalls().filter((call) => call.url.endsWith("/.lr/settings"));
    const delayedUpdate = delayedSecret.privateCalls().filter((call) => call.url.endsWith("/.lr/update"));
    harness.check("initial settings and update effects work after delayed secret acquisition", secretAfter.loaded === true && secretAfter.checking === false && secretAfter.error === "" && secretAfter.version === "1.0.23" && secretAfter.settings.keys.comment === "x" && secretAfter.settings.cropPad === 96 && secretAfter.update?.latest === "v1.0.24" && delayedSecret.probes().length === 1 && delayedSecret.secretCalls().length === 1 && delayedSettings.length === 1 && delayedUpdate.length === 1 && delayedSecret.privateCalls().every((call) => call.url.startsWith("http://127.0.0.1:47477/") && call.headers["x-dsh-redline-secret"] === secret), `loaded=${secretAfter.loaded}, checking=${secretAfter.checking}, settings requests=${delayedSettings.length}, update requests=${delayedUpdate.length}, secret acquisitions=${delayedSecret.secretCalls().length}, error=${secretAfter.error}`);
    harness.check("bounded discovery health probes never carry credentials", [...boundedFixtures, delayedSecret].every((fixture) => fixture.probes().every((call) => Object.keys(call.headers).every((key) => !/secret/i.test(key)))));
  }

  harness.section("client: the bridge relay");
  {
    const bridgePath = path.join(pluginDir, "lib", "bridge.js");
    const calls = [];
    const direct = loadBridgeModule(bridgePath, {
      window: { __LR__: { apiBase: "http://127.0.0.1:47477" } },
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true, lang: "pt" }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const answer = await direct.window.__LR_BRIDGE__.send("state.get", {});
    harness.check("the relay answers a direct call", answer.ok === true && answer.lang === "pt");
    harness.check("the relay posts to the bridge", calls.length === 1 && calls[0].url === "http://127.0.0.1:47477/.lr/bridge", JSON.stringify(calls.map((call) => call.url)));
    harness.check("the relay carries no credential", calls[0].init.credentials === "omit" && Object.keys(calls[0].init.headers ?? {}).every((key) => !/secret/i.test(key)), JSON.stringify(calls[0].init.headers));
    harness.eq("the relay carries the message type and payload", JSON.parse(calls[0].init.body), { type: "state.get", payload: {} });

    const mediated = loadBridgeModule(bridgePath, { window: { __LR__: { apiBase: "http://127.0.0.1:47477" }, __LR_BRIDGE_MODE__: "client" } });
    const pending = mediated.window.__LR_BRIDGE__.send("annotations.submit", { pageUrl: "u" });
    const drained = JSON.parse(mediated.window.__LR_BRIDGE_DRAIN__());
    harness.check("the client mode queues the message", drained.length === 1 && drained[0].type === "annotations.submit" && drained[0].payload.pageUrl === "u" && typeof drained[0].id === "string", JSON.stringify(drained));
    harness.eq("the client mode drains nothing twice", JSON.parse(mediated.window.__LR_BRIDGE_DRAIN__()).length, 0);
    mediated.window.__LR_BRIDGE_DELIVER__(JSON.stringify([{ id: drained[0].id, ok: true, data: { ok: true, count: 1 } }]));
    const delivered = await pending;
    harness.check("the client mode resolves with the answer", delivered.ok === true && delivered.count === 1);

    // A queue larger than the batch drains in slices: the pump takes 20 per
    // tick and the rest stays queued for the next tick.
    const batched = loadBridgeModule(bridgePath, { window: { __LR__: { apiBase: "http://127.0.0.1:47477" }, __LR_BRIDGE_MODE__: "client" } });
    const batchedPending = Array.from({ length: 25 }, (_, index) => batched.window.__LR_BRIDGE__.send("state.get", { n: index }));
    const firstBatch = JSON.parse(batched.window.__LR_BRIDGE_DRAIN__(20));
    harness.check("the drain returns at most the batch limit", firstBatch.length === 20, String(firstBatch.length));
    const secondBatch = JSON.parse(batched.window.__LR_BRIDGE_DRAIN__(20));
    harness.check("the second drain returns the remainder", secondBatch.length === 5, String(secondBatch.length));
    for (const message of [...firstBatch, ...secondBatch]) {
      batched.window.__LR_BRIDGE_DELIVER__(JSON.stringify([{ id: message.id, ok: true, data: { ok: true } }]));
    }
    const batchedAnswers = await Promise.all(batchedPending.map((queued) => queued.then(() => true, () => false)));
    harness.check("every queued message past the batch resolves", batchedAnswers.length === 25 && batchedAnswers.every((resolved) => resolved === true));

    // The relay failure paths: a page must never wait forever.
    const emptyError = await mediated.window.__LR_BRIDGE__.send("", {}).then(() => "resolved", (error) => String(error?.message ?? error));
    harness.check("the relay refuses a message without a type", emptyError.includes("without a type"), emptyError);
    const unknownError = await mediated.window.__LR_BRIDGE__.send("nosuch.message", {}).then(() => "resolved", (error) => String(error?.message ?? error));
    harness.check("the relay refuses a message outside the allowlist", unknownError.includes("does not carry"), unknownError);

    const timers = [];
    const stalled = loadBridgeModule(bridgePath, {
      window: { __LR__: { apiBase: "http://127.0.0.1:47477" }, __LR_BRIDGE_MODE__: "client" },
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: () => {}
    });
    const stalledAnswer = stalled.window.__LR_BRIDGE__.send("state.get", {}).then(() => "resolved", (error) => String(error?.message ?? error));
    harness.check("the relay arms a timeout for a pending answer", timers.length === 1 && timers[0].ms === 20000, JSON.stringify(timers.map((timer) => timer.ms)));
    timers[0].fn();
    const timeoutError = await stalledAnswer;
    harness.check("the relay gives up when the host does not answer", timeoutError.includes("did not answer"), timeoutError);
    harness.eq("the timed out message leaves the queue", JSON.parse(stalled.window.__LR_BRIDGE_DRAIN__()).length, 0);

    const refused = loadBridgeModule(bridgePath, {
      window: { __LR__: { apiBase: "http://127.0.0.1:47477" } },
      fetch: async () => new Response(JSON.stringify({ error: "unsupported bridge message" }), { status: 400, headers: { "content-type": "application/json" } })
    });
    const refusedError = await refused.window.__LR_BRIDGE__.send("state.get", {}).then(() => "resolved", (error) => String(error?.message ?? error));
    harness.check("the relay reports the host error", refusedError.includes("unsupported bridge message"), refusedError);
  }

  harness.section("client: the bridge pump");
  {
    harness.includes("the client fetches the bridge source", client, "/.lr/bridge.js");
    harness.includes("the client injects the relay before the overlay", client, "${relay}\\n${source}");
    harness.includes("the client drains the page queue", client, "__LR_BRIDGE_DRAIN__");
    harness.includes("the client drains with the batch limit", client, "window.__LR_BRIDGE_DRAIN__(${BRIDGE_BATCH})");
    harness.includes("the client delivers the answers back", client, "__LR_BRIDGE_DELIVER__");
    harness.includes("the client calls the bridge with the secret", client, "/.lr/bridge");
  }

  harness.section("client: the injection and the mediated bridge");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    class FakeElement {}
    const calls = [];
    const executed = [];
    const overlaySource = readFileSync(path.join(pluginDir, "lib", "overlay.js"), "utf8");
    const bridgeSource = readFileSync(path.join(pluginDir, "lib", "bridge.js"), "utf8");
    const fakeWebview = new FakeElement();
    fakeWebview.dataset = { liveReviewWired: undefined };
    fakeWebview.getAttribute = (name) => (name === "src" ? "https://example.com/" : null);
    fakeWebview.addEventListener = (type, handler) => {
      if (type === "dom-ready") setTimeout(() => handler(), 0);
    };

    // The guest is a real page running the real relay: the code the client
    // injects is evaluated, so the queue, the drain and the delivery are the
    // ones the page really uses.
    const pageWindow = { __LR__: { settings: { keys: { comment: "x" } }, marker: "kept" } };
    const pageSandbox = {
      window: pageWindow,
      document: {
        createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {}, querySelector: () => null, querySelectorAll: () => [], remove() {} }),
        head: { appendChild() {} },
        body: { appendChild() {} },
        documentElement: {},
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
      },
      localStorage: makeLocalStorage(),
      sessionStorage: makeLocalStorage(),
      navigator: { language: "en-US" },
      location: { href: "https://example.com/", origin: "https://example.com" },
      setTimeout,
      clearTimeout,
      setInterval: () => 0,
      clearInterval,
      console: { log() {}, warn() {}, error() {}, info() {} },
      fetch: async () => { throw new Error("the guest never talks to the network by itself"); }
    };
    vm.createContext(pageSandbox);
    const pageMountModel = createMountModel();
    fakeWebview.executeJavaScript = async (code) => {
      executed.push(code);
      if (code.includes("lrMountState")) return pageMountModel.answer(code);
      if (code.includes("window.__LR__ = Object.assign")) {
        try {
          vm.runInContext(code, pageSandbox, { filename: "injected.js" });
        } catch {
          // The overlay needs a DOM this shim does not have; the relay runs
          // before it and is what the round trip needs.
        }
        pageMountModel.answer(code);
        return null;
      }
      return vm.runInContext(code, pageSandbox, { filename: "guest.js" });
    };

    const documentStub = {
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      documentElement: {},
      readyState: "complete",
      querySelector: () => null,
      querySelectorAll: (selector) => (typeof selector === "string" && selector.includes("webview") ? [fakeWebview] : []),
      addEventListener() {},
      removeEventListener() {}
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      document: documentStub,
      sandbox: { Element: FakeElement, MutationObserver: class { observe() {} } },
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        calls.push({ url: target, method: options?.method ?? "GET", body: options?.body, headers: options?.headers });
        if (target.includes("/api/dsh-redline.secret")) return new Response(JSON.stringify({ ok: true, secret: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } });
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.endsWith("/.lr/overlay.js")) return new Response(overlaySource, { status: 200, headers: { "content-type": "text/javascript" } });
        if (target.endsWith("/.lr/bridge.js")) return new Response(bridgeSource, { status: 200, headers: { "content-type": "text/javascript" } });
        if (target.endsWith("/.lr/bridge")) return new Response(JSON.stringify({ ok: true, count: 1 }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    await waitFor(() => executed.some((code) => code.includes("window.__LR__ = Object.assign")), 4000);

    const injection = executed.find((code) => code.includes("window.__LR__"));
    let parsed = true;
    let parseError = "";
    try {
      new vm.Script(injection);
    } catch (error) {
      parsed = false;
      parseError = String(error?.message ?? error).slice(0, 200);
    }
    harness.check("the injected overlay bundle parses", injection !== undefined && parsed, parseError);
    harness.check("the client injects the overlay into the guest", injection !== undefined);
    harness.check("the injected code carries no secret", injection !== undefined && !injection.includes("a".repeat(64)) && !/secret\s*:/i.test(injection), (injection ?? "").slice(0, 200));
    harness.check("the guest really runs the relay", pageWindow.__LR_BRIDGE__ !== undefined && pageWindow.__LR_BRIDGE__.mode === "client");
    harness.check("the injected code keeps the page config", pageWindow.__LR__.settings?.keys?.comment === "x" && pageWindow.__LR__.marker === "kept" && pageWindow.__LR__.apiBase !== undefined && !("secret" in pageWindow.__LR__), JSON.stringify(Object.keys(pageWindow.__LR__)));

    // The page asks for something; the client answers; the page is happy.
    const pending = pageWindow.__LR_BRIDGE__.send("annotations.submit", { pageUrl: "https://example.com/", pins: [{ id: "p1" }] });
    const answered = await Promise.race([
      pending.then((value) => ({ ok: true, value })).catch((error) => ({ ok: false, error })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "timeout" }), 6000))
    ]);
    harness.check("the page promise resolves with the host answer", answered.ok === true && answered.value?.ok === true && answered.value?.count === 1, JSON.stringify(answered).slice(0, 160));

    const bridgeCall = calls.find((call) => call.url.endsWith("/.lr/bridge") && call.method === "POST");
    harness.check("the client performs the bridge call the page asked for", bridgeCall !== undefined, JSON.stringify(calls.map((call) => call.url.slice(0, 60))));
    harness.check("the bridge call carries the instance secret", bridgeCall !== undefined && Object.values(bridgeCall.headers ?? {}).some((value) => String(value).includes("a".repeat(64))), JSON.stringify(bridgeCall?.headers));
    harness.check("the bridge call carries the message the page queued", String(bridgeCall?.body ?? "").includes("annotations.submit"), String(bridgeCall?.body ?? ""));
    const delivery = executed.find((code) => /__LR_BRIDGE_DELIVER__\("/.test(code));
    harness.check("the client delivers the answer back to the page", delivery !== undefined, (delivery ?? "").slice(0, 120));
    const delivered = /__LR_BRIDGE_DELIVER__\(("(?:[^"\\]|\\.)*")\)/.exec(delivery ?? "");
    let deliveredAnswers = [];
    try {
      deliveredAnswers = JSON.parse(JSON.parse(delivered?.[1] ?? "\"[]\""));
    } catch {
      deliveredAnswers = [];
    }
    harness.check("the client delivers the answers as an array", Array.isArray(deliveredAnswers) && deliveredAnswers.length === 1 && deliveredAnswers[0].ok === true, JSON.stringify(deliveredAnswers).slice(0, 160));

    harness.check("the overlay never writes drawings to web storage",
      !overlay.includes('"lr-drawings"') && !template.includes('"lr-drawings"'),
      `built ${overlay.includes('"lr-drawings"')} | template ${template.includes('"lr-drawings"')}`);
    harness.check("the panel positions live in session storage",
      template.includes("sessionStorage.getItem(PANEL_POS_KEY)") &&
      template.includes("sessionStorage.setItem(PANEL_POS_KEY") &&
      overlay.includes("sessionStorage.getItem(PANEL_POS_KEY)") &&
      overlay.includes("sessionStorage.setItem(PANEL_POS_KEY") &&
      !template.includes("localStorage") && !overlay.includes("localStorage"),
      `template ${template.includes("localStorage")} | built ${overlay.includes("localStorage")}`);

    const targetStart = template.indexOf("const TARGET = ");
    const targetEnd = template.indexOf("})();", targetStart);
    const targetExpr = targetStart === -1 || targetEnd === -1 ? "" : template.slice(targetStart + "const TARGET = ".length, targetEnd + 4);
    const runTarget = (windowStub) => targetExpr === "" ? null : vm.runInNewContext(targetExpr, { window: windowStub, URL });
    const proxyTarget = runTarget({ __LR__: { pageUrl: "https://site.example/review?x=1" }, location: { href: "http://127.0.0.1:47477/p/abc", origin: "http://127.0.0.1:47477", pathname: "/p/abc" } });
    const guestTarget = runTarget({ location: { href: "https://guest.example/page?y=2", origin: "https://guest.example", pathname: "/page" } });
    harness.check("the overlay keys the pins by the target site",
      template.includes("const STORE_KEY = `lr:pins:${TARGET.origin}${TARGET.path}`") &&
      overlay.includes("const STORE_KEY = `lr:pins:${TARGET.origin}${TARGET.path}`") &&
      !template.includes('"lr:pins:" + PAGE_URL') &&
      !overlay.includes('"lr:pins:" + PAGE_URL'),
      `template ${template.includes("const STORE_KEY = `lr:pins:${TARGET.origin}${TARGET.path}`")}`);
    harness.check("the overlay keys the panel positions by the target site",
      template.includes("const PANEL_POS_KEY = `lr-panel-pos:${TARGET.origin}${TARGET.path}`") &&
      overlay.includes("const PANEL_POS_KEY = `lr-panel-pos:${TARGET.origin}${TARGET.path}`") &&
      !template.includes('"lr-panel-pos:" + PAGE_URL') &&
      !overlay.includes('"lr-panel-pos:" + PAGE_URL'),
      `template ${template.includes("const PANEL_POS_KEY = `lr-panel-pos:${TARGET.origin}${TARGET.path}`")}`);
    harness.check("the overlay derives the target from the injected page url",
      proxyTarget !== null && guestTarget !== null &&
      proxyTarget.origin === "https://site.example" && proxyTarget.path === "/review" &&
      guestTarget.origin === "https://guest.example" && guestTarget.path === "/page" &&
      template.indexOf("const TARGET = ") < template.indexOf("const STORE_KEY = ") &&
      template.indexOf("const TARGET = ") < template.indexOf("const PANEL_POS_KEY = "),
      `proxy ${JSON.stringify(proxyTarget)} | guest ${JSON.stringify(guestTarget)}`);

    const injected = executed.find((code) => code.includes("window.__LR__ = Object.assign")) ?? injection;
    const cleanupLine = (injected ?? "").split("\n")[0];
    const clientSeed = { "lr-drawings": "old", "lr-drawings:https://a.example": "old", marker: "kept" };
    const clientStore = storageShim(clientSeed);
    assert.deepEqual(Object.keys(clientStore), Object.keys(clientSeed));
    vm.runInContext(cleanupLine, vm.createContext({ localStorage: clientStore }), { filename: "client-cleanup.js" });
    harness.check("the client injection removes the legacy drawings keys",
      cleanupLine.includes("lr-drawings") && cleanupLine.includes("Object.keys(localStorage)") &&
      pageWindow.__LR__.marker === "kept" && JSON.stringify(Object.keys(clientStore)) === JSON.stringify(["marker"]),
      JSON.stringify(Object.keys(clientStore)));

    const hostSource = readFileSync(path.join(pluginDir, "lib", "index.js"), "utf8");
    harness.check("the host guard derives its keep-keys from the target url",
      hostSource.includes("new URL(targetUrl)") &&
      hostSource.includes("JSON.stringify(targetKeys.pin)") &&
      hostSource.includes("JSON.stringify(targetKeys.panel)") &&
      !/const pinKey = "lr:pins:" \+ href/.test(hostSource),
      "the guard must not keep the href-keyed pin");

    const relayPurgeSeed = { "lr-drawings": "late", "lr-drawings:https://a.example": "late", marker: "kept", unrelated: "kept" };
    const loadRelayWithStorage = (code) => {
      const store = storageShim(relayPurgeSeed);
      const windowStub = { __LR_BRIDGE_MODE__: "client", location: { href: "https://example.com/" }, localStorage: store };
      const sandbox = vm.createContext({
        window: windowStub,
        fetch: async () => { throw new Error("fetch was not stubbed"); },
        setTimeout,
        clearTimeout,
        console: { log() {}, warn() {}, error() {} }
      });
      vm.runInContext(code, sandbox, { filename: "bridge-relay.js" });
      return { store, keys: Object.keys(store) };
    };
    const bridgePath = path.join(pluginDir, "lib", "bridge.js");
    const relayPurged = loadRelayWithStorage(readFileSync(bridgePath, "utf8"));
    harness.check("the bridge relay purges the legacy drawings keys", JSON.stringify(relayPurged.keys) === JSON.stringify(["marker", "unrelated"]), JSON.stringify(relayPurged.keys));
    const relayUnpurged = loadRelayWithStorage("(() => { \"use strict\"; if (window.__LR_BRIDGE__) return; const MODE = window.__LR_BRIDGE_MODE__ === \"client\" ? \"client\" : \"direct\"; })();");
    assert.deepEqual(relayUnpurged.keys, Object.keys(relayPurgeSeed));
  }

  harness.section("client: the guest url the harness browser actually exposes");
  {
    const overlaySource = readFileSync(path.join(pluginDir, "lib", "overlay.js"), "utf8");
    const bridgeSource = readFileSync(path.join(pluginDir, "lib", "bridge.js"), "utf8");

    const runGuest = async (guestUrl, attributeUrl) => {
      const executed = [];
      const mountModel = createMountModel();
      class FakeElement {}
      const guest = new FakeElement();
      guest.dataset = { liveReviewWired: undefined };
      guest.getAttribute = (name) => (name === "src" ? attributeUrl : null);
      guest.getURL = () => guestUrl;
      guest.addEventListener = (type, handler) => {
        if (type === "dom-ready") setTimeout(() => handler(), 0);
      };
      guest.executeJavaScript = async (code) => {
        executed.push(code);
        const answered = mountModel.answer(code);
        return answered === undefined ? "[]" : answered;
      };
      const documentStub = {
        createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
        head: { appendChild() {} },
        body: { appendChild() {} },
        documentElement: {},
        readyState: "complete",
        querySelector: () => null,
        querySelectorAll: (selector) => (typeof selector === "string" && selector.includes("webview") ? [guest] : []),
        addEventListener() {},
        removeEventListener() {}
      };
      const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
        react: createReactStub().React,
        localStorage: makeLocalStorage(),
        document: documentStub,
        sandbox: { Element: FakeElement, MutationObserver: class { observe() {} } },
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, options) => {
          const target = String(url);
          if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
          if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
          if (target.endsWith("/.lr/overlay.js")) return new Response(overlaySource, { status: 200, headers: { "content-type": "text/javascript" } });
          if (target.endsWith("/.lr/bridge.js")) return new Response(bridgeSource, { status: 200, headers: { "content-type": "text/javascript" } });
          return jsonResponse({});
        }
      });
      const client = fakeClientCtx({});
      module.apply(client.ctx);
      client.resolve();
      await waitFor(() => executed.some((code) => code.includes("window.__LR__ = Object.assign")), 4000);
      return executed;
    };

    const harnessGuest = await runGuest("https://review.example/page", "about:blank#lease-1");
    harness.check("the client injects the overlay into a guest whose src is the lease token",
      harnessGuest.some((code) => code.includes("window.__LR__ = Object.assign")),
      `executed ${harnessGuest.length} scripts`);

    const emptyGuest = await runGuest("about:blank#lease-2", "about:blank#lease-2");
    harness.check("the client does not inject the overlay into a guest that never navigated",
      !emptyGuest.some((code) => code.includes("window.__LR__ = Object.assign")),
      `executed ${emptyGuest.length} scripts`);

    const attributeGuest = await runGuest(undefined, "https://legacy.example/page");
    harness.check("the client injects the overlay when only the src attribute names the page",
      attributeGuest.some((code) => code.includes("window.__LR__ = Object.assign")),
      `executed ${attributeGuest.length} scripts`);

    let domReadyCb = null;
    let didStartLoadingCb = null;
    const reloadExecuted = [];
    const reloadMountModel = createMountModel();
    class ReloadElement {}
    const reloadGuest = new ReloadElement();
    reloadGuest.dataset = { liveReviewWired: undefined };
    reloadGuest.getAttribute = (name) => (name === "src" ? "about:blank#lease-reload" : null);
    reloadGuest.getURL = () => "https://review.example/reload-page";
    reloadGuest.addEventListener = (type, handler) => {
      if (type === "dom-ready") domReadyCb = handler;
      if (type === "did-start-loading") didStartLoadingCb = handler;
    };
    reloadGuest.executeJavaScript = async (code) => {
      reloadExecuted.push(code);
      const answered = reloadMountModel.answer(code);
      return answered === undefined ? "[]" : answered;
    };
    const reloadDoc = {
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      documentElement: {},
      readyState: "complete",
      querySelector: () => null,
      querySelectorAll: (selector) => (typeof selector === "string" && selector.includes("webview") ? [reloadGuest] : []),
      addEventListener() {},
      removeEventListener() {}
    };
    const { module: reloadMod } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: createReactStub().React,
      localStorage: makeLocalStorage(),
      document: reloadDoc,
      sandbox: { Element: ReloadElement, MutationObserver: class { observe() {} } },
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: 47477 });
        if (target.endsWith("/.lr/overlay.js")) return new Response(overlaySource, { status: 200, headers: { "content-type": "text/javascript" } });
        if (target.endsWith("/.lr/bridge.js")) return new Response(bridgeSource, { status: 200, headers: { "content-type": "text/javascript" } });
        return jsonResponse({});
      }
    });
    const reloadClient = fakeClientCtx({});
    reloadMod.apply(reloadClient.ctx);
    reloadClient.resolve();
    domReadyCb?.();
    await waitFor(() => reloadExecuted.length > 0, 4000);
    const initialInjections = reloadExecuted.length;

    didStartLoadingCb?.();
    domReadyCb?.();
    await waitFor(() => reloadExecuted.length > initialInjections, 4000);
    harness.check("the client re-injects the overlay into a guest after a reload (F5)",
      reloadExecuted.length > initialInjections,
      `before=${initialInjections} after=${reloadExecuted.length}`);
  }

  harness.section("client: injection verification and recovery");
  {
    const overlaySource = readFileSync(path.join(pluginDir, "lib", "overlay.js"), "utf8");
    const bridgeSource = readFileSync(path.join(pluginDir, "lib", "bridge.js"), "utf8");
    const buildVerified = (modelOptions = {}) => {
      const executed = [];
      const intervals = [];
      const listeners = {};
      const mountModel = createMountModel(modelOptions);
      class VerifiedElement {}
      const guest = new VerifiedElement();
      guest.dataset = { liveReviewWired: undefined };
      guest.getAttribute = (name) => (name === "src" ? "about:blank#lease-verify" : null);
      guest.getURL = () => "https://review.example/verify-page";
      guest.addEventListener = (type, handler) => { listeners[type] = handler; };
      guest.executeJavaScript = async (code) => {
        executed.push(code);
        const answered = mountModel.answer(code);
        return answered === undefined ? "[]" : answered;
      };
      const documentStub = {
        createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
        head: { appendChild() {} },
        body: { appendChild() {} },
        documentElement: {},
        readyState: "complete",
        querySelector: () => null,
        querySelectorAll: (selector) => (typeof selector === "string" && selector.includes("webview") ? [guest] : []),
        addEventListener() {},
        removeEventListener() {}
      };
      const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
        react: createReactStub().React,
        localStorage: makeLocalStorage(),
        document: documentStub,
        sandbox: {
          Element: VerifiedElement,
          MutationObserver: class { observe() {} },
          setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
          clearInterval() {}
        },
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url) => {
          const target = String(url);
          if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
          if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: 47477 });
          if (target.endsWith("/.lr/overlay.js")) return new Response(overlaySource, { status: 200, headers: { "content-type": "text/javascript" } });
          if (target.endsWith("/.lr/bridge.js")) return new Response(bridgeSource, { status: 200, headers: { "content-type": "text/javascript" } });
          return jsonResponse({});
        }
      });
      const client = fakeClientCtx({});
      module.apply(client.ctx);
      client.resolve();
      return { executed, intervals, listeners, guest, mountModel };
    };
    const injections = (run) => run.executed.filter((code) => code.includes("window.__LR__ = Object.assign")).length;
    const probes = (run) => run.executed.filter((code) => code.includes("lrMountState")).length;

    const repaired = buildVerified({ mountAfterRun: 1 });
    await waitFor(() => injections(repaired) >= 2, 5000);
    harness.check("the client repairs a guest whose bundle ran without mounting the overlay",
      injections(repaired) >= 2 && probes(repaired) >= 2,
      `injections=${injections(repaired)} probes=${probes(repaired)}`);

    const steady = buildVerified();
    await waitFor(() => injections(steady) >= 1, 4000);
    const steadyBefore = injections(steady);
    for (const interval of steady.intervals) await interval.fn();
    await new Promise((resolve) => setTimeout(resolve, 900));
    harness.check("the pump does not re-inject a guest that is already injected",
      injections(steady) === steadyBefore,
      `before=${steadyBefore} after=${injections(steady)}`);

    const broken = buildVerified({ mountAfterRun: Number.POSITIVE_INFINITY });
    await waitFor(() => injections(broken) >= 12, 12000);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const brokenAtBudget = injections(broken);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    harness.check("a guest whose overlay never mounts stops at the attempt budget",
      injections(broken) === brokenAtBudget && brokenAtBudget <= 14,
      `at=${brokenAtBudget} then=${injections(broken)} probes=${probes(broken)}`);

    const lost = buildVerified();
    await waitFor(() => injections(lost) >= 1, 4000);
    const beforeRecovery = injections(lost);
    lost.listeners["did-start-loading"]?.();
    for (const interval of lost.intervals) await interval.fn();
    await waitFor(() => injections(lost) > beforeRecovery, 4000);
    harness.check("the bridge pump re-injects a guest whose document changed without dom-ready",
      injections(lost) > beforeRecovery,
      `before=${beforeRecovery} after=${injections(lost)}`);
  }

  harness.section("client: overlay locales");
  {
    const locales = localeKeys(overlay);
    if (harness.check("the overlay carries the locale dictionaries", locales !== undefined)) {
      const codes = Object.keys(locales);
      harness.eq("the overlay ships three languages", codes.sort(), ["en", "pt", "zh"]);
      const reference = locales[codes[0]].slice().sort();
      for (const code of codes) {
        harness.eq(`the ${code} dictionary has the same keys`, locales[code].slice().sort(), reference);
      }
      const dictionaries = evaluateObjectLiteral(extractObjectLiteral(overlay, "const UI_LOCALES"), "UI_LOCALES");
      const missing = [];
      for (const key of translationKeys(overlay)) {
        if (key.endsWith(".*")) continue;
        for (const code of codes) {
          if (dictionaries[code][key] === undefined) missing.push(`${code}:${key}`);
        }
      }
      harness.check("every translated key exists in every language", missing.length === 0, missing.slice(0, 8).join(", "));

      const props = editableProps(overlay);
      const propMissing = [];
      for (const prop of props) {
        for (const code of codes) {
          if (dictionaries[code][`prop.${prop}`] === undefined) propMissing.push(`${code}:prop.${prop}`);
        }
      }
      harness.check("every editable property is labelled in every language", propMissing.length === 0, propMissing.slice(0, 8).join(", "));
      harness.check("the editable property list is not empty", props.length > 0, String(props.length));

      const propMeta = evaluateObjectLiteral(extractObjectLiteral(overlay, "const PROP_META"), "PROP_META");
      const metaMissing = [];
      for (const prop of Object.keys(propMeta ?? {})) {
        for (const code of codes) {
          if (dictionaries[code][`prop.${prop}`] === undefined) metaMissing.push(`${code}:prop.${prop}`);
        }
      }
      harness.check("every property of the inspector is labelled in every language", metaMissing.length === 0, metaMissing.slice(0, 8).join(", "));

      // The mirrors in locale/ are what a translator reads. A mirror that drifts from the inline
      // tables sends the translator to the wrong text. The mirrors carry BOTH inline tables: the
      // overlay's and the settings panel's.
      const panel = evaluateObjectLiteral(extractObjectLiteral(client, "const L = {"), "L") ?? {};
      const mirrorOf = { en: "en.json", pt: "pt-BR.json", zh: "zh-CN.json" };
      const drifted = [];
      for (const [code, file] of Object.entries(mirrorOf)) {
        const mirror = JSON.parse(readFileSync(path.join(pluginDir, "locale", file), "utf8"));
        const tables = { ...(dictionaries[code] ?? {}), ...(panel[code] ?? {}) };
        for (const [key, value] of Object.entries(tables)) {
          if (mirror[key] !== value) drifted.push(`${code}:${key}`);
        }
        for (const key of Object.keys(mirror)) {
          if (key === "meta") continue;
          if (tables[key] === undefined) drifted.push(`${code}:${key} (only in the mirror)`);
        }
      }
      harness.check("the translation mirrors match the inline tables", drifted.length === 0, drifted.slice(0, 8).join(", "));
    }
  }

  harness.section("client: overlay image details");
  {
    const formatOf = extractFunction(overlay, "imageFormatHint");
    const scaleNote = extractFunction(overlay, "imageScaleNote");
    const runFormat = formatOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${formatOf}
      return JSON.stringify([imageFormatHint("https://x.test/a.png"), imageFormatHint("https://x.test/a.JPEG?w=9"), imageFormatHint("data:image/webp;base64,AA"), imageFormatHint("blob:https://x.test/9"), imageFormatHint("https://x.test/a.unknownext"), imageFormatHint("https://x.test/noext"), imageFormatHint("")]);
    }`, "imageFormatHint")());
    harness.eq("overlay: the image format hint reads extensions, data urls and blob urls",
      runFormat,
      ["png", "jpg", "webp", "blob", "", "", ""]);
    const runScale = scaleNote === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${scaleNote}
      return JSON.stringify([imageScaleNote(1600, 800), imageScaleNote(400, 800), imageScaleNote(1000, 970), imageScaleNote(640, 640), imageScaleNote(0, 100), imageScaleNote(NaN, 100)]);
    }`, "imageScaleNote")());
    harness.eq("overlay: the scale note flags served-vs-displayed divergence beyond tolerance only",
      runScale,
      [
        { key: "imgDetailsDownscaled", p: 50 },
        { key: "imgDetailsUpscaled", p: 100 },
        null,
        null,
        null,
        null
      ]);
    harness.check("overlay: the pin bubble renders the image details section only for img targets",
      template.includes('String(auditTarget.tagName ?? "").toUpperCase() === "IMG" ? imageDetailsSection(auditTarget) : null'),
      "wiring line missing");
    harness.check("overlay: the image details section warns about a missing alt attribute",
      template.includes('img.hasAttribute?.("alt") === false ? el("div", { class: "lr-img-note" }, t("imgDetailsAltMissing")) : null'),
      "alt warning missing");
  }

  harness.section("client: overlay px rem toggle");
  {
    const toRem = extractFunction(overlay, "pxToRem");
    const toPx = extractFunction(overlay, "remToPx");
    const run = toRem === undefined || toPx === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${toRem}
      ${toPx}
      return JSON.stringify([pxToRem(32, 16), remToPx(2, 16), pxToRem(18, 18), remToPx(1.5, 0), pxToRem(32, NaN)]);
    }`, "pxRemConverters")());
    harness.eq("overlay: px and rem convert through the root font size with a 16px default", run, [2, 32, 1, 24, 2]);
    const rootOf = extractFunction(overlay, "rootFontSizePx");
    let calls = 0;
    const runRoot = rootOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`(getComputedStyle, document) => {
      ${rootOf}
      return JSON.stringify([rootFontSizePx(), rootFontSizePx(), rootFontSizePx()]);
    }`, "rootFontSizePx")(
        () => ({ fontSize: ["18px", "0px", "bogus"][calls++] }),
        { documentElement: {} }
      ));
    harness.eq("overlay: the root font size falls back to 16px when unreadable", runRoot, [18, 16, 16]);
    harness.check("overlay: the unit toggle state resets with the adjust panel",
      (template.match(/adjustUnitRem = new Set\(\)/gu) ?? []).length >= 2,
      "declaration and reset sites missing");
    harness.check("overlay: the rem display converts back to px before applying",
      template.includes("adjustUpdateProperty(prop, toApply(next))") && template.includes("(meta.step ?? 1) / rootFontSizePx()"),
      "apply conversion or step scaling missing");
    harness.check("overlay: the row refresh re-renders through the unit display",
      template.includes('scrub.__refresh(toDisplay(adjustValues.get(prop) ?? ""))'),
      "refresh conversion missing");
  }

  harness.section("client: overlay custom viewport widths");
  {
    const normalize = extractFunction(overlay, "normalizeViewportPresets");
    const run = normalize === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${normalize}
      return JSON.stringify([normalizeViewportPresets([100, 5000, "x", 900, 900, 1000]), normalizeViewportPresets([800.7, 200]), normalizeViewportPresets(null)]);
    }`, "normalizeViewportPresets")());
    harness.eq("overlay: custom widths clamp to three integers between 200 and 4000", run, [[900, 1000], [801, 200], []]);
    harness.check("overlay: the viewport menu lists the saved widths and the custom input row",
      template.includes('...viewportPresets.map((px) => ({ value: { kind: "width", px }, label: `${px}px` }))') && template.includes("{ node: viewportCustomRow() }"),
      "custom rows missing");
    harness.check("overlay: a saved width persists through the settings bridge message",
      template.includes('bridgeSend("settings.update", { viewportPresets })'),
      "bridge send missing");
    harness.check("overlay: the host answer updates the saved widths on the next poll",
      template.includes("const presets = normalizeViewportPresets(next.viewportPresets);"),
      "applySettings read missing");
  }

  harness.section("client: overlay overflow audit");
  {
    const widthOf = extractFunction(overlay, "overflowWidth");
    const run = widthOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${widthOf}
      const rect = (right, width) => ({ getBoundingClientRect: () => ({ right, width }) });
      return JSON.stringify([overflowWidth(rect(1300, 800), 1280), overflowWidth(rect(1282, 800), 1280), overflowWidth(rect(1280.5, 800), 1280), overflowWidth(rect(1200, 800), 1280), overflowWidth({}, 1280), overflowWidth(rect(1300, 0), 1280), overflowWidth(rect(1300, 800), NaN)]);
    }`, "overflowWidth")());
    harness.eq("overlay: the overflow width measures beyond the viewport with a 1px tolerance", run, [20, 2, null, null, null, null, null]);
    const groupOf = extractFunction(overlay, "groupAuditFindings");
    const titles = evaluateObjectLiteral(extractObjectLiteral(overlay, "const A11Y_GROUP_TITLES"), "A11Y_GROUP_TITLES");
    const labels = evaluateObjectLiteral(extractObjectLiteral(overlay, "const A11Y_ROW_LABELS"), "A11Y_ROW_LABELS");
    const grouped = groupOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`(A11Y_GROUP_TITLES, A11Y_ROW_LABELS) => {
      ${groupOf}
      return JSON.stringify(groupAuditFindings([{ check: "overflow", status: "fail" }, { check: "contrast", status: "fail" }, { check: "overflow", status: "pass" }]).map((group) => ({ check: group.check, title: group.title, count: group.findings.length })));
    }`, "groupAuditFindings")(titles, labels));
    harness.eq("overlay: overflow findings group under the localized title", grouped, [{ check: "overflow", title: "a11yAuditGroupOverflow", count: 1 }, { check: "contrast", title: "a11yAuditGroupContrast", count: 1 }]);
    harness.check("overlay: the overflow scan skips the overlay dom and children of flagged ancestors",
      template.includes("if (rootDiv.contains(element)) continue;") && template.includes("if (hasFlaggedAncestor(element)) continue;") && template.includes('check: "overflow", status: "fail"'),
      "scan wiring missing");
  }

  harness.section("client: overlay composer dictation");
  {
    const localeOf = extractFunction(overlay, "dictateLocale");
    const run = localeOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`(navigator) => {
      ${localeOf}
      return JSON.stringify([dictateLocale("pt"), dictateLocale("zh"), dictateLocale("en"), dictateLocale("auto"), dictateLocale("fr")]);
    }`, "dictateLocale")({ language: "pt-BR" }));
    harness.eq("overlay: dictation maps the overlay language to a speech locale, falling back to the navigator", run, ["pt-BR", "zh-CN", "en-US", "pt-BR", "pt-BR"]);
    harness.check("overlay: the composer carries the dictate control with a feature detect",
      template.includes("const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;") &&
      template.includes('renderTemplateRow(textarea), shotToggle, dictateButton(textarea)'),
      "dictate wiring missing");
    harness.check("overlay: a detached textarea ends its dictation session",
      template.includes("if (!btn.isConnected) {") && template.includes("recognition.onend = () => finish(session);"),
      "session cleanup missing");
  }

  harness.section("client: overlay intro tour");
  {
    const stepsOf = extractFunction(overlay, "tourSteps");
    const run = stepsOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${stepsOf}
      return JSON.stringify([tourSteps({ comment: "c", adjust: "a", draw: null, pending: "p" }).map((step) => step.key), tourSteps({}).length]);
    }`, "tourSteps")());
    harness.eq("overlay: the tour skips steps whose anchor is missing", run, [["tourComment", "tourAdjust", "tourSend"], 0]);
    const positionOf = extractFunction(overlay, "tourBubblePosition");
    const runPos = positionOf === undefined
      ? undefined
      : JSON.parse(evaluateExpression(`() => {
      ${positionOf}
      return JSON.stringify([tourBubblePosition({ left: 100, top: 300, bottom: 330 }, 1280, 800), tourBubblePosition({ left: 40, top: 50, bottom: 80 }, 1280, 800), tourBubblePosition({ left: 1500, top: 400, bottom: 430 }, 1280, 800)]);
    }`, "tourBubblePosition")());
    harness.eq("overlay: the tour bubble clamps to the viewport and flips above tall targets", runPos, [
      { left: 60, top: 204, above: true },
      { left: 8, top: 88, above: false },
      { left: 1012, top: 304, above: true }
    ]);
    harness.check("overlay: the first settings answer arms the tour when the flag is still false",
      template.includes("if (next.tourDone === false && !tourShown && tourNode === null) scheduleTour();") &&
      template.includes('bridgeSend("settings.update", { tourDone: true })'),
      "tour trigger missing");
    harness.check("overlay: the settings panel replays the tour",
      client.includes("save({ tourDone: false })") && client.includes("tourReplay"),
      "replay row missing");
  }

  harness.section("client: panel hotkeys cover every mode");
  {
    harness.check("panel: the capture rows carry comment, adjust, draw and hidePins",
      ["captureKey(\"comment\")", "captureKey(\"adjust\")", "captureKey(\"draw\")", "captureKey(\"hidePins\")"].every((call) => client.includes(call)),
      "capture row missing");
    harness.check("panel: a key the browser reserves is reported instead of silently dropped",
      client.includes("keyHint") && client.includes("L.reservedKey"),
      "reserved key hint missing");
  }

  harness.section("client: locale integrity");
  {
    const overlayLiteral = extractObjectLiteral(overlay, "const UI_LOCALES");
    const cardLiteral = extractObjectLiteral(client, "const UI_LOCALES");
    const panelLiteral = extractObjectLiteral(client, "const L = {");
    const keyNames = (span) => {
      const names = [];
      for (const match of span.matchAll(/(?:^|[{,])\s*(?:"([A-Za-z0-9_.:-]+)"|([A-Za-z0-9_$-]+))\s*:/g)) names.push(match[1] ?? match[2]);
      return names;
    };
    const duplicatesOf = (literal, codes, quoted) => {
      if (literal === undefined) return ["table not found"];
      const found = [];
      for (const code of codes) {
        const span = extractObjectLiteral(literal, quoted ? `"${code}":` : `${code}:`);
        if (span === undefined) { found.push(`${code}:dictionary not found`); continue; }
        const counts = new Map();
        for (const key of keyNames(span)) counts.set(key, (counts.get(key) ?? 0) + 1);
        for (const [key, count] of counts) if (count > 1) found.push(`${code}:${key}`);
      }
      return found;
    };
    const duplicates = [
      ...duplicatesOf(overlayLiteral, ["en", "pt", "zh"], true).map((entry) => `overlay:${entry}`),
      ...duplicatesOf(cardLiteral, ["en", "pt", "zh"], true).map((entry) => `card:${entry}`),
      ...duplicatesOf(panelLiteral, ["en", "pt", "zh"], false).map((entry) => `panel:${entry}`)
    ];
    harness.check("no locale dictionary defines a key twice", duplicates.length === 0, duplicates.slice(0, 8).join(", "));

    const card = evaluateObjectLiteral(cardLiteral, "UI_LOCALES");
    const panel = evaluateObjectLiteral(panelLiteral, "L");
    const incomplete = (table) => {
      if (table === undefined) return ["table not found"];
      const codes = Object.keys(table);
      const reference = Object.keys(table[codes[0]] ?? {}).slice().sort();
      const problems = [];
      for (const code of codes) {
        const keys = Object.keys(table[code] ?? {}).slice().sort();
        if (JSON.stringify(keys) !== JSON.stringify(reference)) problems.push(`${code}:key set differs`);
        for (const [key, value] of Object.entries(table[code] ?? {})) {
          if (typeof value !== "string" || value === "") problems.push(`${code}:${key}:empty`);
        }
      }
      return problems;
    };
    const cardProblems = incomplete(card);
    harness.check("the client card dictionary is complete in every language", cardProblems.length === 0, cardProblems.slice(0, 8).join(", "));
    const panelProblems = incomplete(panel);
    harness.check("the settings panel dictionary is complete in every language", panelProblems.length === 0, panelProblems.slice(0, 8).join(", "));

    const undefinedKeys = translationKeys(client).filter((key) => !key.endsWith(".*")).filter((key) => card === undefined || !(key in card.en));
    harness.check("every client translation uses a key its dictionary defines", undefinedKeys.length === 0, undefinedKeys.slice(0, 8).join(", "));

    const overlayTable = evaluateObjectLiteral(overlayLiteral, "UI_LOCALES");
    const shared = overlayTable === undefined || panel === undefined ? ["table not found"] : Object.keys(panel.en).filter((key) => key in overlayTable.en);
    harness.check("the overlay and the settings panel share no key", shared.length === 0, shared.slice(0, 8).join(", "));
  }

  harness.section("client: overlay build");
  {
    const missing = REQUIRED_OVERLAY_SYMBOLS.filter((symbol) => !overlay.includes(symbol));
    harness.check("the built overlay keeps its core symbols", missing.length === 0, missing.join(", "));
    const css = readFileSync(path.join(pluginDir, "tencil-overlay.css"), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
    const source = template.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
    const expected = source.replace('"__TENCIL_CSS__"', JSON.stringify(css));
    harness.check("the built overlay matches the template", expected === overlay, `template ${expected.length} chars, built ${overlay.length} chars`);
    const templateMissing = REQUIRED_OVERLAY_SYMBOLS.filter((symbol) => !template.includes(symbol));
    harness.check("the template keeps its core symbols", templateMissing.length === 0, templateMissing.join(", "));
    harness.check("the popover drag handle is wired on every panel", ["composerNode, \"composer\"", "panel, \"pin\"", "panel, \"adjust\""].every((call) => template.includes(`wirePanelDrag(${call}`)), template.includes("function wirePanelDrag") ? "call missing" : "function missing");
    harness.check("the drag handle keeps the page scrollable from the panel body", css.includes(".popover .composer-target { cursor: grab; touch-action: none;") && css.includes(".composer-target button { cursor: pointer; touch-action: auto; }"), css.includes(".popover .composer-target { cursor: grab;") ? "body rule missing" : "handle rule missing");
    const drag = extractFunction(template, "wirePanelDrag");
    harness.check("the drag handle leaves interactive controls clickable", drag !== undefined && drag.includes("isInteractivePanelTarget(event.target)") && /pointerdown|mousedown|touchstart/u.test(drag), drag === undefined ? "wirePanelDrag missing" : "interactive guard missing");
    harness.check("both popovers wire their close button as a button", template.includes('class: "lr-close", title: t("composerClose"), type: "button"') && template.includes('class: "lr-close", title: t("panelClose"), type: "button"'), "close buttons missing type");
    harness.check("the draft pin carries the tencil rim shimmer", css.includes(".pin-draft .pin-body") && css.includes("rim-travel 2.4s linear infinite"), css.includes("rim-travel") ? "draft rule missing" : "rim animation missing");
    // .pin is position:fixed with no transformed ancestor, so anchorPoint must work in
    // viewport coordinates; html2canvas is the one legitimate scroll consumer and keeps its offsets.
    const anchor = extractFunction(overlay, "anchorPoint");
    harness.check("the pin anchor uses viewport coordinates", anchor !== undefined && !anchor.includes("scrollX") && !anchor.includes("scrollY"), anchor === undefined ? "anchorPoint missing" : "anchorPoint still adds scroll offsets");
    const capture = extractFunction(overlay, "captureCropFor");
    harness.check("the screenshot capture still passes scroll offsets to html2canvas", capture !== undefined && capture.includes("scrollX: window.scrollX") && capture.includes("scrollY: window.scrollY"), capture === undefined ? "captureCropFor missing" : "captureCropFor lost its scroll offsets");
    const reposition = extractFunction(overlay, "repositionPins");
    harness.check("repositioning the page does not rebuild the comment draft", reposition !== undefined && !reposition.includes("renderDraft("), reposition === undefined ? "repositionPins missing" : "repositionPins still calls renderDraft");
    const renderer = extractFunction(overlay, "renderDraft");
    const opener = extractFunction(overlay, "openDraft");
    harness.check("opening a draft still renders it", renderer !== undefined && opener !== undefined && opener.includes("renderDraft("), renderer === undefined ? "renderDraft missing" : opener === undefined ? "openDraft missing" : "openDraft no longer calls renderDraft");
    const poll = extractFunction(overlay, "pollStatus");
    harness.check("the overlay removes queued pins only by delivered id", poll !== undefined && poll.includes("data.deliveredIds") && poll.includes("gone.has(p.id)") && !poll.includes("deliveredAt"), poll === undefined ? "pollStatus missing" : "pollStatus no longer keys removal on delivered ids");
  }

  harness.section("client: overlay pin re-anchoring");
  {
    const auditSource = extractFunction(overlay, "auditPinAnchors");
    const audit = auditSource === undefined ? undefined : evaluateExpression(`(locate, pins, pinNodes) => {\n${auditSource}\nauditPinAnchors();\n}`, "auditPinAnchors");
    const nodeWithClasses = () => {
      const classes = new Set();
      return { classes, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
    };
    harness.check("the overlay keeps its anchor auditor", audit !== undefined);
    {
      const staleNode = nodeWithClasses();
      const liveNode = nodeWithClasses();
      const pins = [
        { id: "gone", tag: "h1", selector: "#gone" },
        { id: "here", tag: "h1", selector: "#here" }
      ];
      const pinNodes = new Map([["gone", { node: staleNode }], ["here", { node: liveNode }]]);
      const locate = (selector) => (selector === "#here" ? { id: "here" } : null);
      if (audit !== undefined) audit(locate, pins, pinNodes);
      const renderer = extractFunction(overlay, "renderPins");
      harness.check("overlay: the debounced observer path marks unlocatable pins stale instead of reusing the old rect",
        audit !== undefined && pins[0].stale === true && staleNode.classes.has("lr-pin-stale") &&
        pins[1].stale !== true && !liveNode.classes.has("lr-pin-stale") &&
        renderer !== undefined && renderer.includes("pin.stale === true ? null :"),
        JSON.stringify({ stale: pins.map((p) => p.stale), renderedFallback: renderer?.includes("?? { x: pin.rect.x") }));
    }
    {
      const drawNode = nodeWithClasses();
      const realNode = nodeWithClasses();
      const pins = [
        { id: "draw", tag: "canvas", selector: "canvas:drawing" },
        { id: "real", tag: "h1", selector: "#real" }
      ];
      const pinNodes = new Map([["draw", { node: drawNode }], ["real", { node: realNode }]]);
      if (audit !== undefined) audit(() => null, pins, pinNodes);
      harness.check("overlay: canvas draw pins are exempt from stale classification",
        audit !== undefined && pins[0].stale === undefined && drawNode.classes.size === 0 &&
        pins[1].stale === true && realNode.classes.has("lr-pin-stale"),
        JSON.stringify({ draw: pins[0].stale, real: pins[1].stale, drawClasses: [...drawNode.classes] }));
    }
    {
      const reposition = extractFunction(overlay, "repositionPins");
      const schedule = extractFunction(overlay, "scheduleReposition");
      const scrollLine = overlay.split("\n").find((line) => line.includes('addEventListener("scroll"') && line.includes("scheduleReposition")) ?? "";
      const resizeLine = overlay.split("\n").find((line) => line.includes('addEventListener("resize"') && line.includes("scheduleReposition")) ?? "";
      harness.check("overlay: the scroll and resize paths reposition without classifying stale",
        reposition !== undefined && !reposition.includes("auditPinAnchors") &&
        schedule !== undefined && schedule.includes("repositionPins()") &&
        scrollLine.includes("scheduleReposition") && resizeLine.includes("scheduleReposition"),
        JSON.stringify({ scroll: scrollLine.trim(), resize: resizeLine.trim() }));
    }
    {
      const node = nodeWithClasses();
      const pins = [{ id: "p", tag: "h1", selector: "#x" }];
      const pinNodes = new Map([["p", { node }]]);
      let element = null;
      if (audit !== undefined) audit(() => element, pins, pinNodes);
      const marked = pins[0].stale === true && node.classes.has("lr-pin-stale");
      element = { id: "x" };
      if (audit !== undefined) audit(() => element, pins, pinNodes);
      const recovered = pins[0].stale === false && !node.classes.has("lr-pin-stale");
      const dragClears = extractFunction(overlay, "wirePinDrag").includes("pin.stale = false");
      harness.check("overlay: stale clears when the target is found again or the pin is re-anchored by drag",
        audit !== undefined && marked && recovered && dragClears,
        JSON.stringify({ marked, recovered, dragClears }));
    }
  }

  harness.section("client: overlay before/after captures");
  {
    const captureSource = extractFunction(overlay, "captureBeforeAfter");
    const runCapture = captureSource === undefined ? undefined : evaluateExpression(`(screenshotOnSend, captureCropFor, restoreAll, applyCommitted, adjustPatch, target, pin) => {\nlet captureCancelled = false;\n${captureSource}\nreturn captureBeforeAfter(target, pin);\n}`, "captureBeforeAfter");
    const captureTarget = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }) };
    harness.check("the overlay keeps its capture chain", runCapture !== undefined);
    const makeStubs = () => {
      const state = { order: [], rects: [], applyArgs: null };
      return {
        state,
        capture: async (rect) => { state.order.push("capture"); state.rects.push(rect); return state.order.filter((step) => step === "capture").length === 1 ? "after-data" : "before-data"; },
        restore: () => { state.order.push("restore"); },
        apply: (patch, changes, textChange) => { state.order.push("apply"); state.applyArgs = [patch, changes, textChange]; }
      };
    };
    {
      const { state, capture, restore, apply } = makeStubs();
      const pin = { changes: [{ prop: "color", before: "#000", after: "red" }], shot: null };
      const pending = runCapture === undefined ? null : runCapture(true, capture, restore, apply, { id: "patch" }, captureTarget, pin);
      await pending;
      harness.check("overlay: confirm captures the after shot before restore and the before shot after restore",
        pending !== null && state.order.join(",") === "capture,restore,capture,apply" &&
        state.rects.length === 2 && state.rects[0] === state.rects[1] &&
        pin.afterShot === "after-data" && pin.shot === "before-data" &&
        state.applyArgs !== null && state.applyArgs[0]?.id === "patch" && state.applyArgs[1] === pin.changes,
        JSON.stringify({ order: state.order, afterShot: pin.afterShot, shot: pin.shot }));
    }
    {
      const { state, capture, restore, apply } = makeStubs();
      const pin = { changes: [{ prop: "color", before: "#000", after: "red" }], shot: "old-shot" };
      const pending = runCapture === undefined ? null : runCapture(false, capture, restore, apply, { id: "patch" }, captureTarget, pin);
      await pending;
      harness.check("overlay: confirm skips captures when screenshots are disabled",
        pending !== null && state.order.length === 0 && pin.afterShot === undefined && pin.shot === "old-shot",
        JSON.stringify({ order: state.order, shot: pin.shot }));
    }
    {
      const { state, capture, restore, apply } = makeStubs();
      const emptyPin = { changes: [], shot: "kept" };
      const textOnlyPin = { changes: [], textChange: { before: "a", after: "b" }, shot: null };
      const first = runCapture === undefined ? null : runCapture(true, capture, restore, apply, { id: "patch" }, captureTarget, emptyPin);
      await first;
      const before = state.order.length;
      const second = runCapture === undefined ? null : runCapture(true, capture, restore, apply, { id: "patch" }, captureTarget, textOnlyPin);
      await second;
      harness.check("overlay: confirm skips captures when the adjustment has no changes and no text change",
        first !== null && second !== null && before === 0 && emptyPin.shot === "kept" && emptyPin.afterShot === undefined &&
        state.order.length > before && textOnlyPin.afterShot !== undefined && textOnlyPin.shot !== null,
        JSON.stringify({ emptyOrder: state.order.slice(0, before), textOrder: state.order.slice(before) }));
    }
    {
      const postSource = extractFunction(overlay, "postSnapshot");
      let captured = null;
      const bridgeSend = async (type, payload) => { captured = payload; return { ok: true }; };
      const pins = [{ id: "x", tag: "h1", selector: "#x", comment: "c", changes: [], status: "queued", shot: "before-data", afterShot: "after-data", stale: true }];
      if (postSource !== undefined) {
        const post = evaluateExpression(`(bridgeSend, pins, PAGE_URL, document, setHint, updateToolbar, toast, t) => {\n${postSource}\nreturn postSnapshot();\n}`, "postSnapshot");
        await post(bridgeSend, pins, "http://page/", { title: "T" }, () => {}, () => {}, () => {}, (key) => key);
      }
      const forwarded = captured?.pins?.[0];
      harness.check("overlay: postSnapshot forwards afterShot on the pin payload",
        forwarded !== undefined && forwarded.afterShot === "after-data" && forwarded.shot === "before-data" &&
        !("stale" in forwarded) && forwarded.stale === undefined,
        JSON.stringify(forwarded ?? captured));
    }
    {
      const postSource = extractFunction(overlay, "postSnapshot");
      let captured = null;
      const bridgeSend = async (type, payload) => { captured = payload; return { ok: true }; };
      const pins = [{ id: "x", tag: "h1", selector: "#x", comment: "c", changes: [], status: "queued", shot: "before-data", afterShot: "after-data", pastedShot: "pasted-data", stale: true }];
      if (postSource !== undefined) {
        const post = evaluateExpression(`(bridgeSend, pins, PAGE_URL, document, setHint, updateToolbar, toast, t) => {\n${postSource}\nreturn postSnapshot();\n}`, "postSnapshot");
        await post(bridgeSend, pins, "http://page/", { title: "T" }, () => {}, () => {}, () => {}, (key) => key);
      }
      const forwarded = captured?.pins?.[0];
      harness.check("overlay: postSnapshot forwards pastedShot on the pin payload",
        forwarded !== undefined && forwarded.pastedShot === "pasted-data" && forwarded.afterShot === "after-data",
        JSON.stringify(forwarded ?? captured));
    }
  }

  harness.section("client: overlay css patch copy");
  {
    const buildSource = extractFunction(overlay, "buildCssPatch");
    const buildCssPatch = buildSource === undefined ? undefined : evaluateExpression(buildSource, "buildCssPatch");
    harness.check("the overlay keeps its css patch builder", buildCssPatch !== undefined);
    harness.check("overlay: buildCssPatch renders the selector with one property per committed change",
      buildCssPatch !== undefined &&
      buildCssPatch({ selector: "body h1", changes: [{ prop: "color", before: "#000", after: "red" }, { prop: "border-radius", before: "0", after: "4px" }] }) === "body h1 { color: red; border-radius: 4px; }",
      buildCssPatch === undefined ? "builder missing" : JSON.stringify(buildCssPatch({ selector: "body h1", changes: [{ prop: "color", before: "#000", after: "red" }] })));
    harness.check("overlay: buildCssPatch ignores text changes and canvas pins",
      buildCssPatch !== undefined &&
      buildCssPatch({ selector: "body h1", changes: [], textChange: { before: "a", after: "b" } }) === "" &&
      buildCssPatch({ tag: "canvas", selector: "canvas:drawing", changes: [{ prop: "color", before: "#000", after: "red" }] }) === "",
      "canvas or text-only pins must produce no css");
    harness.check("overlay: buildCssPatch keeps var() values verbatim",
      buildCssPatch !== undefined &&
      buildCssPatch({ selector: "body h1", changes: [{ prop: "color", before: "#000", after: "var(--brand)" }] }) === "body h1 { color: var(--brand); }",
      buildCssPatch === undefined ? "builder missing" : JSON.stringify(buildCssPatch({ selector: "body h1", changes: [{ prop: "color", before: "#000", after: "var(--brand)" }] })));
    {
      const copySource = extractFunction(overlay, "copyCssPatch");
      const renderer = extractFunction(overlay, "renderPinPanel");
      let written = [];
      let toasts = [];
      const navigatorStub = { clipboard: { writeText: async (text) => { written.push(text); } } };
      const copy = copySource === undefined ? undefined : evaluateExpression(`(navigator, toast, t, buildCssPatch, pin) => {\n${copySource}\ncopyCssPatch(pin);\n}`, "copyCssPatch");
      if (copy !== undefined) copy(navigatorStub, (text) => toasts.push(text), (key) => key, buildCssPatch, { selector: "body h1", changes: [{ prop: "color", before: "#000", after: "red" }] });
      let failingToasts = [];
      const failingNavigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
      if (copy !== undefined) copy(failingNavigator, (text) => failingToasts.push(text), (key) => key, buildCssPatch, { selector: "body h1", changes: [{ prop: "color", before: "#000", after: "red" }] });
      await flush();
      harness.check("overlay: the popover copy button writes the patch via the clipboard",
        copy !== undefined && renderer !== undefined && renderer.includes("pin.changes.length > 0") && renderer.includes("copyCssPatch(pin)") &&
        JSON.stringify(written) === JSON.stringify(["body h1 { color: red; }"]) && JSON.stringify(toasts) === JSON.stringify(["cssCopied"]) &&
        JSON.stringify(failingToasts) === JSON.stringify(["cssCopyFailed"]),
        JSON.stringify({ written, toasts, failingToasts, conditional: renderer?.includes("pin.changes.length > 0") }));
    }
  }

  harness.section("client: overlay pin popover dimensions");
  {
    const dims = extractFunction(overlay, "pinDimensions");
    const dimsFn = dims === undefined ? undefined : evaluateExpression(`(locate, pin) => {\n${dims}\nreturn pinDimensions(pin);\n}`, "pinDimensions");
    const liveRect = { width: 320.4, height: 128.6 };
    const live = dimsFn === undefined ? undefined : dimsFn(() => ({ getBoundingClientRect: () => liveRect }), { selector: "#live", rect: { w: 10, h: 20 } });
    const snapshot = dimsFn === undefined ? undefined : dimsFn(() => null, { selector: "#gone", rect: { w: 240.9, h: 64.2 } });
    harness.check("overlay: pinDimensions prefers the live element rect and falls back to the snapshot",
      dimsFn !== undefined && live === "320×129" && snapshot === "241×64",
      JSON.stringify({ live, snapshot }));
    const panelSource = extractFunction(overlay, "renderPinPanel");
    const bodyStart = panelSource?.indexOf('class: "pin-bubble-body"') ?? -1;
    const metaAt = panelSource?.indexOf('class: "pin-bubble-meta"') ?? -1;
    const dimsAt = panelSource?.indexOf("pinDimensions(pin)") ?? -1;
    const actionsAt = panelSource?.indexOf('class: "pin-bubble-actions"') ?? -1;
    harness.check("overlay: the popover renders the dimensions line beside the selector preview",
      panelSource !== undefined && bodyStart !== -1 && metaAt > bodyStart && dimsAt > metaAt && actionsAt > dimsAt,
      JSON.stringify({ bodyStart, metaAt, dimsAt, actionsAt }));
  }

  harness.section("client: overlay copy selector button");
  {
    const copySource = extractFunction(overlay, "copySelectorText");
    const panel = extractFunction(overlay, "renderPinPanel");
    const copy = copySource === undefined ? undefined : evaluateExpression(`(navigator, toast, t, pin) => {\n${copySource}\ncopySelectorText(pin);\n}`, "copySelectorText");
    let written = [];
    let toasts = [];
    let failingToasts = [];
    const navigatorStub = { clipboard: { writeText: async (text) => { written.push(text); } } };
    const failingNavigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
    if (copy !== undefined) copy(navigatorStub, (text) => toasts.push(text), (key) => key, { selector: "#target > .card" });
    if (copy !== undefined) copy(failingNavigator, (text) => failingToasts.push(text), (key) => key, { selector: "#target > .card" });
    if (copy !== undefined) copy({ clipboard: undefined }, (text) => failingToasts.push(text), (key) => key, { selector: "#target > .card" });
    await flush();
    harness.check("overlay: the popover copy-selector button writes the pin selector via the clipboard",
      copy !== undefined && panel !== undefined && panel.includes("copySelectorText(pin)") && panel.includes('t("copySelector")') &&
      JSON.stringify(written) === JSON.stringify(["#target > .card"]) && JSON.stringify(toasts) === JSON.stringify(["selectorCopied"]),
      JSON.stringify({ written, toasts, wired: panel?.includes("copySelectorText(pin)") }));
    harness.check("overlay: the copy-selector failure path toasts instead of throwing",
      copy !== undefined && JSON.stringify(failingToasts) === JSON.stringify(["cssCopyFailed", "cssCopyFailed"]),
      JSON.stringify({ failingToasts }));
  }

  harness.section("client: overlay pin comment ctrl+enter");
  {
    const keydownSource = extractFunction(overlay, "pinCommentKeydown");
    const saveSource = extractFunction(overlay, "savePinComment");
    const panel = extractFunction(overlay, "renderPinPanel");
    let saveCalls = 0;
    let snapshotCalls = 0;
    const run = keydownSource === undefined || saveSource === undefined ? undefined : evaluateExpression(`(savePins, postSnapshot, renderPinPanel, renderPins) => {
${saveSource}
${keydownSource}
let openPinId = "p1";
return (pin, textarea, event) => {
  pinCommentKeydown(pin, textarea, event);
  return openPinId;
};
}`, "pinCommentKeydown");
    const keydown = run === undefined ? undefined : run(() => { saveCalls += 1; }, () => { snapshotCalls += 1; }, () => {}, () => {});
    const pin = { id: "p1", comment: "old", status: "open", changes: [] };
    const event = { ctrlKey: true, key: "Enter", prevented: false, preventDefault() { this.prevented = true; } };
    const afterId = keydown === undefined ? undefined : keydown(pin, { value: "  note  " }, event);
    harness.check("overlay: ctrl+enter on the pin comment textarea runs the save routine exactly once",
      panel !== undefined && keydown !== undefined &&
      panel.includes("textarea.addEventListener(\"keydown\", (event) => pinCommentKeydown(pin, textarea, event))") &&
      panel.includes("savePinComment(pin, textarea)") &&
      saveCalls === 1 && snapshotCalls === 1 && pin.comment === "note" && pin.status === "queued" &&
      afterId === null && event.prevented === true,
      JSON.stringify({ saveCalls, snapshotCalls, comment: pin.comment, status: pin.status, afterId, prevented: event.prevented, wired: panel?.includes("pinCommentKeydown(pin, textarea, event)") }));
  }
  {
    const keydownSource = extractFunction(overlay, "pinCommentKeydown");
    const saveSource = extractFunction(overlay, "savePinComment");
    let saveCalls = 0;
    let snapshotCalls = 0;
    const run = keydownSource === undefined || saveSource === undefined ? undefined : evaluateExpression(`(savePins, postSnapshot, renderPinPanel, renderPins) => {
${saveSource}
${keydownSource}
let openPinId = "p2";
return (pin, textarea, event) => {
  pinCommentKeydown(pin, textarea, event);
  return openPinId;
};
}`, "pinCommentKeydown");
    const keydown = run === undefined ? undefined : run(() => { saveCalls += 1; }, () => { snapshotCalls += 1; }, () => {}, () => {});
    const pin = { id: "p2", comment: "keep", status: "open", changes: [] };
    const event = { key: "Enter", prevented: false, preventDefault() { this.prevented = true; } };
    const afterId = keydown === undefined ? undefined : keydown(pin, { value: "  draft  " }, event);
    harness.check("overlay: plain enter on the pin comment textarea does not save",
      keydown !== undefined && saveCalls === 0 && snapshotCalls === 0 && pin.comment === "keep" &&
      pin.status === "open" && afterId === "p2" && event.prevented === false,
      JSON.stringify({ saveCalls, snapshotCalls, comment: pin.comment, status: pin.status, afterId, prevented: event.prevented }));
  }
  {
    const draftSource = extractFunction(overlay, "renderDraft");
    harness.check("overlay: the draft composer keydown still submits on ctrl+enter",
      draftSource !== undefined && draftSource.includes("e.key === \"Enter\" && !e.shiftKey"),
      draftSource === undefined ? "renderDraft missing" : "draft keydown condition drifted");
  }

  harness.section("client: overlay draw eraser and undo");
  {
    const barSource = extractFunction(overlay, "buildDrawBar");
    const iconsSource = extractObjectLiteral(overlay, "ICONS_CANVAS");
    const icons = iconsSource === undefined ? undefined : evaluateObjectLiteral(iconsSource, "ICONS_CANVAS");
    const shapesAt = barSource?.indexOf("addTool(\"shapes\", \"drawShapes\"") ?? -1;
    const eraseAt = barSource?.indexOf("addTool(\"eraser\", \"drawErase\", ICONS_CANVAS.eraser)") ?? -1;
    const textAt = barSource?.indexOf("addTool(\"text\", \"drawText\"") ?? -1;
    harness.check("overlay: the eraser tool sits between shapes and text in the draw bar with its own icon",
      barSource !== undefined && icons !== undefined && typeof icons.eraser === "string" && icons.eraser.startsWith("<svg") &&
      shapesAt !== -1 && eraseAt > shapesAt && textAt > eraseAt,
      JSON.stringify({ shapesAt, eraseAt, textAt, hasIcon: typeof icons?.eraser === "string" }));
    harness.check("overlay: the draw bar chevrons render as icons, not text",
      barSource !== undefined && barSource.includes("{ class: \"lr-dchev\", html: ICONS_CANVAS.chev }") &&
      !barSource.includes("}, ICONS_CANVAS.chev)"),
      barSource === undefined ? "buildDrawBar missing" : "chevron still inserted as a text child");
    harness.check("overlay: the draw send button renders its icon, not text",
      barSource !== undefined && barSource.includes("html: ICONS_CANVAS.plus") &&
      !barSource.includes("}, ICONS_CANVAS.plus)"),
      barSource === undefined ? "buildDrawBar missing" : "send icon still inserted as a text child");
  }
  {
    const cluster = ["itemBBox", "drawHit", "hitTestDraw", "snapshotDraw", "eraseDrawItemAt"].map((name) => extractFunction(overlay, name));
    const cloneSource = extractArrowConst(overlay, "cloneItems");
    const ready = cloneSource !== undefined && cluster.every((source) => source !== undefined);
    const build = () => ready ? evaluateExpression(`(saveDrawings, redrawDrawings, updateDrawBarState) => {
${cluster.join("\n")}
${cloneSource}
let drawTyping = null;
let drawItems = [];
let drawUndo = [];
let drawRedo = [];
return {
  erase: eraseDrawItemAt,
  seed: (items) => { drawItems = items; },
  items: () => drawItems,
  undo: () => drawUndo,
  redo: () => drawRedo,
  setTyping: (value) => { drawTyping = value; }
};
}`, "eraseDrawItemAt") : undefined;
    const bottom = { type: "path", color: "#111111", w: 2, points: [{ x: 100, y: 100 }, { x: 140, y: 100 }] };
    const top = { type: "path", color: "#e5484d", w: 2, points: [{ x: 102, y: 100 }, { x: 140, y: 120 }] };
    let saveCalls = 0;
    let redrawCalls = 0;
    let stateCalls = 0;
    const sandbox = build()?.(() => { saveCalls += 1; }, () => { redrawCalls += 1; }, () => { stateCalls += 1; });
    sandbox?.seed([bottom, top]);
    const erased = sandbox?.erase(103, 101) === true;
    harness.check("overlay: eraseDrawItemAt removes the topmost hit drawing with exactly one undo snapshot",
      sandbox !== undefined && erased && sandbox.items().length === 1 && sandbox.items()[0] === bottom &&
      sandbox.undo().length === 1 && sandbox.undo()[0].length === 2 && sandbox.redo().length === 0 &&
      saveCalls === 1 && redrawCalls === 1 && stateCalls === 1,
      JSON.stringify({ erased, left: sandbox?.items().length, undo: sandbox?.undo().length, undoDepth: sandbox?.undo()[0]?.length, redo: sandbox?.redo().length, saveCalls, redrawCalls, stateCalls, ready }));
  }
  {
    const cluster = ["itemBBox", "drawHit", "hitTestDraw", "snapshotDraw", "eraseDrawItemAt"].map((name) => extractFunction(overlay, name));
    const cloneSource = extractArrowConst(overlay, "cloneItems");
    const ready = cloneSource !== undefined && cluster.every((source) => source !== undefined);
    const run = ready ? evaluateExpression(`(saveDrawings, redrawDrawings, updateDrawBarState) => {
${cluster.join("\n")}
${cloneSource}
let drawTyping = null;
let drawItems = [];
let drawUndo = [];
let drawRedo = [];
return {
  erase: eraseDrawItemAt,
  seed: (items) => { drawItems = items; },
  items: () => drawItems,
  undo: () => drawUndo,
  redo: () => drawRedo,
  setTyping: (value) => { drawTyping = value; }
};
}`, "eraseDrawItemAt") : undefined;
    const first = { type: "path", color: "#111111", w: 2, points: [{ x: 100, y: 100 }, { x: 140, y: 100 }] };
    const second = { type: "path", color: "#3b82f6", w: 2, points: [{ x: 200, y: 200 }, { x: 240, y: 200 }] };
    let saveCalls = 0;
    let redrawCalls = 0;
    let stateCalls = 0;
    const sandbox = run === undefined ? undefined : run(() => { saveCalls += 1; }, () => { redrawCalls += 1; }, () => { stateCalls += 1; });
    sandbox?.seed([first, second]);
    const emptyHit = sandbox?.erase(300, 300);
    const afterEmpty = { undo: sandbox?.undo().length, redo: sandbox?.redo().length, items: sandbox?.items().length, saveCalls };
    sandbox?.setTyping({ x: 100, y: 100, color: "#111111", text: "a" });
    const typingHit = sandbox?.erase(103, 101);
    harness.check("overlay: erasing an empty point or while typing pushes no undo snapshot",
      sandbox !== undefined && emptyHit === false && typingHit === false &&
      afterEmpty.undo === 0 && afterEmpty.redo === 0 && afterEmpty.items === 2 && afterEmpty.saveCalls === 0 &&
      sandbox.items().length === 2 && sandbox.undo().length === 0 && sandbox.redo().length === 0 &&
      saveCalls === 0 && redrawCalls === 0 && stateCalls === 0,
      JSON.stringify({ emptyHit, typingHit, afterEmpty, finalItems: sandbox?.items().length, ready }));
  }
  {
    const keydownSource = extractFunction(overlay, "drawUndoKeydown");
    const run = keydownSource === undefined ? undefined : evaluateExpression(`(undoDraw, redoDraw) => {
let drawMode = true;
${keydownSource}
return { keydown: drawUndoKeydown, setDrawMode: (value) => { drawMode = value; } };
}`, "drawUndoKeydown");
    let undoCalls = 0;
    let redoCalls = 0;
    const sandbox = run === undefined ? undefined : run(() => { undoCalls += 1; }, () => { redoCalls += 1; });
    const mk = (props) => ({ prevented: false, preventDefault() { this.prevented = true; }, ...props });
    const undoEvent = mk({ ctrlKey: true, key: "z" });
    const metaUndoEvent = mk({ metaKey: true, key: "z" });
    const shiftZEvent = mk({ ctrlKey: true, shiftKey: true, key: "z" });
    const yEvent = mk({ ctrlKey: true, key: "Y" });
    const plainEvent = mk({ key: "z" });
    const altEvent = mk({ ctrlKey: true, altKey: true, key: "z" });
    const handled = sandbox === undefined ? [] : [undoEvent, metaUndoEvent, shiftZEvent, yEvent, plainEvent, altEvent].map((event) => sandbox.keydown(event));
    sandbox?.setDrawMode(false);
    const offEvent = mk({ ctrlKey: true, key: "z" });
    const off = sandbox?.keydown(offEvent);
    harness.check("overlay: draw-mode undo keydown maps ctrl/cmd+z and ctrl+shift+z / ctrl+y",
      sandbox !== undefined && handled[0] === true && handled[1] === true && handled[2] === true && handled[3] === true &&
      handled[4] === false && handled[5] === false && off === false &&
      undoCalls === 2 && redoCalls === 2 &&
      undoEvent.prevented === true && metaUndoEvent.prevented === true && shiftZEvent.prevented === true && yEvent.prevented === true &&
      plainEvent.prevented === false && altEvent.prevented === false && offEvent.prevented === false,
      JSON.stringify({ handled, off, undoCalls, redoCalls, prevented: [undoEvent.prevented, metaUndoEvent.prevented, shiftZEvent.prevented, yEvent.prevented, plainEvent.prevented, altEvent.prevented, offEvent.prevented] }));
  }
  {
    const guardAt = overlay.indexOf("if (tag === \"INPUT\" || tag === \"TEXTAREA\" || from?.isContentEditable === true) return;");
    const keydownAt = guardAt === -1 ? -1 : overlay.lastIndexOf("\"keydown\"", guardAt);
    const listenerSpan = keydownAt === -1 ? "" : overlay.slice(keydownAt, keydownAt + 3000);
    const adjustAt = listenerSpan.indexOf("adjustPanel !== null && (event.ctrlKey || event.metaKey)");
    const drawUndoAt = listenerSpan.indexOf("drawUndoKeydown(event)");
    const deleteAt = listenerSpan.indexOf("event.key === \"Delete\"");
    harness.check("overlay: the draw undo wiring sits after the adjust undo branch and before the delete branch",
      listenerSpan !== "" && adjustAt !== -1 && drawUndoAt > adjustAt && deleteAt > drawUndoAt,
      JSON.stringify({ adjustAt, drawUndoAt, deleteAt }));
  }

  harness.section("client: overlay pin ancestor trail");
  {
    const trailSource = extractFunction(overlay, "ancestorTrail");
    const run = trailSource === undefined ? undefined : evaluateExpression(`(document, host) => {
${trailSource}
return ancestorTrail;
}`, "ancestorTrail");
    const fakeBody = { localName: "body", parentElement: null };
    const fakeDocument = { body: fakeBody };
    const fakeHost = { localName: "dsh-redline-host", parentElement: fakeBody };
    const trail = run === undefined ? undefined : run(fakeDocument, fakeHost);
    const ancestorA = { localName: "div", parentElement: fakeBody };
    const ancestorB = { localName: "span", parentElement: ancestorA };
    const leaf = { localName: "p", parentElement: ancestorB };
    const ordered = trail === undefined ? undefined : trail(leaf);
    const chain13 = [];
    let cursor = fakeBody;
    for (let i = 13; i >= 1; i -= 1) { const node = { localName: `n${i}`, parentElement: cursor }; chain13.unshift(node); cursor = node; }
    const capped = trail === undefined ? undefined : trail(chain13[0]);
    const insideHostChild = { localName: "aside", parentElement: fakeHost };
    const insideHostParent = { localName: "section", parentElement: insideHostChild };
    const hostTrail = trail === undefined ? undefined : trail(insideHostParent);
    harness.check("overlay: ancestorTrail walks deepest-first to the body, caps at 12 and skips the overlay host",
      trail !== undefined && ordered !== undefined && ordered.length === 3 &&
      ordered[0] === ancestorB && ordered[1] === ancestorA && ordered[2] === fakeBody &&
      capped !== undefined && capped.length === 12 && capped[0] === chain13[1] && capped[11] === chain13[12] &&
      !capped.includes(fakeBody) && hostTrail !== undefined && hostTrail.length === 1 &&
      hostTrail[0] === insideHostChild && !hostTrail.includes(fakeHost) && !hostTrail.includes(fakeBody),
      JSON.stringify({ ordered: ordered?.length, capped: capped?.length, cappedLast: capped?.[11]?.localName, hostTrail: hostTrail?.length, ready: trail !== undefined }));
  }
  {
    const reanchorSource = extractFunction(overlay, "reanchorPin");
    const run = reanchorSource === undefined ? undefined : evaluateExpression(`(cssPath, savePins, renderPins, postSnapshot) => {
${reanchorSource}
return reanchorPin;
}`, "reanchorPin");
    const element = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }) };
    const pin = { selector: "body > p:nth-of-type(2)", stale: true, offsets: { ox: 1, oy: 2 }, rect: { x: 0, y: 0, w: 0, h: 0 } };
    const order = [];
    let cssPathArg = null;
    const reanchor = run === undefined ? undefined : run((arg) => { cssPathArg = arg; return "body > section:nth-of-type(1)"; }, () => { order.push("savePins"); }, () => { order.push("renderPins"); }, () => { order.push("postSnapshot"); });
    reanchor?.(pin, element);
    harness.check("overlay: reanchorPin applies the drag-drop mutation set without a snapshot",
      reanchor !== undefined && cssPathArg === element && pin.selector === "body > section:nth-of-type(1)" &&
      pin.stale === false && pin.offsets.ox === 50 && pin.offsets.oy === 25 &&
      pin.rect.x === 10 && pin.rect.y === 20 && pin.rect.w === 100 && pin.rect.h === 50 &&
      JSON.stringify(order) === JSON.stringify(["savePins", "renderPins"]),
      JSON.stringify({ selector: pin.selector, stale: pin.stale, offsets: pin.offsets, rect: pin.rect, order }));
  }
  {
    const sources = ["quickLabel", "reactComponentName", "ancestorTrail", "renderPinPanel"].map((name) => extractFunction(overlay, name));
    const ready = sources.every((source) => source !== undefined);
    const fakeBody = { localName: "body", parentElement: null };
    const ancestorA = { localName: "div", parentElement: fakeBody };
    const ancestorB = { localName: "section", parentElement: ancestorA };
    const leaf = { localName: "p", id: "lead", parentElement: ancestorB };
    const fakeHost = { localName: "dsh-redline-host", parentElement: fakeBody };
    const fakeWindow = { innerWidth: 1000, innerHeight: 800 };
    const el = (tag, attrs = {}, ...children) => {
      const node = { tag, props: attrs, children: [], style: {} };
      for (const kid of children) { if (kid !== null && kid !== undefined) node.children.push(kid); }
      node.append = (...kids) => { for (const kid of kids) { if (kid !== null && kid !== undefined) node.children.push(kid); } return node; };
      node.addEventListener = () => {};
      return node;
    };
    const baseStubs = [el, (key) => key, { arrowUp: "icon-arrow", code: "icon-code" }, () => {}, () => null, () => 1];
    const run = ready ? evaluateExpression(`(el, t, ICONS, mountShadow, anchorPoint, countSelectorMatches, locate, pinDimensions, renderTemplateRow, a11yAuditSection, a11yFixHandler, focusState, rootDiv, applyPanelPosition, wirePanelDrag, window, document, host, pin) => {
${sources.join("\n")}
let pinPanelNode = null;
let openPinId = pin.id;
const pins = [pin];
renderPinPanel(pin);
return pinPanelNode;
}`, "renderPinPanel") : undefined;
    const render = (locateStub, pin) => run === undefined ? undefined : run(...baseStubs, locateStub, () => "10×10", () => null, () => null, { current: null }, { current: null }, el("div", {}), () => {}, () => {}, fakeWindow, { body: fakeBody }, fakeHost, pin);
    const positivePin = { id: "p1", comment: "", changes: [], textChange: null, selector: "p#lead", tag: "p", stale: false, component: "", rect: { x: 5, y: 6 }, status: "queued" };
    const negativePin = { id: "p1", comment: "", changes: [], textChange: null, selector: "p.gone", tag: "p", stale: true, component: "", rect: { x: 5, y: 6 }, status: "queued" };
    const positivePanel = render(() => leaf, positivePin);
    const positiveBody = positivePanel?.children.find((child) => child?.props?.class === "pin-bubble-body");
    const trailNode = positiveBody?.children[0];
    const chips = trailNode?.children ?? [];
    const negativePanel = render(() => null, negativePin);
    const negativeBody = negativePanel?.children.find((child) => child?.props?.class === "pin-bubble-body");
    harness.check("overlay: the pin popover renders the ancestor trail only when the target resolves",
      positivePanel !== undefined && positiveBody !== undefined &&
      trailNode?.props?.class === "lr-trail" && trailNode.props.title === "ancestorTrail" && trailNode.props["aria-label"] === "ancestorTrail" &&
      chips.length === 3 && chips.every((chip) => chip.props.type === "button") &&
      JSON.stringify(chips.map((chip) => chip.children[0])) === JSON.stringify(["section", "div", "body"]) &&
      negativePanel !== undefined && negativeBody !== undefined && negativeBody.children[0].props.class === "pin-bubble-meta" &&
      !negativeBody.children.some((child) => child?.props?.class === "lr-trail"),
      JSON.stringify({ trail: trailNode?.props?.class, chips: chips.map((chip) => chip.children[0]), negativeFirst: negativeBody?.children[0]?.props?.class, ready }));
  }
  {
    const panelSource = extractFunction(overlay, "renderPinPanel");
    harness.check("overlay: the trail chips re-anchor through reanchorPin and the row carries the ancestorTrail label",
      panelSource !== undefined &&
      panelSource.includes("onclick: () => { reanchorPin(pin, ancestor); renderPinPanel(pin); }") &&
      panelSource.includes("title: t(\"ancestorTrail\"), \"aria-label\": t(\"ancestorTrail\")") &&
      panelSource.includes("quickLabel(ancestor)"),
      panelSource === undefined ? "renderPinPanel missing" : "trail wiring drifted");
  }
  {
    const panelSource = extractFunction(overlay, "renderPinPanel");
    harness.check("overlay: the ancestor trail is skipped for canvas drawing pseudo-targets",
      panelSource !== undefined && panelSource.includes("pin.selector === \"canvas:drawing\""),
      panelSource === undefined ? "renderPinPanel missing" : "canvas:drawing guard missing");
  }

  harness.section("client: overlay layout grid");
  {
    const geometrySource = extractFunction(overlay, "gridGeometry");
    const boundsSource = extractObjectLiteral(overlay, "const GRID_BOUNDS = {");
    const stepperSource = extractFunction(overlay, "openGridStepper");
    harness.check("overlay: the grid settings dismiss resolves shadow-retargeted events through composedPath",
      stepperSource !== undefined && stepperSource.includes("composedPath?.()") &&
      !stepperSource.includes("contains(event.target)"),
      stepperSource === undefined ? "openGridStepper missing" : "dismiss still keys on event.target");
    harness.check("overlay: the grid settings panel exposes columns, gutter, margin and fill/outline",
      stepperSource !== undefined && boundsSource !== undefined &&
      stepperSource.includes("row(\"gridColumns\", \"columns\")") && stepperSource.includes("row(\"gridGutter\", \"gutter\")") &&
      stepperSource.includes("row(\"gridMargin\", \"margin\")") && stepperSource.includes("styleButton(\"fill\", \"gridFill\")") &&
      stepperSource.includes("styleButton(\"outline\", \"gridOutline\")") &&
      JSON.stringify(boundsSource ? evaluateObjectLiteral(boundsSource, "GRID_BOUNDS") : null) === JSON.stringify({ columns: [1, 24, 1], gutter: [0, 64, 4], margin: [0, 160, 8] }),
      stepperSource === undefined ? "openGridStepper missing" : "settings rows or bounds drifted");
    const geometry = geometrySource === undefined ? undefined : evaluateExpression(geometrySource, "gridGeometry");
    harness.check("overlay: gridGeometry computes the column math exactly from gutter and margin",
      geometry !== undefined &&
      geometry(12, 1440, 24, 32).margin === 32 && geometry(12, 1440, 24, 32).gutter === 24 && geometry(12, 1440, 24, 32).columns === 12 &&
      geometry(12, 1440, 24, 32).columnWidth === (1440 - 64 - 11 * 24) / 12 &&
      geometry(1, 1440, 24, 32).columnWidth === 1376 && geometry(24, 1440, 24, 32).columnWidth === (1440 - 64 - 23 * 24) / 24 &&
      geometry(1, 1440, 0, 0).columnWidth === 1440,
      JSON.stringify({ c12: geometry?.(12, 1440, 24, 32).columnWidth, c1: geometry?.(1, 1440, 24, 32).columnWidth, c24: geometry?.(24, 1440, 24, 32).columnWidth, full: geometry?.(1, 1440, 0, 0).columnWidth }));
  }
  {
    const languageSource = extractFunction(overlay, "applyOverlayLanguage");
    const updateSource = extractFunction(overlay, "updateToolbar");
    const gridBtnAt = overlay.indexOf("const gridBtn = el(\"button\", { class: \"tool\", title: t(\"layoutGrid\")");
    const viewportAt = overlay.indexOf("const viewportBtn = el(\"button\"");
    const eyeAt = overlay.indexOf("const eyeBtn = el(\"button\"");
    harness.check("overlay: the layout grid button sits between viewport and eye and tracks gridOn",
      gridBtnAt > viewportAt && eyeAt > gridBtnAt && overlay.includes("viewportBtn, gridBtn, eyeBtn") &&
      updateSource !== undefined && updateSource.includes("gridBtn.classList.toggle(\"tool-active\", gridOn)") &&
      languageSource !== undefined && languageSource.includes("gridBtn.title = t(\"layoutGrid\")"),
      JSON.stringify({ gridBtnAt, viewportAt, eyeAt, ordered: gridBtnAt > viewportAt && eyeAt > gridBtnAt, activeToggled: updateSource?.includes("gridOn"), retitled: languageSource?.includes("layoutGrid") }));
  }
  {
    const renderSource = extractFunction(overlay, "renderGrid");
    const geometrySource = extractFunction(overlay, "gridGeometry");
    const ready = renderSource !== undefined && geometrySource !== undefined;
    const appended = [];
    const fixedLayer = { append: (node) => appended.push(node) };
    const el = (tag, attrs = {}, ...children) => {
      const node = { tag, props: attrs, children: [], style: {} };
      for (const kid of children) { if (kid !== null && kid !== undefined) node.children.push(kid); }
      node.append = (...kids) => { for (const kid of kids) { if (kid !== null && kid !== undefined) node.children.push(kid); } return node; };
      return node;
    };
    const run = ready ? evaluateExpression(`(el, fixedLayer, window) => {
${geometrySource}
${renderSource}
let gridOn = true;
let gridLayer = null;
let gridColumns = 4;
let gridGutter = 24;
let gridMargin = 32;
let gridOutline = false;
return renderGrid;
}`, "renderGrid") : undefined;
    const render = run === undefined ? undefined : run(el, fixedLayer, { innerWidth: 1000 });
    render?.();
    const layer = appended[0];
    const bands = layer?.children ?? [];
    const columnWidth = (1000 - 64 - 3 * 24) / 4;
    harness.check("overlay: renderGrid builds the exact column bands with computed geometry",
      render !== undefined && appended.length === 1 && layer.props.class === "lr-grid" && bands.length === 4 &&
      bands[0].style.left === "32px" && bands[0].style.width === `${columnWidth}px` &&
      bands[1].style.left === `${32 + columnWidth + 24}px` && bands[3].style.left === `${32 + 3 * (columnWidth + 24)}px` &&
      bands.every((band) => band.props.class === "lr-grid-band") &&
      /\.lr-grid \{[^}]*pointer-events: none/.test(overlay),
      JSON.stringify({ bands: bands.length, first: bands[0]?.style, secondLeft: bands[1]?.style.left, lastLeft: bands[3]?.style.left }));
  }
  {
    const adjustSource = extractFunction(overlay, "gridAdjust");
    const boundsSource = extractArrowConst(overlay, "GRID_BOUNDS");
    const run = adjustSource === undefined || boundsSource === undefined ? undefined : evaluateExpression(`(renderGrid) => {
let gridColumns = 12;
let gridGutter = 24;
let gridMargin = 32;
let gridStepper = null;
const GRID_BOUNDS = { columns: [1, 24, 1], gutter: [0, 64, 4], margin: [0, 160, 8] };
${adjustSource}
return { adjust: gridAdjust, state: () => ({ gridColumns, gridGutter, gridMargin }), set: (key, value) => { if (key === "columns") gridColumns = value; else if (key === "gutter") gridGutter = value; else gridMargin = value; } };
}`, "gridAdjust");
    let renders = 0;
    const sandbox = run === undefined ? undefined : run(() => { renders += 1; });
    sandbox?.set("columns", 1);
    sandbox?.adjust("columns", -1);
    const colMin = sandbox?.state().gridColumns;
    sandbox?.adjust("columns", 1);
    const colUp = sandbox?.state().gridColumns;
    sandbox?.set("columns", 24);
    sandbox?.adjust("columns", 1);
    const colMax = sandbox?.state().gridColumns;
    sandbox?.adjust("gutter", -100);
    const gutterMin = sandbox?.state().gridGutter;
    sandbox?.adjust("gutter", 3);
    const gutterStep = sandbox?.state().gridGutter;
    sandbox?.adjust("margin", 100);
    const marginMax = sandbox?.state().gridMargin;
    sandbox?.adjust("margin", 2);
    const marginStep = sandbox?.state().gridMargin;
    harness.check("overlay: gridAdjust clamps columns, gutter and margin through GRID_BOUNDS",
      sandbox !== undefined && colMin === 1 && colUp === 2 && colMax === 24 && gutterMin === 0 &&
      gutterStep === 12 && marginMax === 160 && marginStep === 160 && renders === 4,
      JSON.stringify({ colMin, colUp, colMax, gutterMin, gutterStep, marginMax, marginStep, renders }));
  }
  {
    const setGridSource = extractFunction(overlay, "setGrid");
    const run = setGridSource === undefined ? undefined : evaluateExpression(`(updateToolbar, renderGrid, closeGridStepper, window) => {
let gridOn = false;
let gridLayer = null;
let gridStepper = null;
let gridResize = null;
${setGridSource}
return { setGrid, state: () => ({ gridOn, gridLayer, gridResize }), setLayer: (value) => { gridLayer = value; } };
}`, "setGrid");
    const added = [];
    const removed = [];
    const fakeWindow = { addEventListener: (type, handler) => added.push({ type, handler }), removeEventListener: (type, handler) => removed.push({ type, handler }) };
    let renders = 0;
    let stepperCloses = 0;
    const layerStub = { removed: 0, remove() { this.removed += 1; } };
    const sandbox = run === undefined ? undefined : run(() => {}, () => { renders += 1; }, () => { stepperCloses += 1; }, fakeWindow);
    sandbox?.setGrid(true);
    sandbox?.setGrid(true);
    const afterEnable = { on: sandbox?.state().gridOn, added: added.length, type: added[0]?.type, renders };
    sandbox?.setLayer(layerStub);
    sandbox?.setGrid(false);
    const afterDisable = { on: sandbox?.state().gridOn, removed: removed.length, layerRemoved: layerStub.removed, stepperCloses, sameHandler: removed[0]?.handler === added[0]?.handler, resizeCleared: sandbox?.state().gridResize === null, layerCleared: sandbox?.state().gridLayer === null };
    sandbox?.setGrid(true);
    harness.check("overlay: setGrid wires the resize listener on enable and removes layer, stepper and listener on disable",
      sandbox !== undefined && afterEnable.on === true && afterEnable.added === 1 && afterEnable.type === "resize" && afterEnable.renders === 1 &&
      afterDisable.on === false && afterDisable.removed === 1 && afterDisable.layerRemoved === 1 && afterDisable.stepperCloses === 1 &&
      afterDisable.sameHandler === true && afterDisable.resizeCleared === true && afterDisable.layerCleared === true &&
      added.length === 2,
      JSON.stringify({ afterEnable, afterDisable, reAdded: added.length, ready: sandbox !== undefined }));
  }

  harness.section("client: overlay alt distance meter");
  {
    const gapsSource = extractFunction(overlay, "meterGaps");
    const gaps = gapsSource === undefined ? undefined : evaluateExpression(gapsSource, "meterGaps");
    const sideA = { left: 0, right: 100, top: 0, bottom: 50 };
    const sideB = { left: 150, right: 250, top: 0, bottom: 50 };
    const stackedB = { left: 0, right: 100, top: 80, bottom: 130 };
    const diagonalB = { left: 150, right: 250, top: 100, bottom: 150 };
    const overlappingB = { left: 50, right: 150, top: 25, bottom: 75 };
    harness.check("overlay: meterGaps measures the facing gaps exactly",
      gaps !== undefined &&
      gaps(sideA, sideB).horizontal === 50 && gaps(sideA, sideB).vertical === null &&
      gaps(sideB, sideA).horizontal === 50 && gaps(sideB, sideA).vertical === null &&
      gaps(sideA, stackedB).horizontal === null && gaps(sideA, stackedB).vertical === 30 &&
      gaps(sideA, diagonalB).horizontal === 50 && gaps(sideA, diagonalB).vertical === 50 &&
      gaps(sideA, overlappingB).horizontal === null && gaps(sideA, overlappingB).vertical === null,
      JSON.stringify({ side: gaps?.(sideA, sideB), stacked: gaps?.(sideA, stackedB), diagonal: gaps?.(sideA, diagonalB), overlapping: gaps?.(sideA, overlappingB) }));
  }
  {
    const refSource = extractFunction(overlay, "meterReference");
    const run = refSource === undefined ? undefined : evaluateExpression(`(adjustPanel, adjustTarget, openPinId, pins, locate) => {
${refSource}
return meterReference;
}`, "meterReference");
    const adjustEl = { tag: "adjust" };
    const pinEl = { tag: "pin" };
    const pin = { id: "p1", selector: "#pin-el" };
    const withBoth = run === undefined ? undefined : run({ open: true }, adjustEl, "p1", [pin], () => pinEl);
    const pinOnly = run === undefined ? undefined : run(null, null, "p1", [pin], () => pinEl);
    const adjustWithoutTarget = run === undefined ? undefined : run({ open: true }, null, "p1", [pin], () => pinEl);
    const nothing = run === undefined ? undefined : run(null, null, null, [], () => pinEl);
    const stalePin = run === undefined ? undefined : run(null, null, "pX", [pin], () => pinEl);
    harness.check("overlay: meterReference prefers the adjust target and falls back to the open pin",
      run !== undefined && withBoth?.() === adjustEl && pinOnly?.() === pinEl && adjustWithoutTarget?.() === pinEl &&
      nothing?.() === null && stalePin?.() === null,
      JSON.stringify({ both: withBoth?.()?.tag, pinOnly: pinOnly?.()?.tag, adjustWithoutTarget: adjustWithoutTarget?.()?.tag, nothing: nothing?.() ?? "null", stale: stalePin?.() ?? "null" }));
  }
  {
    const renderSource = extractFunction(overlay, "renderMeter");
    const clearSource = extractFunction(overlay, "clearMeter");
    const gapsSource = extractFunction(overlay, "meterGaps");
    const ready = renderSource !== undefined && clearSource !== undefined && gapsSource !== undefined;
    const appended = [];
    const pending = [];
    const cancelled = [];
    const fixedLayer = { append: (node) => appended.push(node) };
    const el = (tag, attrs = {}, ...children) => {
      const node = { tag, props: attrs, children: [], style: {} };
      for (const kid of children) { if (kid !== null && kid !== undefined) node.children.push(kid); }
      node.append = (...kids) => { for (const kid of kids) { if (kid !== null && kid !== undefined) node.children.push(kid); } return node; };
      node.remove = () => { node.removed = (node.removed ?? 0) + 1; };
      return node;
    };
    const run = ready ? evaluateExpression(`(el, fixedLayer, requestAnimationFrame, cancelAnimationFrame) => {
${gapsSource}
let meterAlt = true;
let meterRef = null;
let meterLayer = null;
let meterRaf = 0;
${clearSource}
${renderSource}
return { render: renderMeter, clear: clearMeter, setRef: (value) => { meterRef = value; }, layer: () => meterLayer, raf: () => meterRaf };
}`, "renderMeter") : undefined;
    const sandbox = run === undefined ? undefined : run(el, fixedLayer, (fn) => { pending.push(fn); return 42; }, (handle) => cancelled.push(handle));
    const refEl = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 }) };
    const targetEl = { getBoundingClientRect: () => ({ left: 150, top: 0, right: 250, bottom: 50, width: 100, height: 50 }) };
    sandbox?.setRef(refEl);
    sandbox?.render(targetEl);
    sandbox?.render(targetEl);
    const scheduled = pending.length;
    pending[0]?.();
    const layer = appended[0];
    const parts = layer?.children ?? [];
    sandbox?.clear();
    const afterClear = { removed: layer?.removed, layer: sandbox?.layer(), raf: sandbox?.raf() };
    sandbox?.render(targetEl);
    sandbox?.clear();
    harness.check("overlay: renderMeter draws the facing gap lines, labels and boxes and clearMeter tears it all down",
      sandbox !== undefined && scheduled === 1 && sandbox.raf() === 0 && appended.length === 1 &&
      layer?.props?.class === "lr-meter" && parts.length === 4 &&
      parts[0].props.class === "lr-meter-line" && parts[0].props.style === "left:100px;top:25px;width:50px;height:0" &&
      parts[1].props.class === "lr-meter-label" && parts[1].children[0] === "50px" && parts[1].props.style === "left:125px;top:25px" &&
      parts[2].props.class === "lr-meter-box" && parts[2].props.style === "left:0px;top:0px;width:100px;height:50px" &&
      parts[3].props.class === "lr-meter-box" && parts[3].props.style === "left:150px;top:0px;width:100px;height:50px" &&
      afterClear.removed === 1 && afterClear.layer === null && afterClear.raf === 0 &&
      cancelled.length === 1 && cancelled[0] === 42 && appended.length === 1,
      JSON.stringify({ scheduled, parts: parts.map((part) => part.props.class), label: parts[1]?.children[0], styles: parts.map((part) => part.props.style), afterClear, cancelled, appended: appended.length }));
  }
  {
    const keydownSource = extractFunction(overlay, "meterAltKeydown");
    const keyupSource = extractFunction(overlay, "meterAltKeyup");
    const run = keydownSource === undefined || keyupSource === undefined ? undefined : evaluateExpression(`(meterReference, clearMeter, setHint, t) => {
let meterAlt = false;
let meterRef = null;
${keydownSource}
${keyupSource}
return { keydown: meterAltKeydown, keyup: meterAltKeyup, state: () => ({ meterAlt, meterRef }) };
}`, "meterAltKeydown");
    const mk = (props) => ({ prevented: false, preventDefault() { this.prevented = true; }, ...props });
    let referenceCalls = 0;
    let clearCalls = 0;
    let hints = [];
    const adjustEl = { tag: "adjust" };
    const sandbox = run === undefined ? undefined : run(() => { referenceCalls += 1; return adjustEl; }, () => { clearCalls += 1; }, (text) => { hints.push(text); }, (key) => key);
    const altDown1 = mk({ key: "Alt" });
    const down1 = sandbox?.keydown(altDown1);
    const afterFirst = sandbox?.state();
    const altDown2 = mk({ key: "Alt" });
    const down2 = sandbox?.keydown(altDown2);
    const afterSecond = sandbox?.state();
    const plainDown = mk({ key: "z" });
    const downPlain = sandbox?.keydown(plainDown);
    const altUp = mk({ key: "Alt" });
    const up = sandbox?.keyup(altUp);
    const afterUp = sandbox?.state();
    const hintsBefore = hints.length;
    const nullSandbox = run === undefined ? undefined : run(() => null, () => { clearCalls += 1; }, (text) => { hints.push(text); }, (key) => key);
    const nullDown = mk({ key: "Alt" });
    nullSandbox?.keydown(nullDown);
    const hintsAfterNull = hints.length;
    harness.check("overlay: alt keydown arms the meter once and keyup disarms it",
      sandbox !== undefined && down1 === true && altDown1.prevented === true && afterFirst.meterAlt === true &&
      afterFirst.meterRef === adjustEl && referenceCalls === 1 &&
      down2 === true && afterSecond.meterAlt === true && referenceCalls === 1 &&
      downPlain === false && plainDown.prevented === false &&
      up === true && altUp.prevented === true && afterUp.meterAlt === false && clearCalls === 1 &&
      nullSandbox !== undefined && nullDown.prevented === true && hintsBefore === 0 && hintsAfterNull === 1 &&
      hints[0] === "distanceMeter" && nullSandbox.state().meterAlt === true && nullSandbox.state().meterRef === null &&
      overlay.includes("if (meterAltKeydown(event)) return;") &&
      overlay.indexOf("if (meterAltKeydown(event)) return;") < overlay.indexOf("if (tag === \"INPUT\"") &&
      /document\.addEventListener\(\s*"keyup"/.test(overlay) && overlay.includes("meterAltKeyup(event);"),
      JSON.stringify({ down1, down2, downPlain, up, referenceCalls, clearCalls, hints, prevented: [altDown1.prevented, altDown2.prevented, plainDown.prevented, altUp.prevented] }));
  }
  {
    const mousemoveAt = overlay.indexOf("\"mousemove\"");
    const span = mousemoveAt === -1 ? "" : overlay.slice(mousemoveAt, mousemoveAt + 900);
    const inHostAt = span.indexOf("const inHost = event.composedPath()");
    const meterAt = span.indexOf("if (meterAlt && meterRef !== null && !inHost)");
    const modeAt = span.indexOf("(mode === null && !groupMode) || draft !== null");
    harness.check("overlay: the meter mousemove branch runs before the mode gate and skips host-shadow events",
      span !== "" && inHostAt !== -1 && meterAt > inHostAt && modeAt > meterAt &&
      span.includes("renderMeter(event.target instanceof Element ? event.target : null)"),
      JSON.stringify({ inHostAt, meterAt, modeAt }));
  }
  {
    const scheduleSource = extractFunction(overlay, "scheduleHighlight");
    const clearSource = extractFunction(overlay, "clearHighlight");
    const pending = [];
    const cancelled = [];
    let rafHandle = 0;
    const run = scheduleSource === undefined || clearSource === undefined ? undefined : evaluateExpression(`(requestAnimationFrame, cancelAnimationFrame) => {
let highlightEl = null;
let highlightLabel = null;
let hovered = null;
let hoverRaf = null;
let hoverPendingTarget = null;
let mode = "picking";
let groupMode = false;
let draft = null;
let showCalls = [];
function showHighlight(target) { showCalls.push(target); }
${clearSource}
${scheduleSource}
return { schedule: scheduleHighlight, clear: clearHighlight, calls: () => showCalls, raf: () => hoverRaf, pendingTarget: () => hoverPendingTarget, setMode: (value) => { mode = value; } };
}`, "scheduleHighlight");
    const sandbox = run === undefined ? undefined : run((fn) => { pending.push(fn); return ++rafHandle; }, (handle) => cancelled.push(handle));
    const first = { tag: "a" };
    const second = { tag: "b" };
    sandbox?.schedule(first);
    sandbox?.schedule(second);
    sandbox?.schedule(first);
    const burstFrames = pending.length;
    const burstCalls = sandbox?.calls().length;
    pending[0]?.();
    const afterFrame = { calls: sandbox?.calls().length, latest: sandbox?.calls()[0]?.tag, raf: sandbox?.raf() };
    sandbox?.schedule(second);
    sandbox?.clear();
    const cleared = { cancelled: cancelled.length, handle: cancelled[0], pendingTarget: sandbox?.pendingTarget(), raf: sandbox?.raf() };
    pending[1]?.();
    const afterStaleFrame = sandbox?.calls().length;
    sandbox?.setMode(null);
    sandbox?.schedule(first);
    pending[2]?.();
    const gatedCalls = sandbox?.calls().length;
    harness.check("overlay: the picker highlight is scheduled once per frame with the latest target and clear cancels the pending frame",
      sandbox !== undefined && burstFrames === 1 && burstCalls === 0 &&
      afterFrame.calls === 1 && afterFrame.latest === "a" && afterFrame.raf === null &&
      cleared.cancelled === 1 && cleared.handle === 2 && cleared.pendingTarget === null && cleared.raf === null &&
      afterStaleFrame === 1 && gatedCalls === 1,
      JSON.stringify({ burstFrames, burstCalls, afterFrame, cleared, afterStaleFrame, gatedCalls }));
    const mousemoveAt = overlay.indexOf("\"mousemove\"");
    const pickerSpan = mousemoveAt === -1 ? "" : overlay.slice(mousemoveAt, mousemoveAt + 900);
    harness.check("overlay: the picker mousemove branch schedules the highlight instead of painting it inline",
      pickerSpan !== "" && pickerSpan.includes("scheduleHighlight(target)") && !pickerSpan.includes("showHighlight(target)"),
      JSON.stringify({ hasScheduled: pickerSpan.includes("scheduleHighlight(target)"), hasInline: pickerSpan.includes("showHighlight(target)") }));
  }

  harness.section("client: overlay viewport pins");
  {
    const scheduleSource = extractFunction(overlay, "scheduleReposition");
    const pending = [];
    const run = scheduleSource === undefined ? undefined : evaluateExpression(`(requestAnimationFrame) => {
let repositionRaf = null;
let calls = 0;
function repositionPins() { calls += 1; }
${scheduleSource}
return { schedule: scheduleReposition, calls: () => calls, raf: () => repositionRaf };
}`, "scheduleReposition");
    const sandbox = run === undefined ? undefined : run((fn) => { pending.push(fn); return 1; });
    sandbox?.schedule();
    sandbox?.schedule();
    sandbox?.schedule();
    const frames = pending.length;
    const callsBefore = sandbox?.calls();
    pending[0]?.();
    const after = { calls: sandbox?.calls(), raf: sandbox?.raf() };
    harness.check("overlay: scroll repositions run at most once per frame",
      sandbox !== undefined && frames === 1 && callsBefore === 0 && after.calls === 1 && after.raf === null,
      JSON.stringify({ frames, callsBefore, after }));
  }
  {
    const repositionSource = extractFunction(overlay, "repositionPins");
    const pinIsFarSource = extractFunction(overlay, "pinIsFar");
    const ready = repositionSource !== undefined && pinIsFarSource !== undefined;
    const makeNode = () => {
      const classes = new Set();
      return { style: {}, classes, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } };
    };
    const run = ready ? evaluateExpression(`(requestAnimationFrame) => {
const pinNodes = new Map();
const pins = [];
const pinIoNear = new Map();
const pinIoRects = new Map();
const pinLastPoints = new Map();
let anchorCalls = 0;
function anchorPoint(pin) { anchorCalls += 1; return { x: 12, y: 34 }; }
function repositionDraft() {}
function repositionFocus() {}
function updateEdgeMarkers() {}
${pinIsFarSource}
${repositionSource}
return { run: repositionPins, nodes: pinNodes, pins, near: pinIoNear, rects: pinIoRects, last: pinLastPoints, anchorCalls: () => anchorCalls };
}`, "repositionPins") : undefined;
    const sandbox = run === undefined ? undefined : run((fn) => {});
    const nearNode = makeNode();
    sandbox?.nodes.set("a", { node: nearNode });
    sandbox?.pins.push({ id: "a" });
    sandbox?.run();
    const nearState = { calls: sandbox?.anchorCalls(), transform: nearNode.style.transform, last: sandbox?.last.get("a") };
    const farNode = makeNode();
    sandbox?.nodes.set("b", { node: farNode });
    sandbox?.pins.push({ id: "b", stale: true });
    farNode.classList.add("lr-pin-stale");
    sandbox?.near.set("b", false);
    sandbox?.rects.set("b", { width: 60, height: 30 });
    sandbox?.run();
    const farState = { calls: sandbox?.anchorCalls(), transform: farNode.style.transform, staleKept: farNode.classes.has("lr-pin-stale") };
    sandbox?.near.set("b", true);
    sandbox?.run();
    const caughtUp = { calls: sandbox?.anchorCalls(), transform: farNode.style.transform, staleCleared: !farNode.classes.has("lr-pin-stale") };
    harness.check("overlay: reposition skips far pins and catches up when the observer reports them near",
      sandbox !== undefined && nearState.calls === 1 && nearState.transform === "translate(12px, 34px)" && nearState.last?.x === 12 &&
      farState.calls === 2 && farState.transform === undefined && farState.staleKept === true &&
      caughtUp.calls === 4 && caughtUp.transform === "translate(12px, 34px)" && caughtUp.staleCleared === true,
      JSON.stringify({ nearState, farState, caughtUp }));
  }
  {
    const syncSource = extractFunction(overlay, "syncPinObserver");
    class FakeIO {
      constructor(callback, options) { this.callback = callback; this.options = options; this.observed = []; }
      observe(element) { this.observed.push(element); }
      unobserve(element) { this.observed = this.observed.filter((item) => item !== element); }
    }
    const elA = { tag: "a" };
    let io = null;
    const run = syncSource === undefined ? undefined : evaluateExpression(`(IntersectionObserver, locate) => {
const pins = [];
const pinIoIds = new Map();
const pinIoNear = new Map();
const pinIoRects = new Map();
let repositionRaf = null;
let pinObserver = null;
let scheduled = 0;
function scheduleReposition() { scheduled += 1; }
${syncSource}
return { sync: syncPinObserver, pins, ids: pinIoIds, near: pinIoNear, rects: pinIoRects, scheduled: () => scheduled, observer: () => pinObserver };
}`, "syncPinObserver");
    const sandbox = run === undefined ? undefined : run(class extends FakeIO { constructor(...args) { super(...args); io = this; } }, (selector) => (selector === "#a" ? elA : null));
    sandbox?.pins.push({ id: "p1", selector: "#a" });
    sandbox?.sync();
    const wired = { options: io?.options, observed: io?.observed.length, id: sandbox?.ids.get(elA) };
    io?.callback([{ target: elA, boundingClientRect: { left: 4, top: 6, width: 20, height: 10 }, isIntersecting: true }]);
    const reported = { near: sandbox?.near.get("p1"), rect: sandbox?.rects.get("p1"), scheduled: sandbox?.scheduled() };
    if (sandbox !== undefined) sandbox.pins.length = 0;
    sandbox?.sync();
    harness.check("overlay: the pin observer watches pinned elements, reports proximity and releases removed pins",
      sandbox !== undefined && wired.options?.rootMargin === "480px" && wired.observed === 1 && wired.id === "p1" &&
      reported.near === true && reported.rect?.left === 4 && reported.scheduled === 1 &&
      io?.observed.length === 0 && sandbox.ids.size === 0 && sandbox.near.size === 0 && sandbox.rects.size === 0,
      JSON.stringify({ wired, reported, remaining: io?.observed.length }));
  }
  {
    const edgeSource = extractFunction(overlay, "updateEdgeMarkers");
    const makeNode = () => {
      const node = { tag: "button", props: {}, children: [], style: {}, listeners: {} };
      node.append = (...kids) => { for (const kid of kids) node.children.push(kid); return node; };
      node.remove = () => { node.removed = (node.removed ?? 0) + 1; };
      node.addEventListener = (type, fn) => { node.listeners[type] = fn; };
      return node;
    };
    const el = (tag, attrs = {}, ...children) => {
      const node = makeNode();
      node.tag = tag;
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.props.class = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.props[k] = v;
      }
      for (const child of children) node.children.push(child);
      return node;
    };
    const fixedLayer = { appended: [], append: (node) => fixedLayer.appended.push(node) };
    const win = { innerWidth: 1200, innerHeight: 800 };
    const elA = { scrollIntoView: (payload) => { elA.scrollPayload = payload; } };
    const run = edgeSource === undefined ? undefined : evaluateExpression(`(window, fixedLayer, el, locate) => {
const pins = [];
let hidden = false;
const pinIoNear = new Map();
const pinIoRects = new Map();
const pinLastPoints = new Map();
const edgeChips = [];
const pulseTimers = new Map();
let repositionRaf = null;
let pulsed = null;
let repositionScheduled = 0;
function pulsePin(id) { pulsed = id; }
function scheduleReposition() { repositionScheduled += 1; }
function pinIsFar() { return false; }
const ICONS_CANVAS = { chev: "CHEV" };
${edgeSource}
return { update: updateEdgeMarkers, pins, setHidden: (v) => { hidden = v; }, layer: fixedLayer, chips: edgeChips, pulsed: () => pulsed, scheduled: () => repositionScheduled };
}`, "updateEdgeMarkers");
    const sandbox = run === undefined ? undefined : run(win, fixedLayer, el, (selector) => (selector === "#a" ? elA : null));
    sandbox?.pins.push(
      { id: "p1", selector: "#a", tag: "div", status: "queued", comment: "first", rect: { x: -40, y: 305 } },
      { id: "p2", selector: "#gone", tag: "div", status: "queued", comment: "second", rect: { x: -42, y: 318 } },
      { id: "p3", selector: "#c", tag: "div", status: "queued", comment: "right", rect: { x: 1250, y: 100 } },
      { id: "p4", selector: "#d", tag: "div", status: "resolvido", comment: "resolved", rect: { x: -40, y: 700 } },
      { id: "p5", selector: "#e", tag: "div", status: "queued", comment: "visible", rect: { x: 100, y: 100 } }
    );
    sandbox?.update();
    const firstPass = fixedLayer.appended.length;
    const chips = fixedLayer.appended.slice(0, 2);
    const leftChip = chips[0];
    const rightChip = chips[1];
    const leftCount = leftChip?.children[1]?.children[0];
    const rightCount = rightChip?.children[1]?.children[0];
    leftChip?.listeners.click?.();
    const clicked = { block: elA.scrollPayload?.block, pulsed: sandbox?.pulsed(), scheduled: sandbox?.scheduled() };
    sandbox?.setHidden(true);
    sandbox?.update();
    const afterHidden = { chips: sandbox?.chips.length, removed: leftChip?.removed };
    sandbox?.setHidden(false);
    sandbox?.update();
    const restored = { chips: sandbox?.chips.length };
    harness.check("overlay: off-viewport pins get clustered edge chips with direction, count, scroll and pulse",
      sandbox !== undefined && firstPass === 2 &&
      leftChip?.props["data-side"] === "left" && leftChip?.style.left === "3px" && leftChip?.style.top === "294px" &&
      leftCount === "2" && rightChip?.props["data-side"] === "right" && rightChip?.style.right === "3px" &&
      rightChip?.style.top === "89px" && rightCount === "3" && leftChip?.children[0]?.props.html === "CHEV" &&
      chips[0] !== undefined && chips[0].children[0].children.length === 0 &&
      clicked.block === "center" && clicked.pulsed === "p1" && clicked.scheduled === 1 &&
      afterHidden.chips === 0 && afterHidden.removed === 1 && restored.chips === 2,
      JSON.stringify({ chips: chips.map((chip) => ({ side: chip.props["data-side"], style: chip.style, count: chip.children[1]?.children[0] })), clicked, afterHidden, restored }));
  }
  harness.check("overlay: scroll and resize schedule reposition and renderPins syncs the observer and chips",
    overlay.includes("window.addEventListener(\"scroll\", scheduleReposition") &&
    overlay.includes("window.addEventListener(\"resize\", scheduleReposition)") &&
    overlay.includes("if (!hidden) syncPinObserver();") &&
    overlay.includes("updateEdgeMarkers();") &&
    overlay.includes("rootMargin: \"480px\""),
    "wiring drift");

  harness.section("client: overlay inspector filter");
  {
    const normalizeSource = extractFunction(overlay, "normalizeInspectorText");
    const applySource = extractFunction(overlay, "applyInspectorFilter");
    const run = normalizeSource === undefined || applySource === undefined ? undefined : evaluateExpression(`() => {
${normalizeSource}
${applySource}
return { apply: applyInspectorFilter, normalize: normalizeInspectorText, mkEntry };
function mkEntry(wasOpen, texts) {
  const section = { style: {}, attrs: new Set(), setAttribute(n) { this.attrs.add(n); }, removeAttribute(n) { this.attrs.delete(n); }, hasAttribute(n) { return this.attrs.has(n); } };
  const head = { aria: null, setAttribute(n, v) { this.aria = v; } };
  const body = { style: {} };
  return { section, head, body, wasOpen, rows: texts.map((text) => ({ row: { style: {} }, text })) };
}
}`, "applyInspectorFilter");
    const sandbox = run === undefined ? undefined : run();
    const a = sandbox?.mkEntry(true, ["border radius", "width"]);
    const b = sandbox?.mkEntry(false, ["background color", "opacity"]);
    const states = sandbox?.mkEntry(false, ["hover focus active states"]);
    const emptyNote = { style: {} };
    sandbox?.apply("", [a, b, states], emptyNote);
    const restored = { aOpen: a.section.hasAttribute("data-open"), bOpen: b.section.hasAttribute("data-open"), bBody: b.body.style.display, aRows: a.rows.map((row) => row.row.style.display) };
    sandbox?.apply("Radius", [a, b, states], emptyNote);
    const filtered = { aOpen: a.section.hasAttribute("data-open"), aVisible: a.section.style.display, widthHidden: a.rows[1].row.style.display === "none", bHidden: b.section.style.display === "none", statesHidden: states.section.style.display === "none", emptyNote: emptyNote.style.display };
    sandbox?.apply("active", [a, b, states], emptyNote);
    const statesOnly = { statesVisible: states.section.style.display === "", aHidden: a.section.style.display === "none", emptyNote: emptyNote.style.display };
    sandbox?.apply("zzz", [a, b, states], emptyNote);
    const none = { emptyNote: emptyNote.style.display, allHidden: [a.section.style.display, b.section.style.display, states.section.style.display].every((d) => d === "none") };
    harness.check("overlay: the inspector filter matches rows, keeps groups open and restores them on clear",
      sandbox !== undefined && restored.aOpen === true && restored.bOpen === false && restored.bBody === "none" && restored.aRows.every((d) => d === "") &&
      filtered.aOpen === true && filtered.aVisible === "" && filtered.widthHidden === true && filtered.bHidden === true && filtered.statesHidden === true && filtered.emptyNote === "none" &&
      statesOnly.statesVisible === true && statesOnly.aHidden === true && statesOnly.emptyNote === "none" &&
      none.emptyNote === "" && none.allHidden === true &&
      sandbox.normalize("Configuração") === "configuracao",
      JSON.stringify({ restored, filtered, statesOnly, none, normalized: sandbox?.normalize("Configuração") }));
  }
  harness.check("overlay: the adjust panel wires the filter bar and ships its strings in every language",
    overlay.includes("wireInspectorFilter(body);") &&
    overlay.includes("t(\"inspectorFilterPlaceholder\")") &&
    overlay.includes("t(\"inspectorFilterNoResults\")") &&
    overlay.includes("t(\"inspectorFilterClear\")") &&
    overlay.includes("row.setAttribute(\"data-filter\", opts.filter)") &&
    overlay.includes("filter: props4.join(\" \")") &&
    overlay.includes("filter: \"font-weight font-style text-decoration\"") &&
    overlay.includes(".lr-filter { all: unset"),
    "filter wiring drift");

  harness.section("client: overlay capture quality");
  {
    const presetSource = extractFunction(overlay, "capturePreset");
    const run = presetSource === undefined ? undefined : evaluateExpression(`() => {
let captureQuality = "bogus";
${presetSource}
return { value: () => capturePreset(captureQuality), set: (v) => { captureQuality = v; } };
}`, "capturePreset");
    const sandbox = run === undefined ? undefined : run();
    const bogus = sandbox?.value();
    sandbox?.set("leve");
    const leve = sandbox?.value();
    sandbox?.set("alta");
    const alta = sandbox?.value();
    harness.check("overlay: the capture preset picks the quality pair and falls back to the standard",
      sandbox !== undefined && bogus?.maxEdge === 900 && bogus?.quality === 0.8 &&
      leve?.maxEdge === 640 && leve?.quality === 0.7 &&
      alta?.maxEdge === 1400 && alta?.quality === 0.92,
      JSON.stringify({ bogus, leve, alta }));
    harness.check("overlay: the capture quality arrives from settings and sizes the crop",
      overlay.includes("if (typeof next.captureQuality === \"string\") captureQuality =") &&
      overlay.includes("const preset = capturePreset(captureQuality);") &&
      overlay.includes("preset.maxEdge / Math.max(sw, sh)") &&
      overlay.includes("toDataURL(\"image/jpeg\", preset.quality)") &&
      overlay.includes("let captureQuality = \"padrao\";") &&
      !overlay.includes("CROP_MAX_EDGE"),
      "capture quality wiring drift");
  }

  harness.section("client: overlay capture timeout");
  {
    const raceSource = extractFunction(overlay, "raceCapture");
    const clearedTimers = [];
    const run = raceSource === undefined ? undefined : evaluateExpression(`(setTimeout, clearTimeout) => {
let captureAbort = null;
${raceSource}
return { race: raceCapture, abort: () => captureAbort?.(), armed: () => captureAbort !== null };
}`, "raceCapture");
    const sandbox = run === undefined ? undefined : run(setTimeout, (handle) => clearedTimers.push(handle));
    let cancelled = null;
    const first = sandbox?.race(new Promise(() => {}), 30000);
    const armed = sandbox?.armed();
    first?.then((value) => { cancelled = value; });
    sandbox?.abort();
    const afterAbort = sandbox?.armed();
    let doneValue = null;
    sandbox?.race(Promise.resolve("fast"), 30000).then((value) => { doneValue = value; });
    await waitFor(() => doneValue !== null);
    let timedOut = null;
    sandbox?.race(new Promise(() => {}), 30).then((value) => { timedOut = value; });
    await waitFor(() => timedOut !== null);
    harness.check("overlay: the capture race resolves done, timeout and cancelled exactly once",
      sandbox !== undefined && armed === true && cancelled?.status === "cancelled" && afterAbort === false &&
      doneValue?.status === "done" && doneValue?.canvas === "fast" && clearedTimers.length >= 2 && timedOut?.status === "timeout",
      JSON.stringify({ armed, cancelled, afterAbort, doneValue, clearedTimers: clearedTimers.length, timedOut }));
  }
  {
    const raceSource = extractFunction(overlay, "raceCapture");
    const cropSource = extractFunction(overlay, "captureCropFor");
    const run = cropSource === undefined ? undefined : evaluateExpression(`(setTimeout, clearTimeout) => {
let captureTimeout = 0.05;
let captureCancelled = false;
let captureAbort = null;
let CROP_PAD = 72;
const CAPTURE_SIMPLIFIED_TAGS = new Set(["IMG", "VIDEO", "IFRAME", "OBJECT", "EMBED"]);
const toasts = [];
const calls = [];
function t(key) { return key; }
function toast(text) { toasts.push(text); }
function reportDiag() {}
function showCaptureToast() {}
function hideCaptureToast() {}
function cropCanvas() { return "CROPPED"; }
const window = { html2canvas: (body, options) => { calls.push(options); return calls.length === 1 || calls.length === 4 ? new Promise(() => {}) : Promise.resolve({ width: 100 }); }, innerWidth: 1200, innerHeight: 800, scrollX: 0, scrollY: 0 };
const document = { body: {} };
async function ensureHtml2Canvas() { return true; }
${raceSource}
${cropSource}
return { capture: captureCropFor, calls: () => calls, toasts: () => toasts, cancelled: () => captureCancelled, abort: () => captureAbort?.(), armed: () => captureAbort !== null };
}`, "captureCropFor");
    const sandbox = run === undefined ? undefined : run(setTimeout, clearTimeout);
    const guarded = (promise, label) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(label), 6000))]);
    const retriedPromise = sandbox?.capture({ x: 0, y: 0, w: 10, h: 10 });
    await waitFor(() => (sandbox?.calls().length ?? 0) >= 2, 4000, 20);
    const retried = await guarded(retriedPromise, "retried-stuck");
    const firstIgnore = sandbox?.calls()[0]?.ignoreElements;
    const secondIgnore = sandbox?.calls()[1]?.ignoreElements;
    const classified = { firstPlain: firstIgnore?.({ id: "", tagName: "DIV" }), simplifiedImg: secondIgnore?.({ id: "", tagName: "IMG" }), simplifiedHost: secondIgnore?.({ id: "dsh-redline-host", tagName: "DIV" }), simplifiedPlain: secondIgnore?.({ id: "", tagName: "DIV" }) };
    const normal = await guarded(sandbox?.capture({ x: 0, y: 0, w: 10, h: 10 }), "normal-stuck");
    const cancelledPromise = sandbox?.capture({ x: 0, y: 0, w: 10, h: 10 });
    await waitFor(() => sandbox?.armed() === true, 4000, 20);
    sandbox?.abort();
    const cancelled = await guarded(cancelledPromise, "cancelled-stuck");
    const cancelledState = { value: cancelled, cancelled: sandbox?.cancelled(), calls: sandbox?.calls().length };
    harness.check("overlay: a timed out capture retries simplified and a cancelled capture returns null",
      sandbox !== undefined && retried === "CROPPED" && sandbox?.toasts()[0] === "captureTimeoutFallback" &&
      classified.firstPlain === false && classified.simplifiedImg === true && classified.simplifiedHost === true && classified.simplifiedPlain === false &&
      normal === "CROPPED" && cancelledState.value === null && cancelledState.cancelled === true && cancelledState.calls === 4,
      JSON.stringify({ retried, toasts: sandbox?.toasts(), classified, normal, cancelledState }));
  }
  {
    const beforeSource = extractFunction(overlay, "captureBeforeAfter");
    const run = beforeSource === undefined ? undefined : evaluateExpression(`(screenshotOnSend, captureCropFor, restoreAll, applyCommitted, adjustPatch, target, pin) => {
let captureCancelled = false;
${beforeSource}
return { run: (theTarget, thePin) => captureBeforeAfter(theTarget, thePin), cancel: () => { captureCancelled = true; } };
}`, "captureBeforeAfter");
    const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 50, height: 50 }) };
    const captures = [];
    const restored = [];
    const applied = [];
    const capture = async () => { captures.push("c"); return null; };
    const restore = () => restored.push("restore");
    const apply = () => applied.push("apply");
    const patch = { originalText: null };
    const pin = { changes: [{ prop: "color", after: "red" }] };
    const cancelledBox = run === undefined ? undefined : run(true, capture, restore, apply, patch, target, pin);
    cancelledBox?.cancel();
    await cancelledBox?.run(target, pin);
    const cancelledFlow = { captures: captures.length, restored: restored.length, applied: applied.length };
    const normalBox = run === undefined ? undefined : run(true, async () => { captures.push("c"); return "shot"; }, restore, apply, patch, target, pin);
    const baseCaptures = captures.length;
    const baseRestored = restored.length;
    const baseApplied = applied.length;
    await normalBox?.run(target, pin);
    const normalFlow = { captures: captures.length - baseCaptures, restored: restored.length - baseRestored, applied: applied.length - baseApplied };
    harness.check("overlay: a cancelled before-capture still commits the changes and skips the second shot",
      cancelledBox !== undefined && cancelledFlow.captures === 1 && cancelledFlow.restored === 1 && cancelledFlow.applied === 1 &&
      normalFlow.captures === 2 && normalFlow.restored === 1 && normalFlow.applied === 1,
      JSON.stringify({ cancelledFlow, normalFlow }));
  }

  harness.section("client: overlay capture reuse");
  {
    const raceSource = extractFunction(overlay, "raceCapture");
    const cropSource = extractFunction(overlay, "captureCropFor");
    const run = cropSource === undefined ? undefined : evaluateExpression(`(setTimeout, clearTimeout) => {
let captureTimeout = 0;
let captureCancelled = false;
let captureAbort = null;
let CROP_PAD = 72;
const CAPTURE_SIMPLIFIED_TAGS = new Set(["IMG", "VIDEO", "IFRAME", "OBJECT", "EMBED"]);
const calls = [];
const scroll = { x: 0, y: 0 };
function cropCanvas(canvas, rect) { return \`crop-\${rect.x}\`; }
const window = { html2canvas: () => { calls.push("render"); return Promise.resolve({ width: 100 }); }, innerWidth: 1200, innerHeight: 800, get scrollX() { return scroll.x; }, get scrollY() { return scroll.y; } };
const document = { body: {} };
async function ensureHtml2Canvas() { return true; }
function showCaptureToast() {}
function hideCaptureToast() {}
function toast() {}
function reportDiag() {}
function t(key) { return key; }
function groupCanvasKey() { return \`\${window.scrollX}|\${window.scrollY}|\${window.innerWidth}|\${window.innerHeight}\`; }
${raceSource}
${cropSource}
return { capture: captureCropFor, calls: () => calls, scroll, armed: () => captureAbort !== null };
}`, "captureCropFor");
    const sandbox = run === undefined ? undefined : run(setTimeout, clearTimeout);
    const guarded = (promise, label) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(label), 6000))]);
    const reuse = { canvas: null, key: null, at: 0 };
    const first = await guarded(sandbox?.capture({ x: 0, y: 0, w: 10, h: 10 }, 72, false, reuse), "first-stuck");
    const second = await guarded(sandbox?.capture({ x: 5, y: 5, w: 10, h: 10 }, 72, false, reuse), "second-stuck");
    if (sandbox !== undefined) sandbox.scroll.y = 300;
    const scrolled = await guarded(sandbox?.capture({ x: 0, y: 0, w: 10, h: 10 }, 72, false, reuse), "scrolled-stuck");
    harness.check("overlay: group captures reuse the rendered canvas until the page or viewport changes",
      sandbox !== undefined && first === "crop-0" && second === "crop-5" && scrolled === "crop-0" &&
      sandbox?.calls().length === 2,
      JSON.stringify({ first, second, scrolled, renders: sandbox?.calls().length }));
  }

  harness.section("client: overlay audit batching");
  {
    const auditSource = extractFunction(overlay, "runPageAudit");
    const run = auditSource === undefined ? undefined : evaluateExpression(`(setTimeout, clearTimeout) => {
const A11Y_AUDIT_FAMILY_SELECTORS = { interactive: "i", images: "img", semantic: "s" };
const elements = [];
for (let index = 0; index < 100; index += 1) elements.push({ __fail: index % 10 === 0, tag: "div" });
const root = { querySelectorAll: (selector) => (selector === "i" ? elements : []) };
const document = { body: root };
let probes = 0;
function collectAuditCandidates(families, budget) { return families.interactive(); }
function pickAuditCandidates(list, cap) { return list.slice(0, cap); }
function auditElement(element) { probes += 1; return [{ check: "contrast", status: element.__fail === true ? "fail" : "pass", value: "1" }]; }
function cssPath() { return "path"; }
function quickLabel() { return "label"; }
${auditSource}
return { run: runPageAudit, probes: () => probes };
}`, "runPageAudit");
    const sandbox = run === undefined ? undefined : run(setTimeout, clearTimeout);
    const guarded = (promise, label) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(label), 6000))]);
    const updates = [];
    const result = await guarded(sandbox?.run({ limit: 400, onProgress: (update) => updates.push({ done: update.done, total: update.total, findings: update.findings.length }), shouldStop: null }), "audit-stuck");
    const chunking = { updates: updates.map((update) => update.done), total: updates[0]?.total, findings: result?.findings.length, scanned: result?.scanned };
    const stopUpdates = [];
    const stopResult = await guarded(sandbox?.run({ limit: 400, onProgress: (update) => stopUpdates.push(update.done), shouldStop: () => stopUpdates.length >= 1 }), "stop-stuck");
    harness.check("overlay: the page audit runs in chunks with progress and honors a stop",
      sandbox !== undefined && JSON.stringify(chunking.updates) === "[40,80,100]" && chunking.total === 100 && chunking.findings === 10 && chunking.scanned === 100 && sandbox?.probes() === 140 &&
      stopResult?.stopped === true && stopResult?.scanned === 40 && JSON.stringify(stopUpdates) === "[40]",
      JSON.stringify({ chunking, stopUpdates, stopScanned: stopResult?.scanned, stopped: stopResult?.stopped }));
    harness.check("overlay: the audit panel streams progress and the limit arrives from settings",
      overlay.includes("async function runPageAudit(options)") &&
      overlay.includes("shouldStop: () => auditRunToken !== token") &&
      overlay.includes("auditRunToken += 1;") &&
      overlay.includes("t(\"auditCancel\")") &&
      overlay.includes("t(\"auditPartial\")") &&
      overlay.includes("limit: auditLimit") &&
      overlay.includes("if (Number.isFinite(Number(next.auditLimit))) auditLimit = Math.max(50, Math.min(2000, Math.round(Number(next.auditLimit))));") &&
      overlay.includes(".lr-audit-progress-track"),
      "audit batching wiring drift");
  }
  harness.check("the card renders the context budget with removable dropped pins",
    client.includes("dockPreviewChars") && client.includes("dockPreviewDropped") &&
    client.includes("lr-preview-dropped-row") && client.includes("removePreviewPin") &&
    client.includes("chars: Number.isFinite(Number(data.chars))"),
    "card budget wiring drift");
  harness.check("overlay: the drawing dock defaults to the left column and follows the setting",
    overlay.includes("let drawDock = \"left\";") &&
    overlay.includes(".lr-drawbar[data-dock=\"top\"]") &&
    overlay.includes(".lr-drawbar[data-dock=\"right\"]") &&
    overlay.includes(".lr-drawbar[data-dock=\"bottom\"]") &&
    overlay.includes("drawBar.setAttribute(\"data-dock\", drawDock)") &&
    overlay.includes("if (typeof next.drawDock === \"string\") drawDock = [\"left\", \"top\", \"right\", \"bottom\"].includes(next.drawDock) ? next.drawDock : \"left\";") &&
    overlay.includes("drawBar?.setAttribute(\"data-dock\", drawDock);"),
    "draw dock wiring drift");

  harness.section("client: overlay ui polish");
  {
    const panelSource = extractFunction(overlay, "renderPinPanel");
    harness.check("overlay: the ancestor trail chips carry the styled chip class",
      panelSource !== undefined && panelSource.includes("{ type: \"button\", class: \"lr-trail-chip\"") &&
      overlay.includes(".lr-trail-chip { all: unset"),
      panelSource === undefined ? "renderPinPanel missing" : "chips render unstyled");
    harness.check("overlay: the states row leads the inspector body",
      overlay.includes("body.prepend(inspectorRow(t(\"inspectorStates\")"),
      "states row must be prepended, not appended");
    harness.check("overlay: the toolbar stacks above dragged panels",
      overlay.includes(".popover { z-index: 2147483601; }") && overlay.includes(".toolbar-wrap { z-index: 2147483602; }"),
      "toolbar must out-stack panels");
    harness.check("overlay: pin markers pass clicks through while drawing",
      overlay.includes("rootDiv.classList.toggle(\"lr-drawing\", drawMode)") &&
      overlay.includes(".root.lr-drawing .pin { pointer-events: none; }"),
      "draw mode must silence marker clicks");
    harness.check("overlay: toolbar labels never wrap",
      overlay.includes(".tool-label { font-weight: 500; color: inherit; white-space: nowrap; }"),
      "pending count wraps to two lines without nowrap");
  }

  harness.section("client: overlay inspector force states");
  {
    const classesSource = extractArrowConst(overlay, "FORCE_STATE_CLASSES");
    const splitSource = extractFunction(overlay, "forceSubjectSplit");
    const spansSource = extractFunction(overlay, "notPseudoSpans");
    const buildSource = extractFunction(overlay, "buildForceRules");
    const ready = classesSource !== undefined && splitSource !== undefined && spansSource !== undefined && buildSource !== undefined;
    const buildRun = ready ? evaluateExpression(`(document, target, pseudo) => {
${classesSource}
${spansSource}
${splitSource}
${buildSource}
return buildForceRules(target, pseudo);
}`, "buildForceRules") : undefined;
    const matchingTarget = { matches: (selector) => selector === ".btn" };
    const itemTarget = { matches: (selector) => selector === ".item" };
    const plainSheet = (selectorText, cssText) => ({ cssRules: [{ selectorText, style: { cssText } }] });
    const docWith = (sheets) => ({ styleSheets: sheets });
    const basic = buildRun === undefined ? undefined : buildRun(docWith([plainSheet(".btn:hover", "color:red")]), matchingTarget, "hover");
    const multi = buildRun === undefined ? undefined : buildRun(docWith([plainSheet(".btn:hover:hover", "color:red")]), matchingTarget, "hover");
    harness.check("overlay: buildForceRules rewrites the subject compound exactly",
      buildRun !== undefined && JSON.stringify(basic) === JSON.stringify([".btn.lr-fh{color:red}"]) &&
      JSON.stringify(multi) === JSON.stringify([".btn.lr-fh.lr-fh{color:red}"]),
      JSON.stringify({ basic, multi }));
    const nonSubject = buildRun === undefined ? undefined : buildRun(docWith([plainSheet(".menu:hover .item", "color:red")]), itemTarget, "hover");
    harness.check("overlay: buildForceRules skips rules whose pseudo sits in a non-subject compound",
      buildRun !== undefined && JSON.stringify(nonSubject) === JSON.stringify([]),
      JSON.stringify({ nonSubject }));
    const comma = buildRun === undefined ? undefined : buildRun(docWith([plainSheet(".btn:hover, .card:hover .inner, .x:not(:hover)", "color:red")]), matchingTarget, "hover");
    harness.check("overlay: buildForceRules emits only the matching comma part and skips :not-wrapped pseudos",
      buildRun !== undefined && JSON.stringify(comma) === JSON.stringify([".btn.lr-fh{color:red}"]),
      JSON.stringify({ comma }));
    const mediaRule = { conditionText: "screen", cssRules: [{ selectorText: ".btn:hover", style: { cssText: "color:red" } }] };
    const throwingSheet = { get cssRules() { throw new Error("cross-origin"); } };
    let recursion = null;
    try { recursion = buildRun === undefined ? undefined : buildRun(docWith([throwingSheet, { cssRules: [mediaRule] }, plainSheet(".btn:hover", "outline:solid red")]), matchingTarget, "hover"); } catch (error) { recursion = `threw: ${error}`; }
    harness.check("overlay: buildForceRules recurses into grouping rules and skips throwing sheets",
      Array.isArray(recursion) && JSON.stringify(recursion) === JSON.stringify([".btn.lr-fh{color:red}", ".btn.lr-fh{outline:solid red}"]),
      JSON.stringify({ recursion }));
  }
  {
    const classesSource = extractArrowConst(overlay, "FORCE_STATE_CLASSES");
    const splitSource = extractFunction(overlay, "forceSubjectSplit");
    const spansSource = extractFunction(overlay, "notPseudoSpans");
    const buildSource = extractFunction(overlay, "buildForceRules");
    const applySource = extractFunction(overlay, "applyForceStates");
    const clearSource = extractFunction(overlay, "clearForceStates");
    const ready = [classesSource, splitSource, spansSource, buildSource, applySource, clearSource].every((source) => source !== undefined);
    const created = [];
    const fakeDocument = {
      styleSheets: [{ cssRules: [{ selectorText: ".btn:hover", style: { cssText: "color:red" } }, { selectorText: ".btn:focus", style: { cssText: "outline:2px solid red" } }] }],
      head: { append: (node) => created.push(node) },
      createElement: (tag) => ({ tag, textContent: "", id: null, removed: 0, remove() { this.removed += 1; } }),
      getElementById: (id) => created.find((node) => node.id === id) ?? null,
      documentElement: { append() {} }
    };
    const target = {
      matches: (selector) => selector === ".btn",
      classList: { toggles: [], removed: [], toggle(name, on) { this.toggles.push([name, on]); }, remove(name) { this.removed.push(name); } }
    };
    const run = ready ? evaluateExpression(`(document, target) => {
${classesSource}
${spansSource}
${splitSource}
${buildSource}
${clearSource}
${applySource}
let forceTarget = null;
let forceStates = new Set();
forceTarget = target;
return { apply: applyForceStates, clear: clearForceStates, force: (pseudo) => forceStates.add(pseudo), states: () => [...forceStates], target: () => forceTarget };
}`, "applyForceStates") : undefined;
    const sandbox = run === undefined ? undefined : run(fakeDocument, target);
    sandbox?.force("hover");
    sandbox?.force("focus");
    sandbox?.apply();
    const tag = created[0];
    sandbox?.apply();
    harness.check("overlay: applyForceStates markers the target and writes one style tag for all forced states",
      sandbox !== undefined &&
      JSON.stringify(target.classList.toggles.slice(0, 3)) === JSON.stringify([["lr-fh", true], ["lr-ff", true], ["lr-fa", false]]) &&
      tag !== undefined && tag.id === "lr-force-states" && created.length === 1 &&
      tag.textContent === ".btn.lr-fh{color:red}.btn.lr-ff{outline:2px solid red}",
      JSON.stringify({ toggles: target.classList.toggles, tags: created.length, text: tag?.textContent }));
    sandbox?.clear();
    const cleared = { removed: target.classList.removed, tagRemoved: tag?.removed, target: sandbox?.target(), states: sandbox?.states() };
    sandbox?.apply();
    harness.check("overlay: clearForceStates removes the markers, the style tag and resets the state",
      sandbox !== undefined && JSON.stringify(cleared.removed) === JSON.stringify(["lr-fh", "lr-ff", "lr-fa"]) &&
      cleared.tagRemoved === 1 && cleared.target === null && JSON.stringify(cleared.states) === JSON.stringify([]) &&
      created.length === 1,
      JSON.stringify({ cleared, tags: created.length }));
  }
  {
    const closeSource = extractFunction(overlay, "closeAdjustPanel");
    const openSource = extractFunction(overlay, "openAdjustPanel");
    harness.check("overlay: the force-state lifecycle hooks the adjust panel close and confirm paths",
      closeSource !== undefined && closeSource.includes("clearForceStates();") &&
      closeSource.indexOf("clearForceStates();") < closeSource.indexOf("restoreAll") &&
      openSource !== undefined && openSource.includes("closeAdjustPanel(false)") &&
      openSource.includes("t(\"inspectorStates\")") &&
      ["\"hover\"", "\"focus\"", "\"active\""].every((literal) => openSource.includes(literal)) &&
      openSource.includes("forceTarget = adjustTarget") && openSource.includes("forceStates = new Set()"),
      JSON.stringify({ clearFirst: closeSource !== undefined && closeSource.indexOf("clearForceStates();") < closeSource.indexOf("restoreAll"), confirm: openSource?.includes("closeAdjustPanel(false)"), chips: openSource?.includes("inspectorStates") }));
  }

  harness.section("client: overlay theme derivation");
  {
    const themeClassSource = extractFunction(overlay, "themeRootClass");
    const themeClass = themeClassSource === undefined ? undefined : evaluateExpression(`(theme) => {\n${themeClassSource}\nreturn themeRootClass(theme);\n}`, "themeRootClass");
    harness.check("overlay: themeRootClass maps each theme to its root class",
      themeClass !== undefined && themeClass("dark") === "root dark" && themeClass("light") === "root" &&
      themeClass("contrast") === "root dark contrast" && themeClass("sepia") === "root dark" && themeClass(undefined) === "root dark",
      JSON.stringify({ dark: themeClass?.("dark"), light: themeClass?.("light"), contrast: themeClass?.("contrast"), sepia: themeClass?.("sepia") }));
    harness.check("overlay: the overlay mounts with the class derived from settings",
      overlay.includes('el("div", { class: themeRootClass(SETTINGS.theme) })'),
      "rootDiv creation must derive its class from the settings");
    const applyBody = /function applySettings\(next\) \{[\s\S]*?\n  \}/.exec(overlay)?.[0] ?? "";
    const guardBody = /if \(!hostSettingsApplied\) \{[\s\S]*?\n    \}/.exec(applyBody)?.[0] ?? "";
    harness.check("overlay: applySettings re-applies the theme on every poll",
      applyBody.includes("rootDiv.className = themeRootClass(next.theme)") && guardBody !== "" && !guardBody.includes("themeRootClass"),
      applyBody.slice(0, 200));
  }

  harness.section("client: overlay inspector undo redo");
  {
    const makeRun = evaluateExpression(`() => {
      let adjustUndoStack = [];
      let adjustRedoStack = [];
      const adjustValues = new Map([["color", "10px"]]);
      let adjustText = "";
      const adjustInvalid = new Set();
      const adjustPatch = { element: { style: {} } };
      const adjustBaseline = () => "10px";
      const resets = [];
      const restoreAdjustBaseline = (prop) => { resets.push(prop); adjustValues.set(prop, adjustBaseline(prop)); };
      const previews = [];
      const previewStyle = (patch, prop, value) => previews.push({ prop, value });
      const rerenderAdjustRows = () => {};
      const textApplies = [];
      const applyAdjustText = (next) => { textApplies.push(next); adjustText = next; };
      const isSafeValue = () => true;
      ${extractFunction(overlay, "adjustUpdateProperty")}
      ${extractFunction(overlay, "applyAdjustEntry")}
      ${extractFunction(overlay, "adjustUndo")}
      ${extractFunction(overlay, "adjustRedo")}
      ${extractFunction(overlay, "adjustUpdateText")}
      return { adjustUpdateProperty, adjustUpdateText, adjustUndo, adjustRedo, stacks: () => ({ undo: [...adjustUndoStack], redo: [...adjustRedoStack], value: adjustValues.get("color"), text: adjustText, textApplies: [...textApplies], resets: [...resets], previews: [...previews] }) };
    }`, "adjust-undo-redo");
    {
      const run = makeRun();
      run.adjustUpdateProperty("color", "12px");
      run.adjustUndo();
      const after = run.stacks();
      harness.check("overlay: undo restores the prior property value and pushes the current one to redo",
        JSON.stringify(after.redo) === JSON.stringify([{ kind: "prop", prop: "color", value: "12px" }]) &&
        JSON.stringify(after.resets) === JSON.stringify(["color"]) && after.undo.length === 0 && after.value === "10px",
        JSON.stringify(after));
    }
    {
      const run = makeRun();
      run.adjustUpdateProperty("color", "12px");
      run.adjustUndo();
      run.adjustRedo();
      const after = run.stacks();
      harness.check("overlay: redo re-applies what undo popped",
        after.value === "12px" && after.previews.length === 2 && JSON.stringify(after.previews[1]) === JSON.stringify({ prop: "color", value: "12px" }) &&
        after.redo.length === 0 && JSON.stringify(after.undo) === JSON.stringify([{ kind: "prop", prop: "color", value: "10px" }]),
        JSON.stringify(after));
    }
    {
      const run = makeRun();
      run.adjustUpdateProperty("color", "12px");
      run.adjustUndo();
      run.adjustUpdateProperty("color", "14px");
      const before = run.stacks();
      run.adjustRedo();
      const after = run.stacks();
      harness.check("overlay: a fresh edit clears the redo stack",
        before.redo.length === 0 && after.redo.length === 0 && after.value === "14px" && after.undo.length === 1 && after.previews.length === 2,
        JSON.stringify({ before, after }));
    }
    {
      const run = makeRun();
      run.adjustUpdateText("A");
      run.adjustUpdateText("B");
      run.adjustUndo();
      const mid = run.stacks();
      run.adjustRedo();
      const after = run.stacks();
      run.adjustUpdateText("C");
      const fresh = run.stacks();
      harness.check("overlay: text edits swap stepwise through undo and redo",
        mid.text === "A" && JSON.stringify(mid.redo) === JSON.stringify([{ kind: "text", prop: null, value: "B" }]) &&
        after.text === "B" && after.redo.length === 0 &&
        JSON.stringify(after.undo) === JSON.stringify([{ kind: "text", prop: null, value: "" }, { kind: "text", prop: null, value: "A" }]) &&
        JSON.stringify(after.textApplies) === JSON.stringify(["A", "B", "A", "B"]) &&
        fresh.text === "C" && fresh.redo.length === 0,
        JSON.stringify({ mid, after, fresh }));
    }
    {
      const realRun = evaluateExpression(`() => {
      let adjustUndoStack = [];
      let adjustRedoStack = [];
      const adjustValues = new Map([["color", "10px"]]);
      let adjustText = "";
      const adjustInvalid = new Set();
      const adjustPatch = { element: { style: {} }, computedBaselines: new Map([["color", "10px"]]) };
      const adjustBaseline = () => "10px";
      const previews = [];
      const previewStyle = (patch, prop, value) => previews.push({ prop, value });
      const restored = [];
      const restoreStyle = (patch, prop) => restored.push(prop);
      const rerenderAdjustRows = () => {};
      const applyAdjustText = () => {};
      const isSafeValue = () => true;
      let adjustTarget = null;
      let adjustTargetSelector = "";
      const adjustLedger = new Map();
      ${extractFunction(overlay, "restoreAdjustBaseline")}
      ${extractFunction(overlay, "adjustReset")}
      ${extractFunction(overlay, "adjustUpdateProperty")}
      ${extractFunction(overlay, "applyAdjustEntry")}
      ${extractFunction(overlay, "adjustUndo")}
      ${extractFunction(overlay, "adjustRedo")}
      return { adjustUpdateProperty, adjustUndo, adjustRedo, stacks: () => ({ undo: [...adjustUndoStack], redo: [...adjustRedoStack], value: adjustValues.get("color") }) };
    }`, "adjust-undo-baseline-redo")();
      realRun.adjustUpdateProperty("color", "12px");
      realRun.adjustUndo();
      const afterUndo = realRun.stacks();
      realRun.adjustRedo();
      const afterRedo = realRun.stacks();
      harness.check("overlay: redo survives an undo that lands on the baseline",
        JSON.stringify(afterUndo.redo) === JSON.stringify([{ kind: "prop", prop: "color", value: "12px" }]) &&
        afterRedo.value === "12px" && afterRedo.redo.length === 0,
        JSON.stringify({ afterUndo, afterRedo }));
    }
    {
      const guardAt = overlay.indexOf('if (tag === "INPUT" || tag === "TEXTAREA" || from?.isContentEditable === true) return;');
      const undoAt = guardAt === -1 ? -1 : overlay.indexOf("adjustUndo();", guardAt);
      const keydownAt = guardAt === -1 ? -1 : overlay.lastIndexOf('"keydown"', guardAt);
      const closeSource = extractFunction(overlay, "closeAdjustPanel") ?? "";
      harness.check("overlay: the inspector undo shortcut never fires for input targets and the stacks clear on close",
      guardAt !== -1 && undoAt > guardAt && keydownAt !== -1 && overlay.slice(keydownAt, undoAt).includes("adjustPanel !== null") &&
        closeSource.includes("adjustUndoStack = []") && closeSource.includes("adjustRedoStack = []"),
        JSON.stringify({ guardAt, undoAt, keydownAt, clears: closeSource.includes("adjustUndoStack = []") }));
    }
    {
      const resetSource = extractFunction(overlay, "adjustReset");
      const resetRun = resetSource === undefined
        ? undefined
        : evaluateExpression(`() => {
      let adjustTarget = null;
      let adjustTargetSelector = "";
      const adjustLedger = new Map();
      const adjustPatch = { computedBaselines: new Map([["color", "10px"]]) };
      const adjustValues = new Map([["color", "12px"]]);
      const adjustInvalid = new Set(["color"]);
      let adjustRedoStack = [{ kind: "prop", prop: "color", value: "12px" }];
      const restored = [];
      const restoreStyle = (patch, prop) => restored.push(prop);
      const previews = [];
      const previewStyle = () => {};
      const rerenderAdjustRows = () => {};
      ${extractFunction(overlay, "restoreAdjustBaseline")}
      ${resetSource}
      adjustReset("color");
      return { redo: adjustRedoStack.length, value: adjustValues.get("color"), invalid: adjustInvalid.size, restored };
    }`, "adjustReset")();
      harness.check("overlay: a manual property reset clears the redo tail and restores the baseline",
        resetRun !== undefined && resetRun.redo === 0 && resetRun.value === "10px" && resetRun.invalid === 0 &&
        JSON.stringify(resetRun.restored) === JSON.stringify(["color"]),
        JSON.stringify(resetRun));
    }
  }

  harness.section("client: overlay composer paste");
  {
    const draftSource = extractFunction(overlay, "renderDraft");
    const pasteAt = draftSource === undefined ? -1 : draftSource.indexOf('addEventListener("paste"');
    const handlerSpan = pasteAt === -1 ? "" : draftSource.slice(pasteAt, pasteAt + 900);
    harness.check("overlay: the composer paste handler attaches only image items",
      pasteAt !== -1 && handlerSpan.includes('type.startsWith("image/")') && handlerSpan.includes("getAsFile()") &&
      handlerSpan.includes("if (file === null) return;") && handlerSpan.indexOf("e.preventDefault()") > handlerSpan.indexOf('startsWith("image/")') &&
      handlerSpan.indexOf("decodePastedImage(") > handlerSpan.indexOf("e.preventDefault()"),
      JSON.stringify({ pasteAt, span: handlerSpan.length }));
    const acceptSource = extractFunction(overlay, "acceptPastedImage");
    const makeRun = acceptSource === undefined ? undefined : evaluateExpression(`(initialDraft) => {
      let draft = initialDraft;
      let pastedShot = null;
      const toasts = [];
      const toast = (text) => toasts.push(text);
      const pasteThumbNode = { src: "" };
      const pasteChipNode = { style: {} };
      ${acceptSource}
      return { accept: acceptPastedImage, state: () => ({ pastedShot, thumb: pasteThumbNode.src, chip: pasteChipNode.style.display, toasts }) };
    }`, "acceptPastedImage");
    {
      const run = makeRun === undefined ? undefined : makeRun({ label: "x" });
      const first = "data:image/jpeg;base64,AAAA";
      const second = "data:image/jpeg;base64,BBBB";
      const tooLarge = "data:image/jpeg;base64," + "A".repeat(4 * 1024 * 1024);
      const open = run === undefined ? undefined : run.accept(first);
      const replaced = run === undefined ? undefined : run.accept(second);
      const rejected = run === undefined ? undefined : run.accept(tooLarge);
      const closed = makeRun === undefined ? undefined : makeRun(null).accept(first);
      const state = run === undefined ? undefined : run.state();
      harness.check("overlay: the composer carries at most one pasted image and the latest paste replaces it",
        open === true && replaced === true && rejected === false && closed === false &&
        state !== undefined && state.pastedShot === second && state.thumb === second && state.chip === "" &&
        JSON.stringify(state.toasts) === JSON.stringify(["pasteTooLarge"]),
        JSON.stringify({ open, replaced, rejected, closed, state }));
    }
    {
      const pasteSpan = pasteAt === -1 ? "" : draftSource.slice(pasteAt, pasteAt + 1200);
      const decodeSource = extractFunction(overlay, "decodePastedImage");
      harness.check("overlay: a failed paste decode reports to the host diag and skips the attach",
        pasteAt !== -1 && pasteSpan.includes("catch (error)") && pasteSpan.includes("reportDiag(") &&
        pasteSpan.indexOf("if (dataUrl !== null) acceptPastedImage(") > pasteSpan.indexOf("catch (error)") &&
        decodeSource !== undefined && /finally\s*\{[^}]*\.close/.test(decodeSource),
        JSON.stringify({ span: pasteSpan.length, hasDecode: decodeSource !== undefined }));
    }
  }

  harness.section("client: overlay draft discard");
  {
    const discardSource = extractFunction(overlay, "discardDraft");
    const run = discardSource === undefined
      ? undefined
      : evaluateExpression(`(renderDraft) => {
      let draft = { label: "x" };
      let pastedShot = "data:image/jpeg;base64,AAAA";
      ${discardSource}
      discardDraft();
      return { draft, pastedShot };
    }`, "discardDraft")(() => {});
    const nullCount = [...overlay.matchAll(/draft = null/g)].length;
    harness.check("overlay: every draft discard clears the pasted shot",
      run !== undefined && run.pastedShot === null && run.draft === null &&
      nullCount === 2 && overlay.includes("let draft = null;"),
      JSON.stringify({ run, nullCount }));
  }

  harness.section("client: overlay locate reveal");
  {
    const busStart = overlay.indexOf('window.addEventListener("message"');
    const busLocateAt = busStart === -1 ? -1 : overlay.indexOf('if (data.type === "locate") revealSelector(data.selector);', busStart);
    const busSpan = busStart === -1 || busLocateAt === -1 ? "" : overlay.slice(busStart, busLocateAt);
    const guardEnd = busSpan.indexOf('data.source !== "dsh-redline"');
    harness.check("overlay: the page message bus dispatches locate to reveal the selector",
      busStart !== -1 && busLocateAt > busStart && guardEnd !== -1 &&
      !busSpan.slice(guardEnd).includes('addEventListener("message"'),
      JSON.stringify({ busStart, busLocateAt, guardEnd }));
    const revealSource = extractFunction(overlay, "revealSelector");
    const revealFn = revealSource === undefined ? undefined : evaluateExpression(`(locate, showHighlight, clearHighlight, setTimeout, clearTimeout, revealTimer) => {\n${revealSource}\nreturn revealSelector;\n}`, "revealSelector");
    {
      const scrolled = [];
      const highlighted = [];
      let cleared = 0;
      const scheduled = [];
      const target = { scrollIntoView: (options) => scrolled.push(options) };
      const reveal = revealFn === undefined ? undefined : revealFn((selector) => (selector === "#live" ? target : null), (t) => highlighted.push(t), () => { cleared += 1; }, (fn, ms) => { scheduled.push({ fn, ms }); return scheduled.length; }, () => {}, null);
      if (reveal !== undefined) reveal("#live");
      if (scheduled.length === 1) scheduled[0].fn();
      harness.check("overlay: revealSelector scrolls to and highlights a resolvable element, then auto-clears",
        reveal !== undefined && JSON.stringify(scrolled) === JSON.stringify([{ behavior: "smooth", block: "center" }]) &&
        highlighted.length === 1 && highlighted[0] === target && scheduled.length === 1 && scheduled[0]?.ms === 2000 && cleared === 1,
        JSON.stringify({ scrolled, highlighted: highlighted.length, scheduled: scheduled.length, cleared }));
    }
    {
      const noScroll = [];
      const noHighlight = [];
      const noTimer = [];
      const reveal = revealFn === undefined ? undefined : revealFn(() => null, (t) => noHighlight.push(t), () => {}, (fn, ms) => { noTimer.push({ fn, ms }); return noTimer.length; }, () => {}, null);
      if (reveal !== undefined) reveal("#gone");
      harness.check("overlay: revealSelector is a silent no-op for an unresolved selector",
        reveal !== undefined && noScroll.length === 0 && noHighlight.length === 0 && noTimer.length === 0,
        JSON.stringify({ noScroll: noScroll.length, noHighlight: noHighlight.length, noTimer: noTimer.length }));
    }
  }

  harness.section("client: overlay token suggestions");
  {
    const fakeEl = (tag, attrs = {}, ...children) => {
      const node = { tag, attrs, children: [], handlers: {}, append(child) { if (child !== null && child !== undefined) this.children.push(child); }, addEventListener(type, fn) { this.handlers[type] = fn; } };
      for (const [key, value] of Object.entries(attrs)) node[key === "class" ? "className" : key] = value;
      for (const child of children) node.append(child);
      return node;
    };
    harness.check("the overlay keeps its token helpers",
      extractFunction(overlay, "collectCustomProps") !== undefined && extractFunction(overlay, "matchTokensByValue") !== undefined && extractFunction(overlay, "tokenSuggestionsFor") !== undefined && extractFunction(overlay, "tokenChipRow") !== undefined);
    {
      const source = extractFunction(overlay, "collectCustomProps");
      const collect = source === undefined ? undefined : evaluateExpression(`(getComputedStyle, target) => {\n${source}\nreturn collectCustomProps(target);\n}`, "collectCustomProps");
      const fakeStyle = {
        length: 5,
        props: { "color": "red", "--brand": " #000000 ", "--bad~name": "x", "--": "y", "--spacing-md": "16px" },
        item(index) { return Object.keys(this.props)[index] ?? ""; },
        getPropertyValue(name) { return this.props[name] ?? ""; }
      };
      const props = collect === undefined ? undefined : collect(() => fakeStyle, {});
      harness.check("overlay: custom property collection only accepts valid token names from the target computed style",
        props !== undefined && JSON.stringify(props) === JSON.stringify([{ name: "--brand", value: " #000000 " }, { name: "--spacing-md", value: "16px" }]),
        JSON.stringify(props ?? "collector missing"));
    }
    {
      const match = evaluateExpression(extractFunction(overlay, "matchTokensByValue"), "matchTokensByValue");
      harness.check("overlay: token matching compares resolved values for exact equality",
        match !== undefined &&
        JSON.stringify(match([{ name: "--a", value: "16px" }], "16px")) === JSON.stringify(["--a"]) &&
        JSON.stringify(match([{ name: "--a", value: " 16px " }], " 16px ")) === JSON.stringify(["--a"]) &&
        JSON.stringify(match([{ name: "--a", value: "16px" }], "17px")) === JSON.stringify([]) &&
        JSON.stringify(match([{ name: "--a", value: "16px" }], "   ")) === JSON.stringify([]),
        JSON.stringify({ equal: match?.([{ name: "--a", value: "16px" }], "16px"), trimmed: match?.([{ name: "--a", value: " 16px " }], " 16px ") }));
    }
    {
      const sandbox = { el: fakeEl, t: (key) => key, tokenSuggestionsFor: () => [], makeTokenProbe: () => null };
      vm.createContext(sandbox);
      for (const name of ["tokenChipRowFromNames", "tokenChipRow"]) {
        const source = extractFunction(overlay, name);
        if (source !== undefined) vm.runInContext(source, sandbox, { filename: `${name}.js` });
      }
      const emptyRow = typeof sandbox.tokenChipRow === "function" ? sandbox.tokenChipRow({}, "16px", () => {}) : undefined;
      const match = evaluateExpression(extractFunction(overlay, "matchTokensByValue"), "matchTokensByValue");
      harness.check("overlay: token chips are absent when the page defines no matching custom properties",
        emptyRow === null && match !== undefined && JSON.stringify(match([{ name: "--a", value: "9px" }], "16px")) === JSON.stringify([]),
        JSON.stringify({ emptyRow, noMatch: match?.([{ name: "--a", value: "9px" }], "16px") }));
    }
    {
      const sandbox = {
        EDITABLE_PROPS: editableProps(overlay),
        adjustValues: new Map([["color", "#000000"]]),
        adjustInvalid: new Set(),
        adjustPatch: { element: { style: { setProperty() {}, getPropertyValue: () => "", getPropertyPriority: () => "" } }, originalStyles: new Map(), computedBaselines: new Map([["color", "#000000"]]), originalText: null },
        adjustTarget: null,
        adjustLedger: new Map(),
        adjustTargetSelector: "",
        adjustUndoStack: [],
        adjustRedoStack: [],
        rerenderAdjustRows: () => {},
        tokenSuggestionsFor: () => ["--brand-color"],
        makeTokenProbe: () => null,
        t: (key) => key,
        el: fakeEl
      };
      vm.createContext(sandbox);
      for (const name of ["isSafeValue", "previewStyle", "adjustBaseline", "adjustUpdateProperty", "adjustCurrentChanges", "tokenChipRowFromNames", "tokenChipRow"]) {
        const source = extractFunction(overlay, name);
        if (source !== undefined) vm.runInContext(source, sandbox, { filename: `${name}.js` });
      }
      const applied = [];
      const row = typeof sandbox.tokenChipRow === "function" ? sandbox.tokenChipRow({}, "#000000", (name) => { applied.push(name); sandbox.adjustUpdateProperty("color", `var(${name})`); }) : undefined;
      const chip = row?.children?.[1];
      if (chip?.handlers?.click !== undefined) chip.handlers.click();
      const committed = typeof sandbox.adjustCurrentChanges === "function" ? sandbox.adjustCurrentChanges() : undefined;
      const propertyRowSource = extractFunction(overlay, "propertyRow");
      harness.check("overlay: choosing a token chip records var(--name) as the after value",
        row !== undefined && chip !== undefined && chip.textContent === "--brand-color" &&
        JSON.stringify(applied) === JSON.stringify(["--brand-color"]) &&
        JSON.stringify(committed) === JSON.stringify([{ prop: "color", before: "#000000", after: "var(--brand-color)" }]) &&
        propertyRowSource !== undefined && propertyRowSource.includes("adjustUpdateProperty(prop, `var(${tokenName})`)"),
        JSON.stringify({ applied, committed, chipText: chip?.textContent }));
    }
    {
      const chipRowSource = extractFunction(overlay, "tokenChipRowFromNames");
      harness.check("overlay: token suggestion labels are rendered via textContent",
        chipRowSource !== undefined && chipRowSource.includes("textContent") && !chipRowSource.includes("html:"),
        chipRowSource === undefined ? "chip row missing" : "chip labels must not use the html attribute");
    }
  }

  harness.section("client: overlay accessibility audit");
  {
    const sandbox = {
      getComputedStyle: (node) => node.computed ?? { color: "", backgroundColor: "" },
      document: { getElementById: () => null }
    };
    vm.createContext(sandbox);
    const semanticMatch = /const A11Y_SEMANTIC_TAGS = (new Set\(\[[^\]]*\]\))/.exec(overlay);
    sandbox.A11Y_SEMANTIC_TAGS = semanticMatch === null ? new Set() : evaluateExpression(semanticMatch[1], "A11Y_SEMANTIC_TAGS");
    for (const name of ["parseColor", "relativeLuminance", "contrastRatio", "resolveReadableBackground", "accessibleName", "auditElement"]) {
      const source = extractFunction(overlay, name);
      if (source !== undefined) vm.runInContext(source, sandbox, { filename: `${name}.js` });
    }
    const fakeEl = (options = {}) => ({
      tagName: options.tagName ?? "DIV",
      textContent: options.text ?? "",
      computed: options.computed ?? { color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)" },
      parentElement: options.parent ?? null,
      getAttribute(name) {
        const attrs = options.attrs ?? {};
        return name in attrs ? attrs[name] : null;
      },
      getBoundingClientRect: () => options.rect ?? { width: 100, height: 30 },
      ownerDocument: { getElementById: (id) => options.byId?.[id] ?? null }
    });
    const { contrastRatio, resolveReadableBackground, accessibleName, auditElement } = sandbox;
    harness.check("the overlay keeps its accessibility helpers",
      typeof contrastRatio === "function" && typeof resolveReadableBackground === "function" && typeof accessibleName === "function" && typeof auditElement === "function");
    {
      const blackOnWhite = contrastRatio("#000000", "#ffffff");
      const grayOnWhite = contrastRatio("#777777", "#ffffff");
      harness.check("overlay: contrast ratio matches the WCAG relative luminance formula",
        blackOnWhite !== null && Math.abs(blackOnWhite - 21) < 0.01 &&
        grayOnWhite !== null && Math.abs(grayOnWhite - 4.48) < 0.05,
        JSON.stringify({ blackOnWhite, grayOnWhite }));
    }
    {
      const gradient = fakeEl({ computed: { color: "rgb(0, 0, 0)", backgroundColor: "linear-gradient(90deg, #fff, #000)" } });
      const transparentChain = fakeEl({ computed: { color: "rgb(0, 0, 0)", backgroundColor: "rgba(0, 0, 0, 0)" }, parent: fakeEl({ computed: { color: "rgb(0, 0, 0)", backgroundColor: "transparent" } }) });
      const gradientRow = auditElement(gradient).find((row) => row.check === "contrast");
      const transparentRow = auditElement(transparentChain).find((row) => row.check === "contrast");
      harness.check("overlay: contrast reports unknown for gradient and transparent-only backgrounds",
        resolveReadableBackground(gradient) === "unknown" && resolveReadableBackground(transparentChain) === "unknown" &&
        contrastRatio("rgb(0, 0, 0)", "unknown") === null &&
        gradientRow?.status === "unknown" && transparentRow?.status === "unknown",
        JSON.stringify({ gradient: resolveReadableBackground(gradient), transparent: resolveReadableBackground(transparentChain), gradientRow, transparentRow }));
    }
    {
      const labelled = fakeEl({ attrs: { "aria-label": "Save changes", alt: "disk", "aria-labelledby": "title" }, text: "text", byId: { title: { textContent: "Title" } } });
      const altOnly = fakeEl({ tagName: "IMG", attrs: { alt: "team photo" }, text: "ignored" });
      const labelledByOnly = fakeEl({ attrs: { "aria-labelledby": "title" }, byId: { title: { textContent: "Title" } } });
      const textOnly = fakeEl({ text: "  Click me  " });
      const titleOnly = fakeEl({ attrs: { title: "Tooltip" } });
      harness.check("overlay: accessible name prefers aria-label, then alt, then text content",
        accessibleName(labelled) === "Save changes" && accessibleName(altOnly) === "team photo" &&
        accessibleName(labelledByOnly) === "Title" && accessibleName(textOnly) === "Click me" &&
        accessibleName(titleOnly) === "Tooltip" && accessibleName(fakeEl()) === "",
        JSON.stringify({ labelled: accessibleName(labelled), altOnly: accessibleName(altOnly), labelledBy: accessibleName(labelledByOnly), text: accessibleName(textOnly) }));
    }
    {
      const bareImg = fakeEl({ tagName: "IMG" });
      const decorativeImg = fakeEl({ tagName: "IMG", attrs: { alt: "" } });
      const plainDiv = fakeEl();
      const altStatus = (el) => auditElement(el).find((row) => row.check === "imgAlt")?.status;
      harness.check("overlay: an img without an alt attribute fails the alt check",
        altStatus(bareImg) === "fail" && altStatus(decorativeImg) === "pass" && altStatus(plainDiv) === "n/a",
        JSON.stringify({ bareImg: altStatus(bareImg), decorative: altStatus(decorativeImg), div: altStatus(plainDiv) }));
    }
    {
      const small = auditElement(fakeEl({ rect: { width: 23, height: 40 } })).find((row) => row.check === "targetSize");
      const narrow = auditElement(fakeEl({ rect: { width: 40, height: 23 } })).find((row) => row.check === "targetSize");
      const exact = auditElement(fakeEl({ rect: { width: 24, height: 24 } })).find((row) => row.check === "targetSize");
      harness.check("overlay: target size fails below 24 by 24 pixels",
        small?.status === "fail" && narrow?.status === "fail" && exact?.status === "pass",
        JSON.stringify({ small, narrow, exact }));
    }
    {
      const imgRows = auditElement(fakeEl({ tagName: "IMG", attrs: { alt: "x" } }));
      const divRows = auditElement(fakeEl({ attrs: { role: "button" } }));
      const renderer = extractFunction(overlay, "renderPinPanel");
      harness.check("overlay: the popover audit renders exactly five rows",
        imgRows.length === 5 && divRows.length === 5 &&
        JSON.stringify(imgRows.map((row) => row.check)) === JSON.stringify(["contrast", "name", "imgAlt", "role", "targetSize"]) &&
        renderer !== undefined && renderer.includes("a11yAuditSection(auditTarget)"),
        JSON.stringify({ imgRows: imgRows.map((row) => row.check), divRows: divRows.map((row) => row.check), wired: renderer?.includes("a11yAuditSection") }));
    }
  }

  harness.section("client: overlay group mode");
  {
    const finalizeSource = extractFunction(overlay, "finalizeGroup");
    const pickSource = extractFunction(overlay, "groupPick");
    harness.check("the overlay keeps its group mode helpers",
      finalizeSource !== undefined && pickSource !== undefined && extractFunction(overlay, "setGroupMode") !== undefined && overlay.includes("groupBtn"));
    {
      const sandbox = {
        pins: [],
        groupPicks: [
          { target: { localName: "h1", getAttribute: () => null, textContent: "Title one" }, selector: "h1:first-of-type", rect: { x: 1, y: 2, w: 30, h: 20 }, offsets: { ox: 15, oy: 10 }, shot: "shot-a" },
          { target: { localName: "p", getAttribute: () => "paragraph", textContent: "Body" }, selector: "p.hero", rect: { x: 3, y: 4, w: 40, h: 50 }, offsets: { ox: 20, oy: 25 }, shot: "shot-b" },
          { target: { localName: "li", getAttribute: () => null, textContent: "Item" }, selector: "ul > li", rect: { x: 5, y: 6, w: 20, h: 20 }, offsets: { ox: 10, oy: 10 }, shot: "shot-c" }
        ],
        groupComposerNode: { querySelector: () => ({ value: "One comment for all three" }) },
        viewportPresetWidth: null,
        crypto: { randomUUID: () => "uuid" },
        savePins: () => {},
        setGroupMode: () => {},
        renderPins: () => {},
        toast: () => {},
        t: (key) => key,
        reactComponentName: () => null,
        PAGE_URL: "http://page/",
        postSnapshotCalls: []
      };
      sandbox.postSnapshot = () => sandbox.postSnapshotCalls.push(1);
      vm.createContext(sandbox);
      vm.runInContext(finalizeSource ?? "", sandbox, { filename: "finalizeGroup.js" });
      const created = sandbox.finalizeGroup();
      harness.check("overlay: finalizing a group posts the snapshot to the host",
        sandbox.postSnapshotCalls.length === 1,
        JSON.stringify({ posts: sandbox.postSnapshotCalls.length }));
      const ids = created.map((pin) => pin.groupId);
      const comments = created.map((pin) => pin.comment);
      harness.check("overlay: group mode assigns the same groupId to every member pin",
        Array.isArray(created) && created.length === 3 && ids.every((id) => typeof id === "string" && id !== "") &&
        ids.every((id) => id === ids[0]),
        JSON.stringify({ count: created.length, ids, comments }));
      harness.check("overlay: the group comment is copied to every member",
        comments.length === 3 && comments.every((text) => text === "One comment for all three"),
        JSON.stringify(comments));
      harness.check("overlay: each group member captures its own crop",
        created.every((pin) => typeof pin.shot === "string" && pin.shot !== "") &&
        new Set(created.map((pin) => pin.shot)).size === 3 &&
        JSON.stringify(created.map((pin) => pin.rect)) === JSON.stringify([{ x: 1, y: 2, w: 30, h: 20 }, { x: 3, y: 4, w: 40, h: 50 }, { x: 5, y: 6, w: 20, h: 20 }]),
        JSON.stringify(created.map((pin) => ({ shot: pin.shot, rect: pin.rect }))));
    }
    {
      const pick = pickSource === undefined ? undefined : evaluateExpression(`(Element, modeBox, target, groupPicks, captureCropFor, screenshotOnSend, cssPath, groupPickMarker) => {\nlet CROP_PAD = 72;\nconst groupCaptureCache = null;\nconst readGroupMode = () => modeBox.value;\n${pickSource.replace(/groupMode/g, "readGroupMode()")}\nreturn groupPick(target);\n}`, "groupPick");
      if (pick !== undefined) {
        const ElementClass = class Element {};
        const makeElement = (tagName) => {
          const instance = new ElementClass();
          instance.tagName = tagName;
          instance.localName = tagName.toLowerCase();
          instance.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 });
          return instance;
        };
        const marker = () => ({});
        const canvasTarget = makeElement("CANVAS");
        const picks = [];
        const onMode = { value: true };
        const offMode = { value: false };
        const capture = async () => "unused";
        const rejectsCanvas = await pick(ElementClass, onMode, canvasTarget, picks, capture, true, () => "canvas:drawing", marker);
        const notInMode = await pick(ElementClass, offMode, makeElement("P"), picks, capture, true, () => "p", marker);
        const toggledOff = await pick(ElementClass, onMode, makeElement("P"), picks, async () => { onMode.value = false; return "shot"; }, true, () => "p", marker);
        harness.check("overlay: group picking ignores canvas draw pins",
          rejectsCanvas === undefined && picks.length === 0 && notInMode === undefined && toggledOff === undefined && picks.length === 0,
          JSON.stringify({ picks: picks.length, results: [rejectsCanvas, notInMode, toggledOff] }));
      } else {
        harness.check("overlay: group picking ignores canvas draw pins", false, "groupPick missing");
      }
    }
    {
      const exits = extractFunction(overlay, "setGroupMode") ?? "";
      const creates = exits.includes("groupPicks = []") || exits.includes("clearGroupPicks()");
      harness.check("overlay: leaving group mode with no picks creates no pins",
        creates && exits.includes("clearHighlight()"),
        exits.slice(0, 120));
    }
  }

  harness.section("client: overlay viewport presets");
  {
    const applySource = extractFunction(overlay, "applyViewportPreset");
    harness.check("the overlay keeps its viewport preset helpers",
      applySource !== undefined && overlay.includes("viewportBtn") && overlay.includes("lr-viewport-btn") &&
      overlay.includes("VIEWPORT_PRESETS") && overlay.includes("VIEWPORT_ZOOMS"));
    {
      const runs = [];
      const run = applySource === undefined ? undefined : evaluateExpression(`(document, widthOrNull, repositionPins, repositionDraft, draft, adjustPanel) => {\nlet viewportPresetWidth = null;\n${applySource}\napplyViewportPreset(widthOrNull);\nreturn viewportPresetWidth;\n}`, "applyViewportPreset");
      const makeDocument = () => {
        const style = { maxWidth: "", marginLeft: "", marginRight: "", setProperty(name, value) { this[name] = value; }, removeProperty(name) { this[name] = ""; } };
        return { documentElement: { style }, writes: style };
      };
      const doc1 = makeDocument();
      const width = run === undefined ? undefined : run(doc1, 375, () => runs.push("reposition"), () => {}, null, null);
      const applied = doc1.writes;
      const doc3 = makeDocument();
      doc3.writes.setProperty("max-width", "768px");
      doc3.writes.setProperty("margin-left", "auto");
      const reset = run(doc3, null, () => runs.push("reposition"), () => {}, null, null);
      const doc4 = makeDocument();
      let draftCalls = 0;
      run(doc4, 768, () => runs.push("reposition"), () => { draftCalls += 1; }, { anchor: true }, null);      harness.check("overlay: the preset picker constrains documentElement with maxWidth and centers it",
        width === 375 && applied["max-width"] === "375px" && applied["margin-left"] === "auto" && applied["margin-right"] === "auto",
        JSON.stringify({ width, applied: { maxWidth: applied["max-width"], marginLeft: applied["margin-left"], marginRight: applied["margin-right"] } }));
      harness.check("overlay: reset clears the width constraint",
        reset === null && doc3.writes["max-width"] === "" && doc3.writes["margin-left"] === "" && doc3.writes["margin-right"] === "",
        JSON.stringify({ reset, after: { maxWidth: doc3.writes["max-width"], marginLeft: doc3.writes["margin-left"] } }));
      harness.check("overlay: applying a preset repositions pins manually",
        runs.length === 3 && runs.every((name) => name === "reposition"),
        JSON.stringify(runs));
      harness.check("overlay: applying a preset repositions the open draft", draftCalls === 1, `draft reposition calls: ${draftCalls}`);
    }
    {
      const snapshotSource = extractFunction(overlay, "postSnapshot");
      const pickerLine = overlay.split("\n").find((line) => line.includes("pins.push(pin)") || (line.includes("viewportWidth = viewportPresetWidth") && line.includes("pin.viewportWidth")));
      const submit = extractFunction(overlay, "submitDraft");
      const whitelist = snapshotSource !== undefined && snapshotSource.includes("viewportWidth: p.viewportWidth ?? null");
      const tagged = submit !== undefined && submit.includes("viewportPresetWidth !== null");
      harness.check("overlay: pins created under an active preset record the preset width, not innerWidth",
        whitelist && tagged && !overlay.includes("viewportWidth: window.innerWidth") && pickerLine !== undefined,
        JSON.stringify({ whitelist, tagged, line: pickerLine?.trim().slice(0, 80) }));
    }
  }

  harness.section("client: overlay hotkeys");
  {
    const parseHotkey = evaluateExpression(extractFunction(overlay, "parseHotkey"), "parseHotkey");
    const hotkeyMatches = evaluateExpression(extractFunction(overlay, "hotkeyMatches"), "hotkeyMatches");
    const formatHotkey = evaluateExpression(extractFunction(overlay, "formatHotkey"), "formatHotkey");
    harness.check("the overlay keeps its hotkey helpers", parseHotkey !== undefined && hotkeyMatches !== undefined && formatHotkey !== undefined);
    // Every check below runs whatever the helpers answered, so a helper that is gone or broken
    // fails here instead of taking the whole section with it.
    const parse = (text) => (parseHotkey === undefined ? undefined : parseHotkey(text));
    const matches = (event, hotkey) => (hotkeyMatches === undefined ? false : hotkeyMatches(event, hotkey));
    const show = (hotkey) => (formatHotkey === undefined ? "" : formatHotkey(hotkey));
    {
      const single = parse("c");
      harness.check("a single key parses to the key alone", single !== undefined && single.key === "c" && single.modifiers.length === 0, JSON.stringify(single));
      const composite = parse("Ctrl+Shift+a");
      harness.check("a composite parses to the key and its modifiers", composite !== undefined && composite.key === "a" && JSON.stringify(composite.modifiers) === JSON.stringify(["ctrl", "shift"]), JSON.stringify(composite));
      const unordered = parse("shift+ctrl+a");
      harness.check("the order the modifiers arrive in does not matter", unordered !== undefined && JSON.stringify(unordered.modifiers) === JSON.stringify(["ctrl", "shift"]), JSON.stringify(unordered));
      const altMeta = parse("Alt+Meta+d");
      harness.check("every modifier is parsed", altMeta !== undefined && JSON.stringify(altMeta.modifiers) === JSON.stringify(["alt", "meta"]), JSON.stringify(altMeta));
      const broken = ["Ctrl+", "+", "Ctrl+shift", "Ctrl+Ctrl+a", "ab", "Hyper+a", ""].every((text) => parse(text) === undefined);
      harness.check("a text that is not a hotkey names nothing", broken, JSON.stringify(["Ctrl+", "+", "Ctrl+shift", "Ctrl+Ctrl+a", "ab", "Hyper+a", ""].map((text) => parse(text))));

      const plain = parse("c");
      harness.check("the key alone fires", matches({ key: "c" }, plain) === true);
      harness.check("the key fires whatever the case", matches({ key: "C" }, plain) === true);
      harness.check("a modified key does not fire the plain hotkey", matches({ key: "c", ctrlKey: true }, plain) === false);
      harness.check("a shifted key does not fire the plain hotkey", matches({ key: "c", shiftKey: true }, plain) === false);

      // A shortcut names the key the user reads: with a modifier held, the character the layout
      // produces is not that key.
      const shiftOne = parse("Shift+1");
      harness.check("a shortcut with a digit fires on the digit the layout shifted", matches({ key: "!", code: "Digit1", shiftKey: true }, shiftOne) === true, JSON.stringify(shiftOne));
      const altA = parse("Alt+a");
      harness.check("a shortcut with a letter fires on the letter the layout changed", matches({ key: "å", code: "KeyA", altKey: true }, altA) === true, JSON.stringify(altA));
      harness.check("the physical key alone does not fire a shortcut", matches({ key: "a", code: "KeyA" }, altA) === false);
      const combo = parse("Ctrl+Shift+a");
      harness.check("the composite fires with exactly its modifiers", matches({ key: "a", ctrlKey: true, shiftKey: true }, combo) === true);
      harness.check("the composite does not fire without them", matches({ key: "a", ctrlKey: true }, combo) === false);
      harness.check("the composite does not fire with one more modifier", matches({ key: "a", ctrlKey: true, shiftKey: true, altKey: true }, combo) === false);
      harness.check("the meta composite fires with meta", matches({ key: "a", metaKey: true, shiftKey: true }, parse("Meta+Shift+a")) === true);
      harness.check("an unknown hotkey never fires", matches({ key: "a" }, undefined) === false);

      harness.eq("a single key is shown uppercased", show(parse("c")), "C");
      harness.eq("a composite is shown with the modifiers in their spelling", show(parse("Ctrl+Shift+a")), "Ctrl+Shift+A");
      harness.eq("every modifier is shown", show(parse("Alt+Meta+d")), "Alt+Meta+D");

      // The client and the overlay read the same stored strings: their parsers and their
      // formatters must agree, or the settings panel would show a shortcut the overlay
      // would not fire. Both sides are the real code, not a copy of it.
      const clientSource = readFileSync(path.join(pluginDir, "lib", "client.js"), "utf8");
      const clientFormatSource = extractArrowConst(clientSource, "formatHotkeyText");
      const clientLabels = /const HOTKEY_MODIFIER_LABELS = (\{[^}]*\});/.exec(clientSource)?.[1] ?? "";
      harness.check("the client keeps its hotkey formatter", typeof clientFormatSource === "string");
      if (typeof clientFormatSource === "string" && clientLabels !== "") {
        const clientFormat = evaluateExpression(`(text, fallback) => {
          const HOTKEY_MODIFIER_LABELS = ${clientLabels};
          const formatHotkey = ${clientFormatSource.replace(/^const formatHotkeyText = /, "")};
          return formatHotkey(text, fallback);
        }`, "clientFormatHotkey");
        const shared = ["c", "5", "Ctrl+Shift+a", "Alt+Meta+d", "ctrl+shift+a", "Ctrl+a"];
        harness.check("the client and the overlay show the same shortcut",
          typeof clientFormat === "function" && shared.every((text) => clientFormat(text, "?") === show(parse(text))),
          JSON.stringify(shared.map((text) => [text, typeof clientFormat === "function" ? clientFormat(text, "?") : null, show(parse(text))])));
      }
    }
  }

  harness.section("client: the overlay wires its hotkeys to the key handler");
  {
    // The matcher on its own is not the behaviour: what matters is that the overlay's key
    // handler calls it, so that Ctrl+C does not enter comment mode and Ctrl+Shift+A does.
    const overlaySource = readFileSync(path.join(pluginDir, "lib", "overlay.js"), "utf8");
    // The page can rewrite window.__LR__ before the overlay runs, so the host it names is not
    // trusted: the overlay only talks to the origin it was served from.
    const apiBase = /const API_BASE = \(\(\) => \{([\s\S]*?)\}\)\(\);/.exec(overlaySource)?.[1] ?? "";
    harness.check("the overlay does not take the host the page names", apiBase.includes("if (scriptOrigin !== null) return scriptOrigin;"), apiBase.slice(0, 160));
    const handler = /if \(hotkeyMatches\(event, hotkeyComment\)\)[\s\S]*?else if \(hotkeyMatches\(event, hotkeyHidePins\)\)[^\n]*/.exec(overlaySource)?.[0] ?? "";
    harness.check("the overlay's key handler asks the matcher", handler.includes("hotkeyMatches(event, hotkeyComment)") && handler.includes("hotkeyMatches(event, hotkeyAdjust)") && handler.includes("hotkeyMatches(event, hotkeyDraw)"), handler.slice(0, 120));
    // One key arms one mode: the mode checks are chained, not independent.
    const chained = handler.match(/hotkeyMatches\(event, hotkey(Comment|Adjust|Draw|HidePins)\)/g) ?? [];
    harness.eq("the mode hotkeys are checked in a chain", chained.length, 4);
    harness.check("one key arms one mode", (handler.match(/\belse if\b/g) ?? []).length === 3, handler.slice(0, 120));
    harness.check("overlay: the keydown chain arms the hide-pins toggle", handler.includes("hotkeyMatches(event, hotkeyHidePins)") && handler.includes("setHidden(!hidden)"), handler.slice(-160));
    harness.check("the handler does not compare the key on its own", !/event\.key === key(Comment|Adjust|Draw)/.test(overlaySource), "a raw event.key comparison would ignore the modifiers");

    // The toolbar shows the key that is configured: the kbd of each button carries it.
    const kbdOf = (tool) => {
      const line = overlaySource.split("\n").find((text) => text.includes(`${tool} = el("button"`)) ?? "";
      return /el\("kbd", \{\}, (.+)\)\);/.exec(line)?.[1] ?? "";
    };
    harness.check("the comment button shows its key", kbdOf("commentBtn").includes("formatHotkey(hotkeyComment)"), kbdOf("commentBtn"));
    harness.check("the adjust button shows its key", kbdOf("adjustBtn").includes("formatHotkey(hotkeyAdjust)"), kbdOf("adjustBtn"));
    harness.check("the canvas button shows its key", kbdOf("drawBtn").includes("formatHotkey(hotkeyDraw)"), kbdOf("drawBtn"));

    // The keys the host answers with reach the overlay: applySettings applies all three.
    const applySettings = /function applySettings\(next\) \{[\s\S]*?\n  \}/.exec(overlaySource)?.[0] ?? "";
    harness.check("applySettings applies the comment key", applySettings.includes("hotkeyComment = comment"), applySettings.slice(0, 200));
    harness.check("applySettings applies the adjust key", applySettings.includes("hotkeyAdjust = adjust"), applySettings.slice(0, 200));
    harness.check("applySettings applies the canvas key", applySettings.includes("hotkeyDraw = draw"), applySettings.slice(0, 200));
    harness.check("applySettings applies the hide-pins key", applySettings.includes("hotkeyHidePins = hidePins"), applySettings.slice(0, 200));
  }

  harness.section("client: the shortcut capture");
  {
    const posted = [];
    const listeners = [];
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      window: {
        addEventListener: (type, handler) => { if (type === "keydown") listeners.push(handler); },
        removeEventListener: (type, handler) => { const at = listeners.indexOf(handler); if (at >= 0) listeners.splice(at, 1); }
      },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          posted.push(JSON.parse(options.body));
          return jsonResponse({ ok: true, settings: { ...posted.at(-1), keys: { ...posted.at(-1).keys, comment: "Ctrl+Shift+a" } } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const before = renderOnce(stub, section.component, {});
    const inputs = findElements(before.tree, (element) => typeof element.props?.["aria-label"] === "string" && element.props["aria-label"].startsWith("Comment mode key"));
    harness.eq("the comment key input is there", inputs.length, 1);
    const drawInput = findElements(before.tree, (element) => element.props?.["aria-label"] === "Draw mode key");
    harness.eq("the draw key input is there", drawInput.length, 1);
    if (inputs.length === 1) {
      inputs[0].props.onClick();
      await flush(2);
      harness.eq("the capture listens for the key", listeners.length, 1);
      // A bare modifier is not a key: the capture keeps listening and shows what is held.
      if (listeners.length === 1) listeners[0]({ key: "Control", ctrlKey: true, preventDefault() {} });
      await flush(2);
      harness.eq("a bare modifier press keeps the capture armed", listeners.length, 1);
      // The key with its modifiers is the hotkey.
      if (listeners.length === 1) listeners[0]({ key: "A", ctrlKey: true, shiftKey: true, preventDefault() {} });
      await flush(4);
      harness.eq("the capture sends the hotkey", posted.at(-1)?.keys?.comment, "Ctrl+Shift+a");
      harness.eq("the capture stopped listening", listeners.length, 0);
    }

    // Clicking another field replaces the capture: the previous listener goes away and the key
    // lands on the field that was clicked.
    const fields = findElements(renderOnce(stub, section.component, {}).tree, (element) => element.props?.["aria-label"] === "Comment mode key");
    const otherField = findElements(renderOnce(stub, section.component, {}).tree, (element) => element.props?.["aria-label"] === "Adjust mode key");
    if (fields.length === 1 && otherField.length === 1) {
      // The comment key holds whatever the earlier step captured: the point is that the new key
      // lands on the field that was clicked and leaves the other one alone.
      const commentBefore = posted.at(-1)?.keys?.comment;
      fields[0].props.onClick();
      await flush(2);
      harness.eq("the capture listens for the key", listeners.length, 1);
      otherField[0].props.onClick();
      await flush(2);
      harness.eq("clicking another field replaces the capture", listeners.length, 1);
      const before = posted.length;
      listeners[0]({ key: "z", preventDefault() {} });
      await flush(4);
      harness.eq("the key lands on the field that was clicked", posted.at(-1)?.keys?.adjust, "z");
      harness.eq("the other field keeps its key", posted.at(-1)?.keys?.comment, commentBefore);
      harness.check("the capture changed something", posted.length > before, JSON.stringify(posted.at(-1)?.keys));
    }

    // A setting changed while the capture was armed must survive it: the save sends what the
    // panel shows now, not what the render that armed the capture knew about.
    const armed = findElements(renderOnce(stub, section.component, {}).tree, (element) => element.props?.["aria-label"] === "Draw mode key");
    if (armed.length === 1) {
      armed[0].props.onClick();
      await flush(2);
      const toggle = findElements(renderOnce(stub, section.component, {}).tree, (element) => element.props?.["aria-label"] === "Screenshot");
      harness.eq("the screenshot toggle is there", toggle.length, 1);
      if (toggle.length === 1) {
        const wasOn = posted.at(-1)?.screenshot;
        toggle[0].props.onChange({ target: { checked: !wasOn } });
        await flush(4);
        const changed = posted.at(-1)?.screenshot;
        harness.check("the toggle changed the setting", changed !== wasOn, `was=${wasOn} now=${changed}`);
        const before = posted.length;
        if (listeners.length === 1) listeners[0]({ key: "q", preventDefault() {} });
        await flush(4);
        harness.eq("the capture kept the change made while it was armed", posted.at(-1)?.screenshot, changed);
        harness.check("the capture still sent the key", posted.length > before, JSON.stringify(posted.at(-1)?.keys));
      }
    }

    // The capture listens on the window: it must not outlive the panel that owns it.
    const unmounted = renderOnce(stub, section.component, {});
    const drawField = findElements(unmounted.tree, (element) => element.props?.["aria-label"] === "Draw mode key");
    if (drawField.length === 1) {
      drawField[0].props.onClick();
      await flush(2);
      harness.eq("the capture listens for the key", listeners.length, 1);
      runCleanups(unmounted.effects);
      harness.eq("unmounting the panel removes the capture", listeners.length, 0);
      const before = posted.length;
      if (listeners.length === 1) listeners[0]({ key: "x", preventDefault() {} });
      await flush(4);
      harness.check("a stray key after the unmount changes nothing", posted.length === before, JSON.stringify(posted.at(-1)?.keys));
    }

    // The capture can be cancelled: a second click on the field, or Escape, leaves the key alone.
    const cancellable = findElements(renderOnce(stub, section.component, {}).tree, (element) => element.props?.["aria-label"] === "Adjust mode key");
    harness.eq("the adjust key input is there", cancellable.length, 1);
    if (cancellable.length === 1) {
      cancellable[0].props.onClick();
      await flush(2);
      harness.eq("the capture listens for the key", listeners.length, 1);
      cancellable[0].props.onClick();
      await flush(2);
      harness.eq("a second click cancels the capture", listeners.length, 0);
      const afterCancel = posted.length;
      cancellable[0].props.onClick();
      await flush(2);
      const beforeEscape = posted.length;
      let escapePrevented = false;
      if (listeners.length === 1) listeners[0]({ key: "Escape", preventDefault() { escapePrevented = true; } });
      await flush(2);
      harness.eq("escape cancels the capture", listeners.length, 0);
      harness.check("escape is not swallowed", escapePrevented === false, `preventDefault=${escapePrevented}`);
      harness.eq("a cancelled capture changes nothing", posted.length, beforeEscape);
      // The key after the escape is not captured: the capture is really over.
      const afterEscape = posted.length;
      const keysBefore = { ...(posted.at(-1)?.keys ?? {}) };
      if (listeners.length === 1) listeners[0]({ key: "z", preventDefault() {} });
      await flush(4);
      harness.check("the key after the escape is not captured", posted.length === afterEscape, JSON.stringify(posted.at(-1)?.keys));
      harness.eq("the keys are the ones the host kept", posted.at(-1)?.keys, keysBefore);
    }
  }

  harness.section("client: the panel takes the settings the host answered with");
  {
    const posted = [];
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    // The host answers with settings that differ from the ones the panel sent: the panel must
    // show what the host kept, not what it asked for.
    const hostSettings = { lang: "auto", keys: { comment: "c", adjust: "v", draw: "q" }, screenshot: false, cropPad: 40 };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      window: { addEventListener() {}, removeEventListener() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          posted.push(JSON.parse(options.body));
          return jsonResponse({ ok: true, settings: hostSettings });
        }
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: hostSettings, version: "1.0.24" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const before = renderOnce(stub, section.component, {});
    const toggle = findElements(before.tree, (element) => element.props?.["aria-label"] === "Screenshot");
    harness.eq("the screenshot toggle is there", toggle.length, 1);
    if (toggle.length === 1) {
      toggle[0].props.onChange({ target: { checked: true } });
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      const settings = after.states?.[0]?.settings;
      harness.eq("the panel took the settings the host answered with", settings?.keys, hostSettings.keys);
      harness.eq("the panel took the screenshot flag too", settings?.screenshot, hostSettings.screenshot);
      harness.eq("the panel took the crop padding too", settings?.cropPad, hostSettings.cropPad);
      const draw = findElements(after.tree, (element) => element.props?.["aria-label"] === "Draw mode key");
      harness.eq("the row shows the key the host kept", draw[0]?.props?.value, "Q");
    }
  }

  harness.section("client: the shortcut save takes the host's answer");
  {
    const listeners = [];
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      window: {
        addEventListener: (type, handler) => { if (type === "keydown") listeners.push(handler); },
        removeEventListener: (type, handler) => { const at = listeners.indexOf(handler); if (at >= 0) listeners.splice(at, 1); }
      },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          // The host refuses the duplicate and answers with the settings it kept.
          return new Response(JSON.stringify({ ok: false, error: "duplicate-key", keys: ["comment", "adjust"] }), { status: 400, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const before = renderOnce(stub, section.component, {});
    const inputs = findElements(before.tree, (element) => element.props?.["aria-label"] === "Comment mode key");
    harness.eq("the comment key input is there", inputs.length, 1);
    if (inputs.length === 1) {
      inputs[0].props.onClick();
      await flush(2);
      listeners[0]({ key: "v", preventDefault() {} });
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      // The state, not the tree: the tree was rendered before the answer came back.
      const settings = after.states?.[0]?.settings;
      harness.eq("the row keeps the key the host kept", settings?.keys?.comment, "c");
      const value = findElements(after.tree, (element) => element.props?.["aria-label"] === "Comment mode key");
      harness.eq("the row shows the key the host kept", value[0]?.props?.value, "C");
      const refused = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("already used"));
      harness.check("the row says the shortcut was refused", refused.length > 0, JSON.stringify(after.tree).slice(0, 160));
      harness.eq("the state carries the refusal", after.states?.[0]?.keyError, "duplicate-key");
    }
  }

  harness.section("client: an older answer does not overwrite a newer change");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    // The host answers the first save slowly and the second quickly: the first answer is older
    // and must not win.
    const pending = [];
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      window: { addEventListener() {}, removeEventListener() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          const body = JSON.parse(options.body);
          if (body.screenshot === false) {
            // The slow answer: it comes back with a value the user has already changed since.
            return new Promise((resolve) => { pending.push(() => resolve(jsonResponse({ ok: true, settings: { ...body, screenshot: false } }))); });
          }
          return jsonResponse({ ok: true, settings: body });
        }
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const before = renderOnce(stub, section.component, {});
    const toggle = findElements(before.tree, (element) => element.props?.["aria-label"] === "Screenshot");
    harness.eq("the screenshot toggle is there", toggle.length, 1);
    if (toggle.length === 1) {
      toggle[0].props.onChange({ target: { checked: false } });
      await flush(2);
      toggle[0].props.onChange({ target: { checked: true } });
      await flush(4);
      // The slow answer arrives now.
      for (const resolve of pending) resolve();
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      harness.eq("the older answer did not overwrite the newer change", after.states?.[0]?.settings?.screenshot, true);
    }
  }

  harness.section("client: the first read does not overwrite the first change");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    // The first read of the settings is slow: the user changes something before it answers, and
    // the answer must not undo the change.
    let releaseRead;
    const readPending = new Promise((resolve) => { releaseRead = resolve; });
    let reads = 0;
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      window: { addEventListener() {}, removeEventListener() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          const body = JSON.parse(options.body);
          return jsonResponse({ ok: true, settings: body });
        }
        if (target.includes("/.lr/settings")) {
          reads += 1;
          if (reads === 1) {
            await readPending;
            return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
          }
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(2);
    const before = renderOnce(stub, section.component, {});
    const toggle = findElements(before.tree, (element) => element.props?.["aria-label"] === "Screenshot");
    harness.eq("the screenshot toggle is there", toggle.length, 1);
    if (toggle.length === 1) {
      toggle[0].props.onChange({ target: { checked: false } });
      await flush(4);
      releaseRead();
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      harness.eq("the slow first read did not undo the change", after.states?.[0]?.settings?.screenshot, false);
    }
  }

  harness.section("client: the settings panel offers the theme select");
  {
    const posted = [];
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const hostSettings = { lang: "auto", keys: { comment: "c", adjust: "v", draw: "d", hidePins: "h" }, screenshot: true, cropPad: 72, theme: "dark" };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      window: { addEventListener() {}, removeEventListener() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          const asked = JSON.parse(options.body);
          posted.push(asked);
          return jsonResponse({ ok: true, settings: { ...hostSettings, theme: asked.theme ?? hostSettings.theme } });
        }
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: hostSettings, version: "1.0.24" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const before = renderOnce(stub, section.component, {});
    const select = findElements(before.tree, (element) => element.props?.["aria-label"] === "Theme");
    const options = Array.isArray(select[0]?.props?.children) ? select[0].props.children.length : 0;
    if (select.length === 1) {
      select[0].props.onChange({ target: { value: "contrast" } });
      await flush(4);
    }
    harness.check("the settings panel offers the theme select",
      select.length === 1 && options === 3 && posted.some((body) => body.theme === "contrast"),
      JSON.stringify({ count: select.length, options, posted: posted.map((body) => body.theme) }));
  }

  harness.section("client: plugin manager metadata");
  {
    for (const code of ["en", "pt-BR", "zh-CN"]) {
      const file = path.join(pluginDir, "locale", `${code}.json`);
      if (!harness.check(`the ${code} locale file exists`, existsSync(file))) continue;
      const data = JSON.parse(readFileSync(file, "utf8"));
      harness.check(`the ${code} locale file has a title`, typeof data.meta?.title === "string" && data.meta.title !== "");
      harness.check(`the ${code} locale file has a description`, typeof data.meta?.description === "string" && data.meta.description !== "");
    }
    const icon = path.join(pluginDir, "docs", "assets", "icon.png");
    harness.check("the icon exists", existsSync(icon));
  }

  harness.section("client: the update flow");
  {
    const build = (pluginManager, calls) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage();
      const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
        react: stub.React,
        localStorage,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, options) => {
          const target = String(url);
          calls.push({ url: target, method: options?.method ?? "GET", body: options?.body });
          if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
          if (target.includes("/.lr/update")) {
            return new Response(JSON.stringify({ ok: true, version: "1.0.16", installed: "1.0.16", update: { latest: "v1.0.17", newer: true } }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (target.includes("/.lr/settings")) {
            return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.16" }), { status: 200, headers: { "content-type": "application/json" } });
          }
          if (target.includes("/api/dsh-redline.secret")) {
            return new Response(JSON.stringify({ ok: true, secret: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } });
          }
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        }
      });
      const client = fakeClientCtx(pluginManager === undefined ? {} : { remote: { pluginManager } });
      module.apply(client.ctx);
      client.resolve();
      const section = client.slots.find((slot) => slot.spec.name === "settings.section");
      return { stub, section, client, localStorage };
    };

    const managerCalls = [];
    const manager = {
      async installBundle(spec, options) {
        managerCalls.push({ spec, options });
        return { ok: true, value: { application: "applied", version: "1.0.17" } };
      }
    };
    const withManager = build(manager, []);
    const rendered = renderOnce(withManager.stub, withManager.section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(withManager.stub, withManager.section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears when a release is available", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the plugin manager is asked to install", managerCalls.length, 1);
      harness.eq("the plugin manager receives the package and the version", managerCalls[0]?.spec, "dsh-redline@1.0.17");
      harness.check("the plugin manager receives a request id", typeof managerCalls[0]?.options?.requestId === "string", JSON.stringify(managerCalls[0]?.options));
    }

    const withoutManager = build(undefined, []);
    const renderedWithoutManager = renderOnce(withoutManager.stub, withoutManager.section.component, {});
    for (const effect of renderedWithoutManager.effects) effect();
    await flush(4);
    const withButtonWithoutManager = renderOnce(withoutManager.stub, withoutManager.section.component, {});
    const fallbackButtons = findElements(withButtonWithoutManager.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears without a plugin manager", fallbackButtons.length, 1);
    if (fallbackButtons.length === 1) {
      await fallbackButtons[0].props.onClick();
      await flush(4);
      harness.eq("without a plugin manager the panel says to update manually", withoutManager.stub.getStates()[0].installError, "no-plugin-manager");
    }

  }

  harness.section("client: the update paths that fail");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const managerCalls = [];
    const pluginManager = {
      async installBundle(spec) {
        managerCalls.push(spec);
        return { ok: true, value: { application: "applied", version: "1.0.25-rc.1" } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.16", update: { latest: "v1.0.25-rc.1", newer: true } });
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.16" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears for a release that is not a plain version", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      harness.eq("the refused release is never handed to the manager", managerCalls.length, 0);
      const refusal = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("not a version this plugin can install"));
      harness.check("the refusal is said out loud", refusal.length === 1, JSON.stringify(after.tree).slice(0, 160));
      const stuck = findElements(after.tree, (element) => element.props?.children === "Installing 1.0.25-rc.1...");
      harness.eq("the row does not stay busy", stuck.length, 0);
    }
  }

  harness.section("client: a save that fails does not claim it worked");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    let saveFails = false;
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.16", update: { latest: "v1.0.17", newer: true } });
        if (target.includes("/.lr/settings") && options?.method === "POST") {
          if (saveFails) throw new Error("the host is gone");
          return jsonResponse({ ok: true, settings: { lang: "en", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 } });
        }
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "en", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.16" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const selects = findElements(renderOnce(stub, section.component, {}).tree, (element) => element.props?.["aria-label"] === "Language");
    harness.eq("the language select is there", selects.length, 1);
    if (selects.length === 1) {
      await selects[0].props.onChange({ target: { value: "pt" } });
      await flush(4);
      const afterSave = renderOnce(stub, section.component, {});
      const banner = findElements(afterSave.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("Saved"));
      harness.check("a saved change is acknowledged", banner.length === 1, JSON.stringify(afterSave.tree).slice(0, 160));
      saveFails = true;
      const selectsAgain = findElements(afterSave.tree, (element) => element.props?.["aria-label"] === "Language");
      await selectsAgain[0].props.onChange({ target: { value: "zh" } });
      await flush(4);
      const afterFail = renderOnce(stub, section.component, {});
      const bannerAfter = findElements(afterFail.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("Saved"));
      harness.eq("a failed save does not leave the saved banner", bannerAfter.length, 0);
      const reported = findElements(afterFail.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("the host is gone"));
      harness.check("the failed save is reported", reported.length === 1, JSON.stringify(afterFail.tree).slice(0, 200));
      const kept = findElements(afterFail.tree, (element) => element.props?.["aria-label"] === "Language");
      harness.eq("the panel shows the setting the host still holds", kept[0]?.props?.value, "en");
    }
  }

  harness.section("client: a save made over a refused read does not write the defaults");
  {
    // The settings read was refused: what the panel shows is the defaults, not the ones the host
    // holds. Saving them would write the defaults over the host's settings, so the save is
    // refused with a message of its own.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    let posts = 0;
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/settings") && options?.method === "POST") { posts += 1; return jsonResponse({ ok: true, settings: JSON.parse(String(options.body)) }); }
        if (target.includes("/.lr/settings")) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.16", update: { latest: "v1.0.17", newer: true } });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const panel = renderOnce(stub, section.component, {});
    const selects = findElements(panel.tree, (element) => element.props?.["aria-label"] === "Language");
    await selects[0].props.onChange({ target: { value: "pt" } });
    await flush(4);
    harness.eq("the save never reached the host", posts, 0);
    const warned = findElements(renderOnce(stub, section.component, {}).tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("could not be read"));
    harness.check("the blocked save says why", warned.length === 1, JSON.stringify(stub.getStates()[0]));
  }

  harness.section("client: a host that answers without settings does not break the panel");
  {    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.16", update: { latest: "v1.0.17", newer: true } });
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, version: "1.0.16" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    let survived = true;
    let tree = undefined;
    try {
      tree = renderOnce(stub, section.component, {}).tree;
    } catch {
      survived = false;
    }
    harness.check("the panel renders an answer that carries no settings", survived, "the panel threw while rendering");
    if (survived) {
      const current = findElements(tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("Current version"));
      harness.check("the row still names the running version", current.length === 1, JSON.stringify(tree).slice(0, 160));
    }
  }

  harness.section("client: an update check that fails is not an answer that says there is nothing");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) throw new Error("the registry is unreachable");
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.16" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const nothing = findElements(after.tree, (element) => element.props?.children === "No releases published yet");
    harness.eq("a failed check does not claim there are no releases", nothing.length, 0);
    const failed = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("Update check failed"));
    harness.check("the failed check is reported", failed.length === 1, JSON.stringify(after.tree).slice(0, 200));
  }

  harness.section("client: the update survives the plugin going away");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const pluginManager = {
      async installBundle() {
        return { ok: true, value: { application: "applied", version: "1.0.19" } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return new Response(JSON.stringify({ ok: true, version: "1.0.17", installed: "1.0.17", update: { latest: "v1.0.19", newer: true, url: "https://github.com/klaus-2/dsh-redline/releases/tag/v1.0.19" } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/.lr/settings")) {
          return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.17" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/api/dsh-redline.secret")) {
          return new Response(JSON.stringify({ ok: true, secret: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.check("the installed version is remembered", (localStorage.getItem("dsh-redline.updated") ?? "") === "1.0.19", String(localStorage.getItem("dsh-redline.updated")));
    }
  }

  harness.section("client: the update that waits for a restart names the version that landed");
  {
    // The manager answers with the version of the bundle it resolved on disk. pnpm's minimumReleaseAge can
    // hold a release back, so that answer is the truth about what landed — here it is the older 1.0.23, and
    // the row must name it rather than the 1.0.24 that was asked for.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const pluginManager = {
      async installBundle() {
        return { ok: true, value: { application: "restart-required", version: "1.0.23" } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true, url: "https://github.com/klaus-2/dsh-redline/releases/tag/v1.0.24" } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the version that landed on disk is remembered", localStorage.getItem("dsh-redline.updated"), "1.0.23");
      const after = renderOnce(stub, section.component, {});
      const restart = findElements(after.tree, (element) => typeof element?.props?.children === "string" && element.props.children.includes("1.0.23") && element.props.children.includes("installed"));
      harness.eq("the row names the version that landed, and says which one was asked for", restart.length, 1);
      harness.eq("the row says exactly what landed and what was asked for", restart[0]?.props.children, "Version 1.0.23 was installed instead of 1.0.24 — pnpm holds back a release that is too recent.");
      const asked = findElements(after.tree, (element) => typeof element?.props?.children === "string" && element.props.children.includes("1.0.24 was installed"));
      harness.eq("the row does not claim the version that was only asked for", asked.length, 0);
      const stillThere = findElements(after.tree, (element) => element.props?.children === "Update now");
      harness.eq("the update button stays so the release can be tried again", stillThere.length, 1);
    }
  }

  harness.section("client: a copy the manager already holds is not installed by the panel");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const pluginManager = {
      async installBundle(spec) {
        calls.push(spec);
        return { ok: true, value: { application: "failed", error: { code: "already-installed" } } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the manager is asked once", calls.length, 1);
      harness.check("the tarball is never asked for", !calls.some((spec) => String(spec).includes(".tgz")), JSON.stringify(calls));
      harness.eq("nothing is named as installed", stub.getStates()[0].installed, "");
      harness.eq("nothing is remembered as installed", localStorage.getItem("dsh-redline.updated"), null);
      harness.eq("the panel points at a manual update", stub.getStates()[0].installError, "no-plugin-manager");
    }
  }

  harness.section("client: the host's own update API is preferred over a tarball");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const pluginManager = {
      async updateBundle(name, version, options) {
        calls.push({ api: "updateBundle", name, version, options });
        return { ok: true, value: { from: "1.0.23", to: version, step: "install", result: { changed: true, application: "restart-required", stage: "install", target: name, version } } };
      },
      async installBundle(spec) {
        calls.push({ api: "installBundle", spec });
        return { ok: true, value: { application: "failed", error: { code: "already-installed" } } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the host's update API is the only call", calls.length, 1);
      harness.eq("the host's update API is the one that was used", calls[0]?.api, "updateBundle");
      harness.eq("the host's update API names the package", calls[0]?.name, "dsh-redline");
      harness.eq("the host's update API names the version", calls[0]?.version, "1.0.24");
      harness.check("the host's update API receives a request id", typeof calls[0]?.options?.requestId === "string", JSON.stringify(calls[0]?.options));
      harness.eq("the version that landed on disk is remembered", localStorage.getItem("dsh-redline.updated"), "1.0.24");
    }
  }

  harness.section("client: a host that refuses the update does not claim it worked");
  {
    const build = async (pluginManager, options = {}) => {
      const stub = createReactStub();
      const localStorage = makeLocalStorage();
      const routeCalls = options.routeCalls ?? [];
      const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
        react: stub.React,
        localStorage,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, init) => {
          const target = String(url);
          if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
          if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
          if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
          if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
          return jsonResponse({});
        }
      });
      const client = fakeClientCtx({ remote: { pluginManager } });
      module.apply(client.ctx);
      client.resolve();
      const section = client.slots.find((slot) => slot.spec.name === "settings.section");
      const rendered = renderOnce(stub, section.component, {});
      for (const effect of rendered.effects) effect();
      await flush(4);
      return { stub, section, localStorage };
    };
    const click = async (built) => {
      const withButton = renderOnce(built.stub, built.section.component, {});
      const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
      harness.eq("the update button appears", buttons.length, 1);
      if (buttons.length !== 1) return;
      await buttons[0].props.onClick();
      await flush(4);
    };

    const refused = await build({
      async updateBundle() {
        return { ok: true, value: { from: "1.0.23", to: "1.0.24", step: "check", result: { changed: false, application: "failed", stage: "install", target: "dsh-redline", error: { code: "invalid-spec", diagnostic: "dsh-redline is not installed from a registry under its own name" } } } };
      }
    });
    await click(refused);
    harness.eq("nothing is named as installed", refused.stub.getStates()[0].installed, "");
    harness.eq("nothing is remembered as installed", refused.localStorage.getItem("dsh-redline.updated"), null);
    harness.eq("the refusal of the update is reported as a manual update", refused.stub.getStates()[0].installError, "no-plugin-manager");

    const cancelled = await build({
      async updateBundle(name, version) {
        return { ok: true, value: { from: "1.0.23", to: version, step: "install", result: { changed: false, application: "cancelled", stage: "install", target: name } } };
      }
    });
    await click(cancelled);
    harness.eq("a cancellation names nothing as installed", cancelled.stub.getStates()[0].installed, "");
    harness.eq("a cancellation is not remembered as installed", cancelled.localStorage.getItem("dsh-redline.updated"), null);
    harness.check("a cancellation is reported", cancelled.stub.getStates()[0].installError !== "", String(cancelled.stub.getStates()[0].installError));

    const managerCalls = [];
    const recovered = await build({
      async updateBundle() {
        return { ok: true, value: { from: "1.0.23", to: "1.0.24", step: "check", result: { changed: false, application: "failed", stage: "install", target: "dsh-redline", error: { code: "invalid-spec", diagnostic: "dsh-redline is not installed from a registry under its own name" } } } };
      },
      async installBundle(spec) {
        managerCalls.push(spec);
        return { ok: true, value: { application: "restart-required", version: "1.0.24" } };
      }
    });
    await click(recovered);
    harness.eq("the refused update is not retried on the manager's install API", managerCalls.length, 0);
    harness.eq("nothing is named as installed", recovered.stub.getStates()[0].installed, "");
    harness.eq("nothing is remembered as installed", recovered.localStorage.getItem("dsh-redline.updated"), null);
    harness.eq("the refused update is reported as a manual update", recovered.stub.getStates()[0].installError, "no-plugin-manager");
  }

  harness.section("client: a profile the manager cannot update is reported as a manual update");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const managerCalls = [];
    const pluginManager = {
      async updateBundle(name, version) {
        managerCalls.push({ api: "updateBundle", name, version });
        return { ok: true, value: { from: "1.0.23", to: version, step: "check", result: { changed: false, application: "failed", stage: "install", target: name, error: { code: "invalid-spec", diagnostic: "dsh-redline is not installed from a registry under its own name" } } } };
      },
      async installBundle(spec) {
        managerCalls.push({ api: "installBundle", spec });
        return { ok: true, value: { application: "failed", error: { code: "already-installed" } } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the host's update API is asked first", managerCalls[0]?.api, "updateBundle");
      harness.check("the tarball is never asked for", !managerCalls.some((call) => String(call.spec ?? "").includes(".tgz")), JSON.stringify(managerCalls));
      harness.eq("the manager's install API is not asked after the refusal", managerCalls.filter((call) => call.api === "installBundle").length, 0);
      harness.eq("nothing is named as installed", stub.getStates()[0].installed, "");
      harness.eq("nothing is remembered as installed", localStorage.getItem("dsh-redline.updated"), null);
      harness.eq("the panel points at a manual update", stub.getStates()[0].installError, "no-plugin-manager");
    }
  }

  harness.section("client: a host that only has the update API is still asked");
  {    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const pluginManager = {
      async updateBundle(name, version) {
        calls.push({ api: "updateBundle", name, version });
        return { ok: true, value: { from: "1.0.23", to: version, step: "install", result: { changed: true, application: "restart-required", stage: "install", target: name, version } } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the host's update API is the only call", calls.length, 1);
      harness.eq("the host's update API is the one that was used", calls[0]?.api, "updateBundle");
      harness.eq("the version that landed on disk is remembered", localStorage.getItem("dsh-redline.updated"), "1.0.24");
    }
  }

  harness.section("client: a refused update check is not an answer that says there is nothing");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
        if (target.includes("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const nothing = findElements(after.tree, (element) => element.props?.children === "No releases published yet");
    harness.eq("a refused check does not claim there are no releases", nothing.length, 0);
    const failed = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("Update check failed"));
    harness.check("the refused check is reported", failed.length === 1, JSON.stringify(after.tree).slice(0, 200));
  }

  harness.section("client: a refused settings read is reported instead of leaving the panel blank");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        if (target.includes("/.lr/settings")) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const unreachable = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("unreachable"));
    harness.check("the refused read is reported", unreachable.length === 1, JSON.stringify(after.tree).slice(0, 200));
    harness.eq("the panel does not wait for an answer that never came", stub.getStates()[0].loaded, false);
  }

  harness.section("client: a manager that names no version falls back to the one that was asked for");
  {
    // The manager answers without a version: the version that was asked for is the best answer there is.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const pluginManager = {
      async installBundle() {
        return { ok: true, value: { application: "restart-required" } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      harness.eq("the version that was asked for is remembered", localStorage.getItem("dsh-redline.updated"), "1.0.24");
      const after = renderOnce(stub, section.component, {});
      const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.24") && element.props.children.includes("installed"));
      harness.check("the row names the version that was asked for", restart.length > 0, JSON.stringify(after.tree).slice(0, 200));
    }
  }

  harness.section("client: the update that runs at once becomes the current version");
  {
    // The manager loaded the new copy: it runs now, so there is nothing to restart for and the row must
    // name it as the current version.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const pluginManager = {
      async installBundle() {
        return { ok: true, value: { application: "applied", version: "1.0.24" } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true, url: "https://github.com/klaus-2/dsh-redline/releases/tag/v1.0.24" } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      const current = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.startsWith("Current version:"));
      harness.check("the row names the new version as the current one", current.length === 1 && current[0].props.children === "Current version: 1.0.24", JSON.stringify(current.map((element) => element.props.children)));
      const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("was installed"));
      harness.eq("the row does not ask for a restart", restart.length, 0);
    }
  }

  harness.section("client: a version that is not a version names nothing");
  {
    // The host reports an on-disk version it could not parse: the row must not show it and must not break.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true, installed: "not-a-version" } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const broken = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("not-a-version"));
    harness.eq("the row does not show a version it cannot parse", broken.length, 0);
    const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("was installed"));
    harness.eq("the row does not ask for a restart for a version it cannot parse", restart.length, 0);
    const current = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.startsWith("Current version:"));
    harness.check("the row still shows the current version", current.length === 1 && current[0].props.children === "Current version: 1.0.23", JSON.stringify(current.map((element) => element.props.children)));
  }

  harness.section("client: the copy on disk waits for the restart even without a local install");
  {
    // The host reports a copy on disk that is newer than the one that runs. The user never installed it here
    // (another tab, or the site data was cleared), so the row must still name it.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.24", update: { latest: "v1.0.24", newer: false, installed: "1.0.25" } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.25") && element.props.children.includes("was installed"));
    harness.check("the row names the copy that waits on disk", restart.length > 0, JSON.stringify(after.tree).slice(0, 200));
    const button = findElements(after.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button disappears while the restart waits", button.length, 0);
  }

  harness.section("client: the newest of the two copies on disk wins");
  {
    // This tab installed 1.0.23; the host reports a newer 1.0.25 on disk. The newer one is what runs next.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    localStorage.setItem("dsh-redline.updated", "1.0.23");
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.24", update: { latest: "v1.0.25", newer: true, installed: "1.0.25" } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const named = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("was installed"));
    harness.check("the row names the newest copy", named.length > 0 && named[0].props.children.includes("1.0.25"), JSON.stringify(named.map((element) => element.props.children)));
    const stale = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.23 was installed"));
    harness.eq("the row does not name the older copy", stale.length, 0);
  }

  harness.section("client: the record survives while the copy that runs is older");
  {
    // The copy that runs is older than the one the last install put on disk: the record must stay, because
    // the next start is still the one that brings the newer copy in.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    localStorage.setItem("dsh-redline.updated", "1.0.24");
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.23", update: { latest: "v1.0.24", newer: true } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.23" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    harness.eq("the pending record survives while the old copy runs", localStorage.getItem("dsh-redline.updated"), "1.0.24");
  }

  harness.section("client: the record survives when the host does not know the running version");
  {
    // The host answered without a version: the running copy is unknown, so the record cannot be compared and
    // must not be thrown away.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    localStorage.setItem("dsh-redline.updated", "1.0.24");
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, update: { latest: "v1.0.24", newer: true } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 } });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    harness.eq("the pending record survives when the running version is unknown", localStorage.getItem("dsh-redline.updated"), "1.0.24");
  }

  harness.section("client: the row keeps working when the plugin goes away");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    localStorage.setItem("dsh-redline.updated", "1.0.19");
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async () => { throw new Error("the plugin is gone"); }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const unreachable = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("unreachable"));
    harness.eq("the row does not claim the service is unreachable", unreachable.length, 0);
    const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.19"));
    harness.check("the row asks for a restart with the installed version", restart.length > 0, JSON.stringify(after.tree).slice(0, 200));
    const fake = findElements(after.tree, (element) => element.props?.children === "1.0.0");
    harness.eq("the row does not show a made up version", fake.length, 0);
  }

  harness.section("client: the record is forgotten once the copy runs it");
  {
    // After the restart the running copy is the version the last install put on disk: the record has
    // nothing left to say and the row says the copy is on the latest version.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    localStorage.setItem("dsh-redline.updated", "1.0.24");
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.24", update: { latest: "v1.0.24", newer: false } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.24" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const after = renderOnce(stub, section.component, {});
    const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("was installed"));
    harness.eq("the row does not ask for a restart the copy already made", restart.length, 0);
    harness.eq("the record is forgotten", localStorage.getItem("dsh-redline.updated"), null);
  }

  harness.section("client: the release page link is always there");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const releaseUrl = "https://github.com/klaus-2/dsh-redline/releases/tag/v1.0.17";
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return new Response(JSON.stringify({ ok: true, version: "1.0.17", installed: "1.0.17", update: { latest: "v1.0.17", newer: false, url: releaseUrl } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/.lr/settings")) {
          return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.17" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/api/dsh-redline.secret")) {
          return new Response(JSON.stringify({ ok: true, secret: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withRow = renderOnce(stub, section.component, {});
    const links = findElements(withRow.tree, (element) => element.props?.href === releaseUrl);
    harness.eq("the release page link is shown when the plugin is up to date", links.length, 1);
    harness.check("the release page link opens a new tab", links[0]?.props?.target === "_blank", JSON.stringify(links[0]?.props?.target));
  }

  harness.section("client: the update shows the real error");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const diagnostic = [
      "Progress: resolved 254, reused 2, downloaded 0, added 1, done",
      "dsh: installation rejected: Cannot validate installed package dsh-redline: Error: ENOENT",
      "dsh: restored package.json, pnpm-lock.yaml, and node_modules."
    ].join(String.fromCharCode(10));
    const pluginManager = {
      async installBundle() {
        return { ok: true, value: { application: "failed", error: { code: "operation-error", diagnostic } } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return new Response(JSON.stringify({ ok: true, version: "1.0.16", installed: "1.0.16", update: { latest: "v1.0.17", newer: true } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/.lr/settings")) {
          return new Response(JSON.stringify({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.16" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (target.includes("/api/dsh-redline.secret")) {
          return new Response(JSON.stringify({ ok: true, secret: "a".repeat(64) }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      const errors = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("installation rejected"));
      harness.check("the message names the real failure", errors.length === 1, JSON.stringify(after.tree).slice(0, 120));
    }
  }

  harness.section("client: a copy that landed on disk but would not start waits for the restart");
  {
    // The manager installed the copy but could not start it: the version is on disk, so the row names it and
    // asks for a restart — the same as the reference implementation.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const pluginManager = {
      async installBundle() {
        return { ok: true, value: { application: "failed", version: "1.0.17", error: { code: "operation-error", diagnostic: "dsh: the plugin did not start." } } };
      }
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/update")) {
          return jsonResponse({ ok: true, version: "1.0.16", update: { latest: "v1.0.17", newer: true } });
        }
        if (target.includes("/.lr/settings")) {
          return jsonResponse({ ok: true, settings: { lang: "auto", keys: { comment: "c", adjust: "v" }, screenshot: true, cropPad: 72 }, version: "1.0.16" });
        }
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({ remote: { pluginManager } });
    module.apply(client.ctx);
    client.resolve();
    const section = client.slots.find((slot) => slot.spec.name === "settings.section");
    const rendered = renderOnce(stub, section.component, {});
    for (const effect of rendered.effects) effect();
    await flush(4);
    const withButton = renderOnce(stub, section.component, {});
    const buttons = findElements(withButton.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears", buttons.length, 1);
    if (buttons.length === 1) {
      await buttons[0].props.onClick();
      await flush(4);
      const after = renderOnce(stub, section.component, {});
      const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.17") && element.props.children.includes("was installed"));
      harness.check("the row names the copy that landed on disk", restart.length > 0, JSON.stringify(after.tree).slice(0, 200));
      harness.eq("the copy that landed on disk is remembered", localStorage.getItem("dsh-redline.updated"), "1.0.17");
      const reason = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("did not start"));
      harness.check("the row says why the copy did not start", reason.length > 0, JSON.stringify(after.tree).slice(0, 200));
    }
  }

  harness.section("client: the chat card is a conversation node");
  {
    const clientSource = client;
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const fetchCalls = [];
    const registeredDefinitions = [];
    const documentStub = {
      createElement(tag) {
        const node = { tag, href: "", download: "", click: () => {}, style: {}, setAttribute() {} };
        return node;
      },
      documentElement: {},
      head: { appendChild() {} },
      body: { appendChild() {} },
      readyState: "complete",
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {}
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      document: documentStub,
      fetch: async (url, options) => {
        const target = String(url);
        fetchCalls.push({ url: target, headers: options?.headers ?? {} });
        if (target === "/api/dsh-redline.secret") return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.endsWith("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "en", keys: { comment: "x", adjust: "y" }, screenshot: false, cropPad: 96 }, version: "1.0.23" });
        if (target.includes("/.lr/pending")) return jsonResponse({ ok: true, count: 0 });
        return jsonResponse({});
      }
    });
    const disposers = [];
    const uiConversation = {
      events: {
        register(definition) {
          registeredDefinitions.push(definition);
          const dispose = () => {};
          disposers.push(dispose);
          return dispose;
        }
      }
    };
    const clientApi = fakeClientCtx({ uiConversation });
    module.apply(clientApi.ctx);
    clientApi.resolve();
    await flush(4);

    const injectedNames = clientApi.injected.map((entry) => entry.name);
    harness.check("the client injects the conversation node slot", injectedNames.includes("conversation.chat.node"), JSON.stringify(injectedNames));

    harness.check("the client declares the conversation service",
      Array.isArray(module.inject) && module.inject.includes("uiConversation") && module.inject.includes("slots"),
      JSON.stringify(module.inject));

    harness.check("the definition registration keeps its disposer in an effect", clientApi.effects.some((entry) => typeof entry.fn === "function" && entry.label === "dsh-redline: chat node definition"), JSON.stringify(clientApi.effects.map((entry) => entry.label)));

    const definition = registeredDefinitions[0];
    harness.check("the client registers one chat node definition", registeredDefinitions.length === 1 && definition !== undefined, `count=${registeredDefinitions.length}`);
    if (definition !== undefined) {
      const builtinKinds = ["user", "steering", "context", "command", "compaction", "turn-error", "turn-max-tokens", "unknown", "assistant-step", "tool-call", "manual-compaction", "model-retry", "turn-tail", "system-prompt", "turn-process", "turn-trigger", "input-message", "developer-message"];
      harness.check("the definition claims the Redline event",
        definition.kind === "dsh-redline-annotations" && definition.target === "chat"
        && !builtinKinds.includes(definition.kind)
        && definition.match({ type: "user/message", surfaceOp: "append", data: { id: "m1", seq: 7, source: { kind: "dsh-redline" } } })?.exclusive === true
        && definition.match({ type: "user/message", surfaceOp: "append", data: { id: "m1", seq: 7, source: { kind: "user" } } }) === null,
        JSON.stringify({ kind: definition.kind, target: definition.target }));
      harness.check("the definition ignores messages that are not Redline annotations",
        definition.match({ type: "user/message", surfaceOp: "append", data: { id: "m1", source: { kind: "user" } } }) === null
        && definition.match({ type: "assistant/message", data: { message: { id: "a1", source: { kind: "model" }, content: [] } } }) === null);
      harness.check("the definition ignores a message that did not append",
        definition.match({ type: "user/message", surfaceOp: "replace", data: { id: "m2", source: { kind: "dsh-redline" } } }) === null
        && definition.match({ type: "user/message", data: { id: "m3", source: { kind: "dsh-redline" } } }) === null);
      harness.check("the definition reads surfaceOp from the event, not from data",
        definition.match({ type: "user/message", data: { id: "m4", source: { kind: "dsh-redline" }, surfaceOp: "append" } }) === null
        && definition.match({ type: "user/message", surfaceOp: "append", data: { id: "m4", source: { kind: "dsh-redline" } } }) !== null);
      harness.check("the definition builds a view node for the matched event", (() => {
        definition.match({ type: "user/message", surfaceOp: "append", seq: 5, data: { id: "m0", source: { kind: "user" } } });
        const event = { type: "user/message", surfaceOp: "append", seq: 7, data: { id: "m1", source: { kind: "dsh-redline", form: "snapshot", pageTitle: "Demo", pins: [{ tag: "h1", selector: "body h1", comment: "make it bigger", screenshotPath: "1700000000-abcd1234.png" }] } } };
        const match = { event, role: "start", location: { kind: "unresolved" } };
        const context = { key: "test-key", kind: definition.kind, id: "m1", matches: [match], start: match, state: undefined, current: new Map() };
        const state = definition.start(context, match, { previous: () => undefined });
        context.state = state;
        definition.update(context, match);
        const node = definition.buildViewNode(context);
        return node !== null && node !== undefined
          && node.kind === definition.kind && node.target === "chat" && node.anchorSeq === 4.5
          && node.groupTree === "exchange"
          && node.visibility === "visible" && typeof node.key === "string" && node.key !== ""
          && Array.isArray(node.data.pins) && node.data.pins[0]?.comment === "make it bigger";
      })(), "buildViewNode did not produce the expected node");
      harness.check("the card anchors before the user message it belongs to", (() => {
        definition.match({ type: "user/message", surfaceOp: "append", seq: 40, data: { id: "m-user", source: { kind: "user" } } });
        const event = { type: "user/message", surfaceOp: "append", seq: 42, data: { id: "m-card", source: { kind: "dsh-redline", pins: [] } } };
        const match = { event, role: "start", location: { kind: "step", turn: { turn: 1 }, step: { turn: 1, step: 1 } } };
        const context = { key: "placement-key", kind: definition.kind, id: "m-card", matches: [match], start: match, state: undefined, current: new Map() };
        context.state = definition.start(context, match, { previous: () => undefined });
        definition.update(context, match);
        const node = definition.buildViewNode(context);
        return node !== null && node !== undefined && node.anchorSeq === 39.5 && node.groupTree === "exchange";
      })(), "the card did not anchor above the user message");
    }

    const slotEntry = clientApi.injected.find((entry) => entry.name === "conversation.chat.node");
    const registeredSlot = clientApi.slots.find((slot) => slot.spec.name === "conversation.chat.node" && slot.spec.key === "dsh-redline-annotations");
    harness.check("the conversation node slot registers with the definition kind", slotEntry !== undefined && registeredSlot !== undefined);

    if (registeredSlot !== undefined) {
      const rendered = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [{ tag: "h1", selector: "body h1", comment: "make it bigger", screenshotPath: null }], pageTitle: "Demo", sections: [] } } });
      const commentHit = findByText(rendered.tree, "make it bigger");
      const tagHit = findByText(rendered.tree, "h1");
      const titleHit = findByText(rendered.tree, "Demo");
      harness.check("the card renders the pins it was given", commentHit.length === 1 && tagHit.length >= 1 && titleHit.length >= 1, JSON.stringify({ comment: commentHit.length, tag: tagHit.length, title: titleHit.length }));

      const htmlProp = findElements(rendered.tree, (element) => element.props?.dangerouslySetInnerHTML !== undefined && element.props.className !== "lr-lead" && element.props.className !== "lr-node-head-icon");
      harness.check("the card never renders page text as markup", htmlProp.length === 0, JSON.stringify(htmlProp.map((element) => element.props.className)));
      const xss = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [{ tag: "h1", selector: "body h1", comment: '<img src=x onerror=alert(1)>', screenshotPath: null }], pageTitle: "Demo", sections: [] } } });
      const literal = findByText(xss.tree, '<img src=x onerror=alert(1)>');
      harness.check("the card renders an injected comment as literal text", literal.length === 1, JSON.stringify(literal.length));
      const withSections = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [], pageTitle: "Demo", sections: [{ name: "Overview", text: "Page URL: https://example.test" }, { name: "User Comment 1", text: "make it bigger" }] } } });
      const sectionText = findByText(withSections.tree, "Page URL: https://example.test");
      const sectionName = findByText(withSections.tree, "Overview");
      harness.check("the card renders the sections disclosure", sectionText.length === 1 && sectionName.length >= 1, JSON.stringify({ text: sectionText.length, name: sectionName.length }));
      const headHits = findByText(rendered.tree, "Browser comments (Redline)");
      harness.check("the card title appears once", headHits.length === 1, JSON.stringify(headHits.length));
      const cardSpan = /function RedlineAnnotationsCard[\s\S]*?^    function startStatusArming/m.exec(clientSource)?.[0] ?? "";
      harness.check("the source keeps dangerouslySetInnerHTML on the icon only", (clientSource.match(/dangerouslySetInnerHTML/g) ?? []).length === 2 && (cardSpan.match(/dangerouslySetInnerHTML/g) ?? []).length === 1, `total=${(clientSource.match(/dangerouslySetInnerHTML/g) ?? []).length}, card=${(cardSpan.match(/dangerouslySetInnerHTML/g) ?? []).length}`);

      fetchCalls.length = 0;
      const withCrop = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [{ tag: "h1", selector: "body h1", comment: "crop me", screenshotPath: "1700000000-abcd1234.png" }], pageTitle: "Demo", sections: [] } } });
      for (const effect of withCrop.effects) effect();
      await flush(4);
      const cropCall = fetchCalls.find((call) => call.url.includes("/.lr/attachments/1700000000-abcd1234.png"));
      harness.check("the card asks for the crop with the secret header",
        cropCall !== undefined && cropCall.headers["x-dsh-redline-secret"] === "a".repeat(64),
        JSON.stringify(fetchCalls));

      fetchCalls.length = 0;
      const withViewport = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [], pageTitle: "Demo", screenshotPath: "1700000000-viewport.jpg", sections: [] } } });
      const viewportMissing = findByText(withViewport.tree, "(attachment unavailable)");
      harness.check("the card does not mark the viewport unavailable before the fetch resolves", viewportMissing.length === 0, JSON.stringify(viewportMissing.length));
      for (const effect of withViewport.effects) effect();
      await flush(4);
      const viewportCall = fetchCalls.find((call) => call.url.includes("/.lr/attachments/1700000000-viewport.jpg"));
      harness.check("the card fetches the viewport with the secret header",
        viewportCall !== undefined && viewportCall.headers["x-dsh-redline-secret"] === "a".repeat(64),
        JSON.stringify(fetchCalls));
      const withoutViewport = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [], pageTitle: "Demo", screenshotPath: "", sections: [] } } });
      const noViewportImg = findElements(withoutViewport.tree, (element) => element.props?.className === "lr-node-img");
      const viewportNameInSource = /viewportName = typeof data\.screenshotPath[^;]*replace\(\/\[\^A-Za-z0-9\._-\]\/g, ""\)/.test(clientSource);
      harness.check("the card skips the viewport when the source has none", noViewportImg.length === 0, JSON.stringify(noViewportImg.length));
      harness.check("the viewport name is sanitized to the attachment charset before any fetch", viewportNameInSource,
        "viewportName sanitize expression missing");
      fetchCalls.length = 0;
      const withHostileViewport = renderOnce(stub, registeredSlot.component, { node: { data: { pins: [], pageTitle: "Demo", screenshotPath: "../outside.png", sections: [] } } });
      for (const effect of withHostileViewport.effects) effect();
      await flush(4);
      const hostileUrls = fetchCalls.map((call) => call.url);
      harness.check("a hostile viewport value fetches only its sanitized basename", hostileUrls.length === 1 && hostileUrls[0]?.endsWith("/.lr/attachments/outside.png") && !hostileUrls[0]?.includes(".."),
        JSON.stringify(hostileUrls));
    }

    const removedSymbols = ["data-chat-anchor-key", "dsh-recall-stack", "lr-card-map-v1", "applyCardsToDom", "buildCardElement", "lr-attached", "cardStore"];
    const stillThere = removedSymbols.filter((symbol) => clientSource.includes(symbol));
    harness.check("the DOM surgery is gone", stillThere.length === 0, stillThere.join(", "));
    harness.check("the client no longer arms a card from the status poll", !clientSource.includes("claimByMessageId") && !clientSource.includes("lastDelivered") && clientSource.includes("fields=cmd") && !clientSource.includes("fields=cmd,lastDelivered"));
  }

  harness.section("client: the card pin row sends a locate command");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    class FakeElement {}
    const executed = [];
    const registeredDefinitions = [];
    const overlayBundle = readFileSync(path.join(pluginDir, "lib", "overlay.js"), "utf8");
    const bridgeBundle = readFileSync(path.join(pluginDir, "lib", "bridge.js"), "utf8");
    const fakeWebview = new FakeElement();
    fakeWebview.dataset = { liveReviewWired: undefined };
    fakeWebview.getAttribute = (name) => (name === "src" ? "https://example.com/" : null);
    fakeWebview.addEventListener = (type, handler) => {
      if (type === "dom-ready") setTimeout(() => handler(), 0);
    };
    const pageMountModel = createMountModel();
    fakeWebview.executeJavaScript = async (code) => {
      executed.push(code);
      if (code.includes("lrMountState")) return pageMountModel.answer(code);
      if (code.includes("window.__LR__ = Object.assign")) {
        pageMountModel.answer(code);
        return null;
      }
      return null;
    };
    const documentStub = {
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      documentElement: {},
      readyState: "complete",
      querySelector: () => null,
      querySelectorAll: (selector) => (typeof selector === "string" && selector.includes("webview") ? [fakeWebview] : []),
      addEventListener() {},
      removeEventListener() {}
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      document: documentStub,
      sandbox: { Element: FakeElement, MutationObserver: class { observe() {} } },
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.endsWith("/.lr/overlay.js")) return new Response(overlayBundle, { status: 200, headers: { "content-type": "text/javascript" } });
        if (target.endsWith("/.lr/bridge.js")) return new Response(bridgeBundle, { status: 200, headers: { "content-type": "text/javascript" } });
        if (target.includes("/.lr/pending")) return jsonResponse({ ok: true, count: 0 });
        return jsonResponse({});
      }
    });
    const uiConversation = {
      events: {
        register(definition) {
          registeredDefinitions.push(definition);
          return () => {};
        }
      }
    };
    const clientApi = fakeClientCtx({ uiConversation });
    module.apply(clientApi.ctx);
    clientApi.resolve();
    await waitFor(() => executed.some((code) => code.includes("window.__LR__ = Object.assign")), 4000);
    await flush(4);
    const slot = clientApi.slots.find((entry) => entry.spec.name === "conversation.chat.node");
    if (slot !== undefined) {
      const rendered = renderOnce(stub, slot.component, { node: { data: { pins: [{ tag: "h1", selector: "body h1", comment: "locate me", screenshotPath: null }], pageTitle: "Demo", sections: [] } } });
      const row = findElements(rendered.tree, (element) => element.props?.className === "lr-node-pin");
      executed.length = 0;
      if (row.length === 1) row[0].props.onClick();
      await flush(4);
      const locate = executed.find((code) => code.includes('type: "locate"'));
      harness.check("client: the card pin row sends a locate command for the pin selector",
        row.length === 1 && locate !== undefined && locate.includes('window.postMessage({ source: "dsh-redline", type: "locate", selector: ' + JSON.stringify("body h1") + ' }, "*")'),
        JSON.stringify({ rows: row.length, executed: executed.map((code) => code.slice(0, 90)) }));
    } else harness.check("client: the card pin row sends a locate command for the pin selector", false, "chat node slot missing");
  }

  harness.section("client: the card renders the pasted image");
  {
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const fetchCalls = [];
    const registeredDefinitions = [];
    class StubURL extends URL {
      static createObjectURL = () => "blob:stub-url";
      static revokeObjectURL = () => {};
    }
    const documentStub = {
      createElement(tag) {
        const node = { tag, href: "", download: "", click: () => {}, style: {}, setAttribute() {} };
        return node;
      },
      documentElement: {},
      head: { appendChild() {} },
      body: { appendChild() {} },
      readyState: "complete",
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {}
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      document: documentStub,
      sandbox: { URL: StubURL },
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      fetch: async (url, options) => {
        const target = String(url);
        fetchCalls.push({ url: target, headers: options?.headers ?? {} });
        if (target === "/api/dsh-redline.secret") return jsonResponse({ ok: true, secret: "a".repeat(64) });
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.endsWith("/.lr/settings")) return jsonResponse({ ok: true, settings: { lang: "en", keys: { comment: "x", adjust: "y" }, screenshot: false, cropPad: 96 }, version: "1.0.23" });
        if (target.includes("/.lr/pending")) return jsonResponse({ ok: true, count: 0 });
        return jsonResponse({});
      }
    });
    const uiConversation = {
      events: {
        register(definition) {
          registeredDefinitions.push(definition);
          return () => {};
        }
      }
    };
    const clientApi = fakeClientCtx({ uiConversation });
    module.apply(clientApi.ctx);
    clientApi.resolve();
    await flush(4);
    const slot = clientApi.slots.find((entry) => entry.spec.name === "conversation.chat.node");
    if (slot !== undefined) {
      const rendered = renderOnce(stub, slot.component, { node: { data: { pins: [{ tag: "h1", selector: "body h1", comment: "colei isto", screenshotPath: null, pastedShotPath: "1700000000-pasted.jpg" }], pageTitle: "Demo", sections: [] } } });
      for (const effect of rendered.effects) effect();
      await flush(4);
      const fetchCall = fetchCalls.find((call) => call.url.includes("/.lr/attachments/1700000000-pasted.jpg"));
      const after = renderOnce(stub, slot.component, { node: { data: { pins: [{ tag: "h1", selector: "body h1", comment: "colei isto", screenshotPath: null, pastedShotPath: "1700000000-pasted.jpg" }], pageTitle: "Demo", sections: [] } } });
      const imgs = findElements(after.tree, (element) => element.props?.className === "lr-node-img");
      harness.check("client: the card fetches and renders the pasted image under the pin",
        fetchCall !== undefined && fetchCall.headers["x-dsh-redline-secret"] === "a".repeat(64) && imgs.length === 1 && imgs[0]?.props?.src === "blob:stub-url",
        JSON.stringify({ fetch: fetchCall?.url, imgs: imgs.length }));
    } else harness.check("client: the card fetches and renders the pasted image under the pin", false, "chat node slot missing");
  }

  harness.section("client: the pending card exports the report");
  {
    const fetchCalls = [];
    let failing = false;
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const downloads = [];
    const created = [];
    const documentStub = {
      createElement(tag) {
        const node = { tag, href: "", download: "", click: () => downloads.push({ href: node.href, download: node.download }), style: {}, setAttribute() {} };
        created.push(node);
        return node;
      },
      documentElement: {},
      head: { appendChild() {} },
      body: { appendChild() {} },
      readyState: "complete",
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {}
    };
    const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
      react: stub.React,
      localStorage,
      console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
      document: documentStub,
      fetch: async (url, options) => {
        const target = String(url);
        if (target.includes("/.lr/report")) {
          fetchCalls.push({ url: target, headers: options?.headers ?? {}, format: new URL(target).searchParams.get("format") });
          if (failing) return jsonResponse({ ok: false }, 500);
          return jsonResponse({ ok: true, count: 0 });
        }
        if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
        if (target.includes("/.lr/pending")) return jsonResponse({ ok: true, count: 2, snapshotId: "snap-9", pageTitle: "Demo", pins: [{ id: "p1", index: 1, tag: "h1", comment: "c", selector: "body h1", component: "", text: "", role: "" }] });
        if (target.includes("/api/dsh-redline.secret")) return jsonResponse({ ok: true, secret: "a".repeat(64) });
        return jsonResponse({});
      }
    });
    const client = fakeClientCtx({});
    module.apply(client.ctx);
    client.resolve();
    await flush(4);
    const card = client.slots.find((slot) => slot.spec.id === "dsh-redline" && slot.spec.name === "conversation.input.dock");
    harness.check("the pending card registers in the dock", card !== undefined);
    harness.check("the pending card receives the composer session id", typeof card?.spec?.inject === "function" && card.spec.inject("session-visible").sessionId === "session-visible", JSON.stringify(typeof card?.spec?.inject));
    if (card !== undefined) {
      const first = renderOnce(stub, card.component, {});
      for (const effect of first.effects) effect();
      await flush(4);
      const open = renderOnce(stub, card.component, {});
      const summary = findElements(open.tree, (element) => element.props?.className === "lr-summary");
      if (summary.length === 1) {
        summary[0].props.onClick();
        await flush(2);
      }
      const expanded = renderOnce(stub, card.component, {});
      const mdButton = findElements(expanded.tree, (element) => element.props?.className === "lr-report-md");
      const jsonButton = findElements(expanded.tree, (element) => element.props?.className === "lr-report-json");
      harness.eq("the card exposes the two report buttons", mdButton.length + jsonButton.length, 2);
      if (mdButton.length === 1 && jsonButton.length === 1) {
        await mdButton[0].props.onClick();
        await jsonButton[0].props.onClick();
        await flush(3);
        const ok = fetchCalls.length === 2 && fetchCalls.every((call) => call.url.includes("/.lr/report?") && call.url.includes("format=") && call.headers["x-dsh-redline-secret"] === "a".repeat(64)) &&
          fetchCalls.some((call) => call.format === "md") && fetchCalls.some((call) => call.format === "json") &&
          downloads.length === 2 && downloads.every((entry) => String(entry.download).startsWith("redline-report-snap-9."));
        harness.check("client: export buttons request the report with the secret header and the requested format", ok, JSON.stringify({ calls: fetchCalls, downloads }));
        failing = true;
        fetchCalls.length = 0;
        downloads.length = 0;
        await mdButton[0].props.onClick();
        await flush(3);
        const failed = renderOnce(stub, card.component, {});
        const errorLine = findElements(failed.tree, (element) => element.props?.className === "lr-report-error");
        harness.check("client: export failure renders an inline error instead of a broken download",
          errorLine.length === 1 && typeof errorLine[0].props?.children === "string" && errorLine[0].props.children !== "reportFailed" && errorLine[0].props.children.includes("download failed") && downloads.length === 0,
          JSON.stringify({ error: errorLine.length, text: errorLine[0]?.props?.children, downloads: downloads.length }));
      }
    }
  }

  harness.section("client: overlay ux batch 2");
  {
    const fakeNode = (tag, attrs = {}, ...children) => {
      const node = { attrs, children: [], handlers: {}, removed: false, style: {}, append(child) { if (child !== null && child !== undefined) this.children.push(child); return child; }, addEventListener(type, fn) { this.handlers[type] = fn; }, remove() { this.removed = true; } };
      for (const [key, value] of Object.entries(attrs)) node[key === "class" ? "className" : key] = value;
      if (typeof node.style === "string") {
        const parsed = {};
        for (const declaration of node.style.split(";")) {
          const at = declaration.indexOf(":");
          if (at !== -1) parsed[declaration.slice(0, at).trim().replace(/-([a-z])/gu, (m, c) => c.toUpperCase())] = declaration.slice(at + 1).trim();
        }
        node.style = parsed;
      }
      for (const child of children) node.append(child);
      return node;
    };
    const spotlightRule = /\.lr-focus-spotlight \{[\s\S]*?\}/.exec(overlay)?.[0] ?? "";
    const hintRule = /\.lr-focus-hint \{[\s\S]*?\}/.exec(overlay)?.[0] ?? "";
    const bodyRule = /\.pin-bubble-body \{[^}]*\}/.exec(overlay)?.[0] ?? "";
    const panelSource = extractFunction(overlay, "renderPinPanel") ?? "";
    const escapeSource = extractFunction(overlay, "handleEscape") ?? "";
    const exitSource = extractFunction(overlay, "exitFocusMode") ?? "";
    const closePinSource = extractFunction(overlay, "closePinPanel") ?? "";
    const closePanelsSource = extractFunction(overlay, "closePanels") ?? "";
    const setHiddenSource = extractFunction(overlay, "setHidden") ?? "";
    const setModeSource = extractFunction(overlay, "setMode") ?? "";
    const pollSource = extractFunction(overlay, "pollStatus") ?? "";
    const openAuditSource = extractFunction(overlay, "openAuditPanel") ?? "";
    const fixSource = extractFunction(overlay, "showA11yFixPreview") ?? "";
    const postSource = extractFunction(overlay, "postSnapshot") ?? "";
    const guardAt = overlay.indexOf('if (tag === "INPUT" || tag === "TEXTAREA" || from?.isContentEditable === true) return;');
    const keydownAt = guardAt === -1 ? -1 : overlay.lastIndexOf('"keydown"', guardAt);
    const listenerSpan = keydownAt === -1 ? "" : overlay.slice(keydownAt, keydownAt + 3000);

    harness.check("overlay: pushToast appends exactly one toast item to the container it is handed", (() => {
      const pushRun = extractFunction(overlay, "pushToast") === undefined ? undefined : evaluateExpression(`(container, text, ms, makeItem, t, setTimeout) => {\n${extractFunction(overlay, "pushToast")}\nreturn pushToast(container, text, ms, makeItem);\n}`, "pushToast");
      const timers = [];
      const container = fakeNode({ style: "" });
      const item = pushRun === undefined ? undefined : pushRun(container, "saved", 3200, fakeNode, (key) => key, (fn, ms) => { timers.push({ fn, ms }); return timers.length; });
      return item !== undefined && container.children.length === 1 && container.children[0] === item && timers.length === 1 && timers[0].ms === 3200;
    })(), "one auto-dismissed item must land on the container");
    harness.check("overlay: the toast stack container ignores pointer events", (() => {
      const pushRun = extractFunction(overlay, "pushToast") === undefined ? undefined : evaluateExpression(`(container, text, ms, makeItem, t, setTimeout) => {\n${extractFunction(overlay, "pushToast")}\nreturn pushToast(container, text, ms, makeItem);\n}`, "pushToast");
      const container = fakeNode({ style: "" });
      const item = pushRun === undefined ? undefined : pushRun(container, "saved", 2600, fakeNode, (key) => key, () => 1);
      return item !== undefined && container.style.pointerEvents === "none";
    })(), "the stack must not swallow page clicks");
    harness.check("overlay: each toast item takes pointer events", (() => {
      const pushRun = extractFunction(overlay, "pushToast") === undefined ? undefined : evaluateExpression(`(container, text, ms, makeItem, t, setTimeout) => {\n${extractFunction(overlay, "pushToast")}\nreturn pushToast(container, text, ms, makeItem);\n}`, "pushToast");
      const container = fakeNode({ style: "" });
      const item = pushRun === undefined ? undefined : pushRun(container, "saved", 2600, fakeNode, (key) => key, () => 1);
      return item !== undefined && item.style.pointerEvents === "auto";
    })(), "the item must stay clickable for its dismiss control");
    harness.check("overlay: each toast item carries a dismiss control", (() => {
      const pushRun = extractFunction(overlay, "pushToast") === undefined ? undefined : evaluateExpression(`(container, text, ms, makeItem, t, setTimeout) => {\n${extractFunction(overlay, "pushToast")}\nreturn pushToast(container, text, ms, makeItem);\n}`, "pushToast");
      const container = fakeNode("div", { style: "" });
      const item = pushRun === undefined ? undefined : pushRun(container, "saved", 2600, fakeNode, (key) => key, () => 1);
      const dismiss = item === undefined ? undefined : item.children.find((child) => child.className === "lr-close");
      return item !== undefined && dismiss !== undefined && dismiss.children.includes("✕") && dismiss.type === "button";
    })(), "the ✕ dismiss button is missing");
    harness.check("overlay: toast items reuse the design system toast classes", (() => {
      const pushRun = extractFunction(overlay, "pushToast") === undefined ? undefined : evaluateExpression(`(container, text, ms, makeItem, t, setTimeout) => {\n${extractFunction(overlay, "pushToast")}\nreturn pushToast(container, text, ms, makeItem);\n}`, "pushToast");
      const container = fakeNode({ style: "" });
      const item = pushRun === undefined ? undefined : pushRun(container, "saved", 2600, fakeNode, (key) => key, () => 1);
      return item !== undefined && item.className === "toast toast-info";
    })(), "the item must carry the existing toast / toast-info classes");
    harness.check("overlay: the toast stack carries the lr-toast-stack class and is created when omitted", (() => {
      const pushRun = extractFunction(overlay, "pushToast") === undefined ? undefined : evaluateExpression(`(container, text, ms, makeItem, t, setTimeout) => {\n${extractFunction(overlay, "pushToast")}\nreturn pushToast(container, text, ms, makeItem);\n}`, "pushToast");
      const container = fakeNode("div", { style: "" });
      const item = pushRun === undefined ? undefined : pushRun(container, "saved", 2600, fakeNode, (key) => key, () => 1);
      const made = [];
      const spyFactory = (tag, attrs, ...rest) => { const node = fakeNode(tag, attrs, ...rest); made.push(node); return node; };
      const created = pushRun === undefined ? undefined : pushRun(null, "again", 2600, spyFactory, (key) => key, () => 1);
      const stack = made.find((node) => node.className === "lr-toast-stack");
      return item !== undefined && container.className === "lr-toast-stack" && created !== undefined &&
        stack !== undefined && stack.style.pointerEvents === "none" && stack.children.includes(created);
    })(), "the stack class must be pushToast's responsibility");
    {
      const toastFn = extractFunction(overlay, "toast") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "toast"), "toast");
      harness.eq("overlay: the public toast keeps the text-only required signature", toastFn === undefined ? -1 : toastFn.length, 1);
    }
    harness.check("overlay: toast(text) schedules dismissal at the 2600ms default via pushToast",
      overlay.includes("function toast(text, ms = 2600)") && (extractFunction(overlay, "toast") ?? "").includes("pushToast(toastStack, text, ms, el)"),
      "the default duration or the pushToast call drifted");
    harness.includes("overlay: the saved hint became a toast", overlay, 'toast(t("savedHint"), 4200)');
    harness.includes("overlay: the draw-sent hint became a toast", overlay, 'toast(t("drawSentHint"), 3600)');
    harness.excludes("overlay: the saved hint no longer goes through setHint", overlay, 'setHint(t("savedHint"), 4200)');
    harness.excludes("overlay: the draw-sent hint no longer goes through setHint", overlay, 'setHint(t("drawSentHint"), 3600)');
    harness.includes("overlay: the draw hint stays a mode hint", overlay, 'setHint(t("drawHint"), 2600)');

    {
      const rectFn = extractFunction(overlay, "focusSpotlightRect") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "focusSpotlightRect"), "focusSpotlightRect");
      const box = rectFn === undefined ? undefined : rectFn({ left: 100, top: 50, width: 200, height: 80 });
      harness.eq("overlay: the focus spotlight keeps the target's left", box?.left, 100);
      harness.eq("overlay: the focus spotlight keeps the target's top", box?.top, 50);
      harness.eq("overlay: the focus spotlight keeps the target's width", box?.width, 200);
      harness.eq("overlay: the focus spotlight keeps the target's height", box?.height, 80);
    }
    harness.check("overlay: the spotlight dims the page with a 100vmax spread", spotlightRule.includes("box-shadow: 0 0 0 100vmax"), spotlightRule.slice(0, 120));
    harness.check("overlay: the spotlight dim is the rgba(0,0,0,0.55) veil", spotlightRule.includes("rgba(0,0,0,0.55)"), spotlightRule.slice(0, 120));
    harness.check("overlay: the spotlight never swallows clicks", spotlightRule.includes("pointer-events: none"), spotlightRule.slice(0, 120));
    harness.includes("overlay: the Escape cascade is a named liftable function", overlay, "function handleEscape(");
    harness.check("overlay: the keydown listener dispatches Escape to handleEscape", listenerSpan.includes("handleEscape(event)"), JSON.stringify({ keydownAt, span: listenerSpan.length }));
    {
      const focusIdx = escapeSource.indexOf("if (focusState.current !== null)");
      const drawIdx = escapeSource.indexOf("if (drawMode)");
      harness.check("overlay: the focus branch is the first Escape branch", focusIdx !== -1 && drawIdx !== -1 && focusIdx < drawIdx, JSON.stringify({ focusIdx, drawIdx }));
    }
    {
      const adjustIdx = escapeSource.indexOf("if (adjustPanel !== null)");
      const bubbleIdx = escapeSource.indexOf("if (openPinId !== null)");
      harness.check("overlay: the bubble-close branch follows the adjust branch", adjustIdx !== -1 && bubbleIdx > adjustIdx, JSON.stringify({ adjustIdx, bubbleIdx }));
    }
    {
      const bubbleIdx = escapeSource.indexOf("if (openPinId !== null)");
      const auditIdx = escapeSource.indexOf("if (auditPanelNode !== null)");
      const draftIdx = escapeSource.indexOf("if (draft !== null)");
      harness.check("overlay: the bubble-close branch precedes the audit and draft branches", bubbleIdx !== -1 && draftIdx !== -1 && bubbleIdx < auditIdx && auditIdx < draftIdx, JSON.stringify({ bubbleIdx, auditIdx, draftIdx }));
    }
    {
      const dispatch = exitSource === "" || escapeSource === "" ? undefined : evaluateExpression(`(focusState, focusSpotlightNode, focusHintNode, focusRepositionTimer, clearTimeout, drawMode, groupMode, adjustPanel, openPinId, pinPanelNode, auditPanelNode, draft, mode, a11yFixHandler, toggleDraw, setGroupMode, closeAdjustPanel, closeAuditPanel, discardDraft, setMode, gridStepper, closeGridStepper, resetMeter) => {
${exitSource}
${escapeSource}
return { handleEscape, state: () => ({ focusState, openPinId, pinPanelNode, a11yFixHandler }) };
}`, "handleEscape");
      const noops = [() => {}, () => {}, () => {}, () => {}, () => {}, () => {}];
      const runFocus = dispatch === undefined ? undefined : dispatch({ current: { selector: "#x" } }, null, null, null, () => {}, false, false, null, null, null, null, null, null, { current: null }, ...noops, null, () => {}, () => {});
      const consumed = runFocus === undefined ? undefined : runFocus.handleEscape({ key: "Escape" });
      harness.check("overlay: Escape under focus mode exits focus and is consumed",
        consumed === true && runFocus !== undefined && runFocus.state().focusState.current === null,
        JSON.stringify({ consumed, focus: runFocus?.state().focusState.current }));
      const bubbleNode = fakeNode();
      const runBubble = dispatch === undefined ? undefined : dispatch({ current: null }, null, null, null, () => {}, false, false, null, "pin-1", bubbleNode, null, null, null, { current: { ensurePin: () => {} } }, ...noops, null, () => {}, () => {});
      const consumedBubble = runBubble === undefined ? undefined : runBubble.handleEscape({ key: "Escape" });
      harness.check("overlay: Escape with the bubble open closes it and is consumed",
        consumedBubble === true && runBubble !== undefined && runBubble.state().openPinId === null && bubbleNode.removed === true && runBubble.state().a11yFixHandler.current === null,
        JSON.stringify({ consumed: consumedBubble, openPinId: runBubble?.state().openPinId, removed: bubbleNode.removed }));
    }
    {
      const exitFn = exitSource === "" ? undefined : evaluateExpression(`(focusState, focusSpotlightNode, focusHintNode, focusRepositionTimer, clearTimeout) => {
${exitSource}
exitFocusMode();
return { focusState, timer: focusRepositionTimer };
}`, "exitFocusMode");
      const cleared = [];
      const run = exitFn === undefined ? undefined : exitFn({ current: { selector: "#x" } }, null, null, null, () => {});
      const runTimer = exitFn === undefined ? undefined : exitFn({ current: { selector: "#y" } }, null, null, 7, (handle) => cleared.push(handle));
      harness.check("overlay: exitFocusMode clears the focus state and tolerates null handles",
        run !== undefined && run.focusState.current === null && runTimer !== undefined && runTimer.focusState.current === null && JSON.stringify(cleared) === JSON.stringify([7]),
        JSON.stringify({ focus: run?.focusState.current, cleared }));
    }
    {
      const resolveIdx = panelSource.indexOf('pin.status = pin.status === "resolvido" ? "queued" : "resolvido";');
      const resolveSpan = resolveIdx === -1 ? "" : panelSource.slice(resolveIdx, resolveIdx + 300);
      const deleteIdx = panelSource.indexOf("pins = pins.filter((x) => x !== pin);");
      const deleteSpan = deleteIdx === -1 ? "" : panelSource.slice(deleteIdx, deleteIdx + 300);
      const paths = [closePinSource, resolveSpan, deleteSpan, closePanelsSource, setHiddenSource];
      harness.check("overlay: every focus teardown path calls exitFocusMode and none removes the layer by hand",
        paths.every((span) => span.includes("exitFocusMode()")) &&
        [closePinSource, closePanelsSource, setHiddenSource, panelSource].every((span) => !span.includes('class: "lr-focus-spotlight"')) &&
        (overlay.match(/focusSpotlightNode\?\.remove\(\)/gu) ?? []).length === 1,
        JSON.stringify(paths.map((span) => span.includes("exitFocusMode()"))));
    }
    harness.check("overlay: the bubble close tears down the focus layer", closePinSource.includes("exitFocusMode()"), "closePinPanel must call exitFocusMode");
    harness.check("overlay: resolving a pin tears down the focus layer", (() => {
      const resolveIdx = panelSource.indexOf('pin.status = pin.status === "resolvido" ? "queued" : "resolvido";');
      const resolveSpan = resolveIdx === -1 ? "" : panelSource.slice(resolveIdx, resolveIdx + 300);
      return resolveSpan.includes("exitFocusMode()");
    })(), "the resolve handler must call exitFocusMode");
    harness.check("overlay: deleting a pin tears down the focus layer", (() => {
      const deleteIdx = panelSource.indexOf("pins = pins.filter((x) => x !== pin);");
      const deleteSpan = deleteIdx === -1 ? "" : panelSource.slice(deleteIdx, deleteIdx + 300);
      return deleteSpan.includes("exitFocusMode()");
    })(), "the delete handler must call exitFocusMode");
    harness.check("overlay: closePanels tears down the focus layer", closePanelsSource.includes("exitFocusMode()"), "closePanels must call exitFocusMode");
    harness.check("overlay: hiding the pins tears down the focus layer", setHiddenSource.includes("exitFocusMode()"), "setHidden(true) must call exitFocusMode");
    {
      const focusSources = ["enterFocusMode", "toggleFocusMode", "exitFocusMode", "repositionFocus"].map((name) => extractFunction(overlay, name) ?? "").join("");
      harness.check("overlay: focus mode installs no blocking click handler",
        focusSources !== "" && !focusSources.includes('addEventListener("click"') && !focusSources.includes("capture"),
        "the page must stay interactive under the spotlight");
    }
    harness.check("overlay: the focus hint bar is inert except for its close control",
      hintRule.includes("pointer-events: none") && overlay.includes(".lr-focus-hint .lr-close { pointer-events: auto"),
      JSON.stringify({ hint: hintRule.slice(0, 120) }));

    {
      const countFn = extractFunction(overlay, "countSelectorMatches") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "countSelectorMatches"), "countSelectorMatches");
      harness.eq("overlay: countSelectorMatches counts the matches for a valid selector", countFn === undefined ? -1 : countFn("#x", () => [1, 2, 3]), 3);
      harness.eq("overlay: countSelectorMatches answers 0 instead of throwing on a broken query", countFn === undefined ? -1 : countFn("#x", () => { throw new Error("bad selector"); }), 0);
    }
    harness.check("overlay: the bubble warns about an ambiguous selector only above one match",
      panelSource.includes("countSelectorMatches(pin.selector") && panelSource.includes('ambiguousCount > 1 ? el("div", { class: "pin-bubble-warning" }'),
      "the warning must key on a count greater than one");

    {
      const parseColorFn = evaluateExpression(`(${extractFunction(overlay, "parseColor")})`, "parseColor");
      const hexFn = evaluateExpression(`(${extractFunction(overlay, "hexOf")})`, "hexOf");
      const lumFn = evaluateExpression(`(${extractFunction(overlay, "relativeLuminance")})`, "relativeLuminance");
      const ratioFn = evaluateExpression(`(parseColor, relativeLuminance) => {\n${extractFunction(overlay, "contrastRatio")}\nreturn contrastRatio;\n}`, "contrastRatio")(parseColorFn, lumFn);
      const blendFn = evaluateExpression(`(${extractFunction(overlay, "blendColor")})`, "blendColor");
      const proposeFn = evaluateExpression(`(parseColor, hexOf, contrastRatio, blendColor, relativeLuminance) => {\n${extractFunction(overlay, "proposeContrastFix")}\nreturn proposeContrastFix;\n}`, "proposeContrastFix")(parseColorFn, hexFn, ratioFn, blendFn, lumFn);
      const white = parseColorFn("rgb(255, 255, 255)");
      const proposal = proposeFn === undefined ? undefined : proposeFn("rgb(136, 136, 136)", "rgb(255, 255, 255)");
      harness.check("overlay: the contrast fix reaches the 4.5 threshold",
        proposal !== null && proposal !== undefined && proposal.ratioAfter >= 4.5 && ratioFn(parseColorFn(proposal.after), white) >= 4.5,
        JSON.stringify(proposal ?? null));
      harness.eq("overlay: the contrast fix records the original colour as before", proposal?.before, "#888888");
      harness.check("overlay: the contrast fix records the proposed colour as after",
        proposal !== null && proposal !== undefined && /^#[\da-f]{6}$/iu.test(proposal.after) && proposal.after !== proposal.before,
        JSON.stringify(proposal ?? null));
      harness.check("overlay: the contrast fix is the smallest blend that reaches the threshold",
        proposal !== null && proposal !== undefined && ratioFn(blendFn(parseColorFn(proposal.after), parseColorFn(proposal.before), 0.5), white) < 4.5,
        "blending the proposal halfway back must fall below the threshold");
      harness.check("overlay: the contrast fix is refused when no proposal can reach the threshold",
        proposeFn !== undefined && proposeFn("#888888", "rgba(255, 255, 255, 0.5)") === null && proposeFn("#000000", "#ffffff") === null,
        "a transparent background and an already-passing pair must yield null");
      const deriveAlt = extractFunction(overlay, "deriveAltText") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "deriveAltText"), "deriveAltText");
      harness.eq("overlay: deriveAltText prefers the alt attribute", deriveAlt === undefined ? null : deriveAlt({ alt: "Photo of a bridge", ariaLabel: "", title: "", src: "" }), "Photo of a bridge");
      harness.check("overlay: deriveAltText falls back through aria-label, title, the src basename and the empty string",
        deriveAlt !== undefined && deriveAlt({ alt: "", ariaLabel: "Upload", title: "T", src: "" }) === "Upload" &&
        deriveAlt({ alt: "", ariaLabel: "", title: "T", src: "" }) === "T" &&
        deriveAlt({ alt: "", ariaLabel: "", title: "", src: "https://x/y/photo.png" }) === "photo.png" &&
        deriveAlt({}) === "",
        JSON.stringify({ aria: deriveAlt?.({ alt: "", ariaLabel: "Upload", title: "T", src: "" }), src: deriveAlt?.({ alt: "", ariaLabel: "", title: "", src: "https://x/y/photo.png" }) }));
      harness.check("overlay: the recorded alt fix carries the imgAlt check",
        fixSource.includes('pin.fixes.push({ check: "imgAlt"'),
        "the alt fix entry shape drifted");
      harness.check("overlay: the recorded alt fix entry has a null prop",
        fixSource.includes('check: "imgAlt", prop: null'),
        "an attribute fix must carry prop === null");
      harness.check("overlay: the recorded alt fix value is derived and non-empty",
        fixSource.includes("field.value = deriveAltText(") && deriveAlt !== undefined && deriveAlt({ alt: "Photo of a bridge" }).length > 0,
        "the alt proposal must flow from deriveAltText");
      harness.check("overlay: the fix affordance exists only for contrast and imgAlt",
        overlay.includes('const A11Y_FIXABLE_CHECKS = new Set(["contrast", "imgAlt"])') &&
        (extractFunction(overlay, "a11yAuditSection") ?? "").includes("A11Y_FIXABLE_CHECKS.has(row.check)") &&
        openAuditSource.includes("A11Y_FIXABLE_CHECKS.has(group.check)"),
        "name, role and targetSize must stay unfixed");
      harness.check("overlay: an applied fix is recorded on the pin, not in a session store",
        (fixSource.match(/pin\.fixes\.push\(\{ check:/gu) ?? []).length === 2 && fixSource.includes("handler.ensurePin("),
        "both fix paths must push onto the pin's own fixes array");
      const capturedFixes = [{ check: "contrast", prop: "color", before: "#888888", after: "#767676" }];
      let fixCaptured = null;
      const fixBridgeSend = async (type, payload) => { fixCaptured = payload; return { ok: true }; };
      if (postSource !== undefined) {
        const post = evaluateExpression(`(bridgeSend, pins, PAGE_URL, document, setHint, updateToolbar, toast, t) => {\n${postSource}\nreturn postSnapshot();\n}`, "postSnapshot");
        await post(fixBridgeSend, [{ id: "fx", tag: "h1", selector: "#fx", comment: "c", changes: [], status: "queued", fixes: capturedFixes }], "http://page/", { title: "T" }, () => {}, () => {}, () => {}, (key) => key);
      }
      harness.check("overlay: the snapshot payload carries no session-level fixes field",
        fixCaptured !== null && fixCaptured.fixes === undefined && Array.isArray(fixCaptured.pins),
        JSON.stringify({ topKeys: fixCaptured === null ? null : Object.keys(fixCaptured) }));
      harness.check("overlay: the fix never touches pin.changes or pin.textChange",
        !fixSource.includes("pin.changes") && !fixSource.includes("textChange"),
        "changes renders as CSS and textChange is text only");
      harness.check("overlay: postSnapshot transmits the pin's fixes",
        postSource.includes("fixes: p.fixes ?? []") && fixCaptured !== null && JSON.stringify(fixCaptured.pins?.[0]?.fixes) === JSON.stringify(capturedFixes),
        JSON.stringify(fixCaptured?.pins?.[0]?.fixes ?? null));
    }

    {
      const rowLabels = evaluateObjectLiteral(extractObjectLiteral(overlay, "const A11Y_ROW_LABELS"), "A11Y_ROW_LABELS");
      const groupTitles = evaluateObjectLiteral(extractObjectLiteral(overlay, "const A11Y_GROUP_TITLES"), "A11Y_GROUP_TITLES");
      const groupFn = rowLabels === undefined || groupTitles === undefined ? undefined : evaluateExpression(`(A11Y_ROW_LABELS, A11Y_GROUP_TITLES) => {\n${extractFunction(overlay, "groupAuditFindings")}\nreturn groupAuditFindings;\n}`, "groupAuditFindings")(rowLabels, groupTitles);
      const fixture = [
        { check: "contrast", status: "fail", value: "2.31" },
        { check: "contrast", status: "warn", value: "none" },
        { check: "imgAlt", status: "fail", value: "" },
        { check: "name", status: "fail", value: "" },
        { check: "role", status: "warn", value: "none" },
        { check: "targetSize", status: "unknown", value: "?" }
      ];
      const groups = groupFn === undefined ? undefined : groupFn(fixture);
      harness.check("overlay: audit findings group by the five check types",
        groups !== undefined && JSON.stringify(groups.map((group) => group.check)) === JSON.stringify(["contrast", "imgAlt", "name"]),
        JSON.stringify(groups?.map((group) => group.check) ?? null));
      harness.check("overlay: each audit group carries its own count",
        groups !== undefined && groups.length === 3 && groups.every((group) => group.findings.length > 0 && typeof group.label === "string" && typeof group.title === "string"),
        JSON.stringify(groups?.map((group) => ({ check: group.check, count: group.findings.length })) ?? null));
      harness.check("overlay: only fail rows count as findings",
        groups !== undefined && groups.reduce((total, group) => total + group.findings.length, 0) === 3,
        "warn, unknown and n/a rows must not be counted");
      const pickFn = extractFunction(overlay, "pickAuditCandidates") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "pickAuditCandidates"), "pickAuditCandidates");
      harness.eq("overlay: the audit inspection list truncates to the 400 cap", pickFn === undefined ? -1 : pickFn(Array.from({ length: 500 }, (_, index) => ({ index })), 400).length, 400);
      harness.check("overlay: the inspected count never exceeds the collected candidates",
        pickFn !== undefined && pickFn(Array.from({ length: 10 }, (_, index) => ({ index })), 400).length === 10 && pickFn([], 400).length === 0,
        "a short candidate list must survive the cap");
      {
        const ElementClass = class Element {};
        const makeAuditEl = (childNodes = [], children = []) => {
          const node = new ElementClass();
          node.nodeType = 1;
          node.childNodes = childNodes;
          node.children = children;
          return node;
        };
        const textNode = (data) => ({ nodeType: 3, data });
        const direct = makeAuditEl([textNode("  hi  ")]);
        const deep = makeAuditEl([], [makeAuditEl([textNode("nested")])]);
        const root = makeAuditEl([], [direct, deep]);
        const btn = makeAuditEl();
        const collectFn = extractFunction(overlay, "collectAuditCandidates") === undefined ? undefined : evaluateExpression(`(Element, interactive, images, semantic, textBearing, walkBudget) => {\n${extractFunction(overlay, "collectAuditCandidates")}\nreturn collectAuditCandidates({ interactive, images, semantic, textBearing }, walkBudget);\n}`, "collectAuditCandidates");
        const candidates = collectFn === undefined ? undefined : collectFn(ElementClass, () => [btn], () => [], () => [btn], () => root, 400);
        const bounded = collectFn === undefined ? undefined : collectFn(ElementClass, () => [], () => [], () => [], () => root, 2);
        harness.check("overlay: the text-bearing family reads direct child text nodes, not textContent",
          candidates !== undefined && candidates.includes(direct) && candidates.includes(deep.children[0]) && !candidates.includes(deep) && !candidates.includes(root),
          JSON.stringify({ count: candidates?.length }));
        harness.check("overlay: audit candidates are deduped across the four families",
          candidates !== undefined && candidates.filter((element) => element === btn).length === 1 && candidates.length === 3,
          JSON.stringify({ count: candidates?.length, btnCopies: candidates?.filter((element) => element === btn).length }));
        harness.check("overlay: the text-bearing walk honours its node budget",
          bounded !== undefined && !bounded.includes(deep.children[0]) && bounded.includes(direct),
          JSON.stringify({ count: bounded?.length }));
      }
      {
        const familySelectors = evaluateObjectLiteral(extractObjectLiteral(overlay, "const A11Y_AUDIT_FAMILY_SELECTORS"), "A11Y_AUDIT_FAMILY_SELECTORS");
        const interactiveSelector = "button, a, input, select, textarea, [contenteditable]";
        harness.check("overlay: the interactive audit family reuses the interactive-target selector",
          familySelectors !== undefined && familySelectors.interactive === interactiveSelector &&
          (extractFunction(overlay, "isInteractivePanelTarget") ?? "").includes(interactiveSelector),
          JSON.stringify(familySelectors ?? null));
        const semanticTags = JSON.parse(/const A11Y_SEMANTIC_TAGS = new Set\((\[[^\]]*\])\)/.exec(overlay)?.[1] ?? "[]");
        const semanticList = typeof familySelectors?.semantic === "string" ? familySelectors.semantic.split(",").map((tag) => tag.trim()) : [];
        harness.check("overlay: the semantic audit family reuses the semantic tag set",
          semanticTags.length > 0 && semanticList.length > 0 && semanticList.every((tag) => semanticTags.includes(tag)) && familySelectors.images === "img",
          JSON.stringify({ semantic: semanticList, tags: semanticTags.length }));
      }
    }
    harness.check("overlay: the page audit opens its own panel node, not the pin bubble",
      openAuditSource.includes("auditPanelNode = panel") && !openAuditSource.includes("pinPanelNode") &&
      openAuditSource.includes("fixedLayer.append(panel)") && overlay.includes("lr-audit-panel"),
      "the audit panel must mount on the fixed layer as its own node");

    {
      const insertFn = extractFunction(overlay, "insertAtCaret") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "insertAtCaret"), "insertAtCaret");
      const atCaret = insertFn === undefined ? undefined : insertFn({ value: "hello world", selectionStart: 5, selectionEnd: 5 }, "X");
      harness.check("overlay: a template inserts at the caret", atCaret !== undefined && atCaret.value === "helloX world" && atCaret.selectionStart === 5, JSON.stringify(atCaret ?? null));
      const replaced = insertFn === undefined ? undefined : insertFn({ value: "abcdef", selectionStart: 2, selectionEnd: 5 }, "Z");
      harness.check("overlay: a template replaces the selection and brackets it in the returned range",
        replaced !== undefined && replaced.value === "abZf" && replaced.selectionStart === 2 && replaced.selectionEnd === 3, JSON.stringify(replaced ?? null));
      const dictionaries = evaluateObjectLiteral(extractObjectLiteral(overlay, "const UI_LOCALES"), "UI_LOCALES");
      const templateKeys = ["templatesLabel", "templateAlignDesign", "templateReduceSpacing", "templateIncreaseContrast", "templateFixOverflow", "templateExplainWhy"];
      const templateMissing = [];
      for (const code of ["en", "pt", "zh"]) {
        for (const key of templateKeys) {
          const value = dictionaries?.[code]?.[key];
          if (typeof value !== "string" || value === "") templateMissing.push(`${code}:${key}`);
        }
      }
      harness.check("overlay: the five comment templates exist in all three languages", templateMissing.length === 0, templateMissing.slice(0, 6).join(", "));
      const templateRowSource = extractFunction(overlay, "renderTemplateRow");
      harness.check("overlay: the template popup dismiss resolves shadow-retargeted events through composedPath",
        templateRowSource !== undefined && templateRowSource.includes("composedPath?.()") &&
        !templateRowSource.includes("contains(event.target)"),
        templateRowSource === undefined ? "renderTemplateRow missing" : "dismiss still keys on event.target");
      const insertSource = extractFunction(overlay, "insertAtCaret") ?? "";
      harness.check("overlay: insertAtCaret is liftable and returns the one caret shape",
        insertSource !== "" && !insertSource.includes("document") && !insertSource.includes("window") &&
        atCaret !== undefined && JSON.stringify(Object.keys(atCaret).sort()) === JSON.stringify(["selectionEnd", "selectionStart", "value"]),
        JSON.stringify(Object.keys(atCaret ?? {}).sort()));
    }

    {
      const buildFn = extractFunction(overlay, "buildDuplicatePin") === undefined ? undefined : evaluateExpression(extractFunction(overlay, "buildDuplicatePin"), "buildDuplicatePin");
      const source = { id: "src-1", comment: "Align this", changes: [{ prop: "color", before: "#000000", after: "#111111" }, { prop: "font-size", before: "16px", after: "18px" }], pageUrl: "http://page/", selector: "#old", tag: "h1", rect: { x: 0, y: 0, w: 10, h: 10 }, shot: "old-shot" };
      const target = { selector: "#new", tag: "p", role: "button", label: "New label", text: "Body", component: "Card", rect: { x: 1, y: 2, w: 30, h: 40 }, offsets: { ox: 5, oy: 6 } };
      const readBeforeCalls = [];
      const readBefore = (prop) => { readBeforeCalls.push(prop); return prop === "color" ? "#ffffff" : "14px"; };
      const dup = buildFn === undefined ? undefined : buildFn(source, target, "new-id", readBefore);
      harness.check("overlay: the duplicate carries the injected fresh id", dup !== undefined && dup.id === "new-id" && dup.id !== source.id, JSON.stringify({ id: dup?.id }));
      harness.check("overlay: the duplicate takes its own descriptor from the new element",
        dup !== undefined && dup.selector === "#new" && dup.tag === "p" && dup.label === "New label" && dup.component === "Card" &&
        JSON.stringify(dup.rect) === JSON.stringify(target.rect) && JSON.stringify(dup.offsets) === JSON.stringify(target.offsets),
        JSON.stringify(dup ?? null));
      harness.eq("overlay: the duplicate copies the comment verbatim", dup?.comment, "Align this");
      harness.check("overlay: the duplicate carries the source after values over",
        dup !== undefined && dup.changes[0].after === "#111111" && dup.changes[1].after === "18px",
        JSON.stringify(dup?.changes ?? null));
      harness.check("overlay: the duplicate re-reads before from the new target",
        dup !== undefined && dup.changes[0].before === "#ffffff" && dup.changes[1].before === "14px" &&
        JSON.stringify(readBeforeCalls.slice().sort()) === JSON.stringify(["color", "font-size"]),
        JSON.stringify({ changes: dup?.changes, read: readBeforeCalls }));
      harness.check("overlay: the source pin is untouched by a duplicate",
        source.changes[0].before === "#000000" && source.shot === "old-shot" && source.comment === "Align this" && source.id === "src-1",
        JSON.stringify(source));
      const createDupSource = extractFunction(overlay, "createDuplicatePin") ?? "";
      harness.check("overlay: the duplicate applies no live style and starts with no screenshot",
        dup !== undefined && dup.shot === null && createDupSource !== "" && !createDupSource.includes(".style"),
        JSON.stringify({ shot: dup?.shot, mutatesStyle: createDupSource.includes(".style") }));
      harness.check("overlay: the Duplicate action arms the flag and reuses the picking mode", (() => {
        const dupIdx = panelSource.indexOf("duplicateArmed = pin;");
        const dupSpan = dupIdx === -1 ? "" : panelSource.slice(dupIdx, dupIdx + 200);
        return dupSpan.includes('setMode("picking")') && dupSpan.includes('t("duplicateHint")');
      })(), "the duplicate must reuse setMode(\"picking\")");
      harness.check("overlay: the duplicate produces the standard pin shape and never the canvas shape",
        dup !== undefined && JSON.stringify(Object.keys(dup).sort()) === JSON.stringify(["changes", "comment", "component", "id", "label", "offsets", "pageUrl", "rect", "role", "selector", "shot", "status", "tag", "text"]) &&
        dup.offsets !== null && overlay.includes('selector: "canvas:drawing"') && !(extractFunction(overlay, "buildDuplicatePin") ?? "").includes("canvas"),
        JSON.stringify(Object.keys(dup ?? {}).sort()));
      harness.check("overlay: the duplicate flag is spent before the branch does any work",
        createDupSource !== "" && createDupSource.indexOf("duplicateArmed = null;") !== -1 &&
        createDupSource.indexOf("duplicateArmed = null;") < createDupSource.indexOf("if (source === null) return;"),
        createDupSource.slice(0, 120));
      harness.check("overlay: Escape clears the duplicate flag through the picking exit",
        escapeSource.includes("setMode(null)") && setModeSource.includes('duplicateArmed = null') && setModeSource.includes('mode !== "picking"'),
        "the flag must clear when picking mode ends");
    }

    harness.check("overlay: the Resolve button posts the snapshot after marking the pin resolved", (() => {
      const resolveIdx = panelSource.indexOf('pin.status = pin.status === "resolvido" ? "queued" : "resolvido";');
      const resolveSpan = resolveIdx === -1 ? "" : panelSource.slice(resolveIdx, resolveIdx + 300);
      return resolveSpan.includes("savePins();") && resolveSpan.indexOf("postSnapshot()") > resolveSpan.indexOf("pin.status =");
    })(), "the host cannot drop a resolved pin it never receives");
    {
      const reconcile = extractFunction(overlay, "reconcileWithHost") === undefined ? undefined : evaluateExpression(`(pins, savePins) => {\n${extractFunction(overlay, "reconcileWithHost")}\nreturn (ids, resolvedIds) => { reconcileWithHost(ids, resolvedIds); return pins; };\n}`, "reconcileWithHost");
      const savedCalls = [];
      const keepPins = [{ id: "p1", status: "queued", at: 0 }];
      const kept = reconcile === undefined ? undefined : reconcile(keepPins, () => savedCalls.push(1));
      const after = kept === undefined ? undefined : kept(["p1"], ["p1"]);
      harness.check("overlay: reconcileWithHost keeps a resolved pin instead of deleting it as unknown",
        after !== undefined && after.length === 1 && after[0].id === "p1" && savedCalls.length === 1,
        JSON.stringify({ kept: after?.length, saved: savedCalls.length }));
      harness.eq("overlay: the kept pin's status becomes resolvido", after?.[0]?.status, "resolvido");
    }
    harness.check("overlay: pollStatus still removes queued pins by delivered id", pollSource.includes("data.deliveredIds") && pollSource.includes("gone.has(p.id)"), "the delivered-removal rule drifted");
    harness.check("overlay: pollStatus keys removal on delivered ids, not on a delivered timestamp", pollSource.includes("data.deliveredIds") && pollSource.includes("gone.has(p.id)") && !pollSource.includes("deliveredAt"), "deliveredAt leaked into pollStatus");

    harness.check("overlay: the pin-bubble action row wraps inside the 320px panel", overlay.includes(".pin-bubble-actions { display: flex; flex-wrap: wrap;"), "flex-wrap is missing");
    harness.check("overlay: the bubble placement measures the rendered panel height", panelSource.includes("panel.offsetHeight") && !panelSource.includes("innerHeight - 280"), "the placement clamp still uses the hard-coded budget");
    harness.check("overlay: the bubble body scrolls instead of overflowing", bodyRule.includes("max-height") && bodyRule.includes("overflow: auto"), bodyRule);
    harness.includes("overlay: the bubble close control uses the lr-close class", panelSource, 'class: "lr-close"');
    harness.includes("overlay: the bubble close control keeps the panelClose title", panelSource, 'title: t("panelClose")');
    harness.includes("overlay: the bubble close control is a button", panelSource, 'type: "button"');
    harness.check("overlay: the focus spotlight keeps its class name", spotlightRule !== "" && overlay.includes('class: "lr-focus-spotlight"'), "the spotlight rule or node is missing");
    harness.check("overlay: the focus hint bar keeps its class name", hintRule !== "" && overlay.includes('class: "lr-focus-hint"'), "the hint rule or node is missing");

    harness.check("overlay: the three original panels keep their drag wiring",
      ["composerNode, \"composer\"", "panel, \"pin\"", "panel, \"adjust\""].every((call) => overlay.includes(`wirePanelDrag(${call}`)),
      "one of the pinned drag wirings is gone");
    harness.check("overlay: the pinned close-button markup is unchanged",
      overlay.includes('class: "lr-close", title: t("composerClose"), type: "button"') && overlay.includes('class: "lr-close", title: t("panelClose"), type: "button"'),
      "the pinned close-button shape drifted");
    {
      const anchorSource = extractFunction(overlay, "anchorPoint");
      harness.check("overlay: the pin anchor is still viewport-based", anchorSource !== undefined && !anchorSource.includes("scrollX") && !anchorSource.includes("scrollY"), anchorSource === undefined ? "anchorPoint missing" : "anchorPoint still adds scroll offsets");
    }
    {
      const repositionSource = extractFunction(overlay, "repositionPins");
      harness.check("overlay: repositioning the page still does not rebuild the comment draft", repositionSource !== undefined && !repositionSource.includes("renderDraft("), repositionSource === undefined ? "repositionPins missing" : "repositionPins still calls renderDraft");
    }
    harness.check("overlay: pollStatus keeps its delivered-removal shape",
      pollSource.includes("data.deliveredIds") && pollSource.includes("gone.has(p.id)") && !pollSource.includes("deliveredAt"),
      "the pinned pollStatus shape drifted");
    {
      const handler = /if \(hotkeyMatches\(event, hotkeyComment\)\)[\s\S]*?else if \(hotkeyMatches\(event, hotkeyHidePins\)\)[^\n]*/.exec(overlay)?.[0] ?? "";
      const chain = handler.match(/hotkeyMatches\(event, hotkey(Comment|Adjust|Draw|HidePins)\)/gu) ?? [];
      harness.check("overlay: the keydown hotkey chain keeps its four matches and three else-if arms",
        chain.length === 4 && (handler.match(/\belse if\b/gu) ?? []).length === 3 && handler.includes("setHidden(!hidden)"),
        JSON.stringify({ matches: chain.length, arms: (handler.match(/\belse if\b/gu) ?? []).length }));
    }
    harness.check("overlay: the keydown handler never compares the hotkey key on its own", !/event\.key === key(Comment|Adjust|Draw)/u.test(overlay), "a raw event.key comparison would ignore the modifiers");
    harness.check("overlay: the inspector undo shortcut ordering is unchanged", (() => {
      const undoAt = guardAt === -1 ? -1 : overlay.indexOf("adjustUndo();", guardAt);
      const closeAdjustSource = extractFunction(overlay, "closeAdjustPanel") ?? "";
      return guardAt !== -1 && undoAt > guardAt && keydownAt !== -1 && overlay.slice(keydownAt, undoAt).includes("adjustPanel !== null") &&
        closeAdjustSource.includes("adjustUndoStack = []") && closeAdjustSource.includes("adjustRedoStack = []");
    })(), JSON.stringify({ guardAt, keydownAt }));
    {
      const buildCssPatch = evaluateExpression(extractFunction(overlay, "buildCssPatch"), "buildCssPatch");
      const copySource = extractFunction(overlay, "copyCssPatch");
      const copy = copySource === undefined ? undefined : evaluateExpression(`(navigator, toast, t, buildCssPatch, pin) => {\n${copySource}\ncopyCssPatch(pin);\n}`, "copyCssPatch");
      const written = [];
      const toasts = [];
      const failingToasts = [];
      const pin = { selector: "body h1", changes: [{ prop: "color", before: "#000", after: "red" }] };
      if (copy !== undefined) copy({ clipboard: { writeText: async (text) => { written.push(text); } } }, (text) => toasts.push(text), (key) => key, buildCssPatch, pin);
      if (copy !== undefined) copy({ clipboard: { writeText: async () => { throw new Error("denied"); } } }, (text) => failingToasts.push(text), (key) => key, buildCssPatch, pin);
      await flush();
      harness.check("overlay: the css copy helper still toasts through the injected toast",
        copy !== undefined && JSON.stringify(written) === JSON.stringify(["body h1 { color: red; }"]) &&
        JSON.stringify(toasts) === JSON.stringify(["cssCopied"]) && JSON.stringify(failingToasts) === JSON.stringify(["cssCopyFailed"]),
        JSON.stringify({ written, toasts, failingToasts }));
    }
    {
      const copySource = extractFunction(overlay, "copySelectorText");
      const copy = copySource === undefined ? undefined : evaluateExpression(`(navigator, toast, t, pin) => {\n${copySource}\ncopySelectorText(pin);\n}`, "copySelectorText");
      const written = [];
      const toasts = [];
      const failingToasts = [];
      if (copy !== undefined) copy({ clipboard: { writeText: async (text) => { written.push(text); } } }, (text) => toasts.push(text), (key) => key, { selector: "#target > .card" });
      if (copy !== undefined) copy({ clipboard: { writeText: async () => { throw new Error("denied"); } } }, (text) => failingToasts.push(text), (key) => key, { selector: "#target > .card" });
      if (copy !== undefined) copy({ clipboard: undefined }, (text) => failingToasts.push(text), (key) => key, { selector: "#target > .card" });
      await flush();
      harness.check("overlay: the selector copy helper still toasts through the injected toast on both failure paths",
        copy !== undefined && JSON.stringify(written) === JSON.stringify(["#target > .card"]) && JSON.stringify(toasts) === JSON.stringify(["selectorCopied"]) &&
        JSON.stringify(failingToasts) === JSON.stringify(["cssCopyFailed", "cssCopyFailed"]),
        JSON.stringify({ written, toasts, failingToasts }));
    }
  }

  harness.section("client: dock ux batch 2");
  {
    const textWithin = (root, className) => {
      const hit = findByClass(root, className)[0];
      return hit === undefined ? "" : findElements(hit, (element) => typeof element.props?.children === "string").map((element) => element.props.children).join(" ");
    };

    // C1-C4: the bulk selection, the bulk request and the notice strip.
    {
      const createdTags = [];
      const appendedTags = [];
      const appendedBodies = [];
      const documentStub = {
        createElement(tag) {
          createdTags.push(tag);
          return { tag, href: "", download: "", click: () => {}, style: {}, setAttribute() {}, appendChild() {}, remove() {} };
        },
        documentElement: {},
        head: { appendChild(node) { appendedTags.push(node?.tag ?? ""); } },
        body: { appendChild(node) { appendedBodies.push(node?.tag ?? ""); } },
        readyState: "complete",
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {}
      };
      const fetchCalls = [];
      let bulkFailing = false;
      const stub = createReactStub();
      const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
        react: stub.React,
        localStorage: makeLocalStorage(),
        document: documentStub,
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, options) => {
          const target = String(url);
          fetchCalls.push({ url: target, headers: options?.headers ?? {}, method: options?.method ?? "GET", body: options?.body ?? null });
          if (target === "/api/dsh-redline.secret") return jsonResponse({ ok: true, secret: "a".repeat(64) });
          if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
          if (target.includes("/.lr/pending/bulk")) return bulkFailing ? jsonResponse({ ok: false }, 500) : jsonResponse({ ok: true, applied: 2, ids: ["p1", "p2"] });
          if (target.includes("/.lr/pending")) return jsonResponse({ ok: true, count: 3, snapshotId: "snap-9", pageTitle: "Demo", pins: [
            { id: "p1", index: 1, tag: "h1", comment: "first note", selector: "body h1", component: "", text: "", role: "" },
            { id: "p2", index: 2, tag: "button", comment: "second note", selector: "button#go", component: "", text: "", role: "button" },
            { id: "p3", index: 3, tag: "p", comment: "third note", selector: "p.note", component: "", text: "", role: "" }
          ] });
          return jsonResponse({});
        }
      });
      const clientApi = fakeClientCtx({});
      module.apply(clientApi.ctx);
      clientApi.resolve();
      await flush(4);
      const card = clientApi.slots.find((slot) => slot.spec.id === "dsh-redline" && slot.spec.name === "conversation.input.dock");
      const renderCard = (props = { sessionId: "sess-9" }) => renderOnce(stub, card.component, props);
      let render = renderCard();
      for (const effect of render.effects) effect();
      await flush(4);
      render = renderCard();
      const summary = findElements(render.tree, (element) => element.props?.className === "lr-summary");
      if (summary.length === 1) {
        summary[0].props.onClick();
        await flush(2);
      }
      const open = renderCard();
      const rows = findByClass(open.tree, "lr-row");
      const checkboxes = findByClass(open.tree, "lr-select");
      harness.check("dock: every pending row exposes its own selection checkbox",
        rows.length === 3 && checkboxes.length === 3 && rows.every((row) => findElements(row, (element) => element.props?.className === "lr-select").length === 1),
        JSON.stringify({ rows: rows.length, checkboxes: checkboxes.length }));
      const resolveButton = findByClass(open.tree, "lr-bulk-resolve")[0];
      const deleteButton = findByClass(open.tree, "lr-bulk-delete")[0];
      harness.check("dock: both bulk buttons are disabled while nothing is selected",
        resolveButton?.props?.disabled === true && deleteButton?.props?.disabled === true,
        JSON.stringify({ resolve: resolveButton?.props?.disabled, delete: deleteButton?.props?.disabled }));
      const selectable = checkboxes.filter((box) => box.props.disabled !== true);
      await selectable[0].props.onChange();
      await selectable[1].props.onChange();
      const counted = renderCard();
      harness.check("dock: checking two rows updates the selection count to two",
        textWithin(counted.tree, "lr-bulk-count") === "2 selected",
        JSON.stringify(textWithin(counted.tree, "lr-bulk-count")));
      harness.check("dock: the bulk bar offers Resolve (2) for the two selected rows",
        findByClass(counted.tree, "lr-bulk-resolve")[0]?.props?.children === "Resolve (2)",
        JSON.stringify(findByClass(counted.tree, "lr-bulk-resolve")[0]?.props?.children));
      harness.check("dock: the bulk bar offers Delete (2) for the two selected rows",
        findByClass(counted.tree, "lr-bulk-delete")[0]?.props?.children === "Delete (2)",
        JSON.stringify(findByClass(counted.tree, "lr-bulk-delete")[0]?.props?.children));
      const bulkCalls = () => fetchCalls.filter((call) => call.url.includes("/.lr/pending/bulk"));
      await findByClass(counted.tree, "lr-bulk-resolve")[0].props.onClick();
      await flush(6);
      const resolveCall = bulkCalls()[0];
      const resolveBody = resolveCall === undefined ? {} : JSON.parse(resolveCall.body ?? "{}");
      harness.check("dock: resolving the selection posts to the single bulk route",
        resolveCall !== undefined && resolveCall.method === "POST" && resolveCall.url.includes("/.lr/pending/bulk"),
        JSON.stringify(bulkCalls().map((call) => ({ url: call.url, method: call.method }))));
      harness.check("dock: the resolve bulk body carries the session, the selected ids and the resolve action",
        resolveBody.sessionId === "sess-9" && JSON.stringify(resolveBody.ids) === JSON.stringify(["p1", "p2"]) && resolveBody.action === "resolve",
        JSON.stringify(resolveBody));
      const noticed = renderCard();
      const strip = findByClass(noticed.tree, "lr-notice");
      harness.check("dock: the notice strip renders inside the pending card", strip.length === 1, JSON.stringify(strip.length));
      harness.check("dock: a bulk success message renders into the notice strip",
        strip.length === 1 && strip[0].props.className === "lr-notice lr-notice-ok" && textWithin(noticed.tree, "lr-notice").includes("2 pins resolved."),
        JSON.stringify({ className: strip[0]?.props?.className, text: textWithin(noticed.tree, "lr-notice") }));
      const recounted = renderCard();
      const selectableAgain = findByClass(recounted.tree, "lr-select").filter((box) => box.props.disabled !== true);
      await selectableAgain[0].props.onChange();
      await selectableAgain[1].props.onChange();
      const readyToDelete = renderCard();
      await findByClass(readyToDelete.tree, "lr-bulk-delete")[0].props.onClick();
      await flush(6);
      const deleteCall = bulkCalls()[1];
      const deleteBody = deleteCall === undefined ? {} : JSON.parse(deleteCall.body ?? "{}");
      harness.check("dock: deleting the selection posts to the same bulk route",
        deleteCall !== undefined && deleteCall.method === "POST" && deleteCall.url.includes("/.lr/pending/bulk"),
        JSON.stringify(bulkCalls().map((call) => ({ url: call.url, method: call.method }))));
      harness.check("dock: the delete bulk body carries the session, the selected ids and the delete action",
        deleteBody.sessionId === "sess-9" && JSON.stringify(deleteBody.ids) === JSON.stringify(["p1", "p2"]) && deleteBody.action === "delete",
        JSON.stringify(deleteBody));
      bulkFailing = true;
      const again = renderCard();
      const selectableFail = findByClass(again.tree, "lr-select").filter((box) => box.props.disabled !== true);
      await selectableFail[0].props.onChange();
      await selectableFail[1].props.onChange();
      const readyToFail = renderCard();
      await findByClass(readyToFail.tree, "lr-bulk-resolve")[0].props.onClick();
      await flush(6);
      const failed = renderCard();
      const failedStrip = findByClass(failed.tree, "lr-notice");
      harness.check("dock: a bulk failure message renders into the notice strip",
        failedStrip.length === 1 && failedStrip[0].props.className === "lr-notice lr-notice-error" && textWithin(failed.tree, "lr-notice").includes("Action failed."),
        JSON.stringify({ className: failedStrip[0]?.props?.className, text: textWithin(failed.tree, "lr-notice") }));
      const cleared = await waitFor(() => findByClass(renderCard().tree, "lr-notice").length === 0, 6000, 200);
      harness.check("dock: the notice strip clears after its timeout", cleared === true, "the strip must auto-dismiss");
      harness.check("dock: the host notice is not a floating element outside the card",
        createdTags.every((tag) => tag === "style") && appendedTags.every((tag) => tag === "style") && appendedBodies.length === 0,
        JSON.stringify({ createdTags, appendedTags, appendedBodies }));
    }

    // C5 + C6: the preview UI and the visible resolved state.
    {
      const fetchCalls = [];
      let previewEmpty = false;
      const resolvedIds = new Set();
      const stub = createReactStub();
      const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
        react: stub.React,
        localStorage: makeLocalStorage(),
        document: {
          createElement(tag) { return { tag, href: "", download: "", click: () => {}, style: {}, setAttribute() {}, appendChild() {}, remove() {} }; },
          documentElement: {},
          head: { appendChild() {} },
          body: { appendChild() {} },
          readyState: "complete",
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener() {},
          removeEventListener() {}
        },
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        fetch: async (url, options) => {
          const target = String(url);
          fetchCalls.push({ url: target, headers: options?.headers ?? {}, method: options?.method ?? "GET", body: options?.body ?? null });
          if (target === "/api/dsh-redline.secret") return jsonResponse({ ok: true, secret: "a".repeat(64) });
          if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: Number(new URL(target).port) });
          if (target.includes("/.lr/pending/bulk")) return jsonResponse({ ok: true, applied: 1, ids: [...resolvedIds] });
          if (target.includes("/.lr/pending")) return jsonResponse({ ok: true, count: 2, snapshotId: resolvedIds.has("p1") ? "snap-4-resolved" : "snap-4", pageTitle: "Demo", pins: [
            { id: "p1", index: 1, tag: "h1", comment: "first note", selector: "body h1", component: "", text: "", role: "", ...(resolvedIds.has("p1") ? { status: "resolvido" } : {}) },
            { id: "p2", index: 2, tag: "button", comment: "second note", selector: "button#go", component: "", text: "", role: "button" }
          ] });
          if (target.includes("/.lr/preview")) {
            return previewEmpty
              ? jsonResponse({ ok: true, context: "", sections: [], pins: [] })
              : jsonResponse({ ok: true, context: "PAGE URL: x", sections: [{ name: "Overview", text: "hello overview" }], pins: [{ id: "p1", comment: "first note", screenshot: "1700000000-abcd1234.png" }] });
          }
          if (target.includes("/.lr/attachments/")) return new Response(new Blob(["pngbytes"]), { status: 200 });
          return jsonResponse({});
        }
      });
      const clientApi = fakeClientCtx({});
      module.apply(clientApi.ctx);
      clientApi.resolve();
      await flush(4);
      const card = clientApi.slots.find((slot) => slot.spec.id === "dsh-redline" && slot.spec.name === "conversation.input.dock");
      const renderCard = (props = { sessionId: "sess-1" }) => renderOnce(stub, card.component, props);
      let render = renderCard();
      for (const effect of render.effects) effect();
      await flush(4);
      render = renderCard();
      findElements(render.tree, (element) => element.props?.className === "lr-summary")[0].props.onClick();
      await flush(2);
      const open = renderCard();
      const suffixBefore = findByClass(open.tree, "lr-bulk-resolved").length;
      await findByClass(open.tree, "lr-preview")[0].props.onClick();
      await flush(4);
      const previewed = renderCard();
      const previewCalls = fetchCalls.filter((call) => call.url.includes("/.lr/preview"));
      harness.check("dock: the preview action fetches the session preview route",
        previewCalls.length === 1 && previewCalls[0].url.includes("/.lr/preview?sessionId=sess-1"),
        JSON.stringify(previewCalls.map((call) => call.url)));
      harness.check("dock: the preview fetch carries the secret header",
        previewCalls[0]?.headers["x-dsh-redline-secret"] === "a".repeat(64),
        JSON.stringify(Object.keys(previewCalls[0]?.headers ?? {})));
      for (const effect of previewed.effects) effect();
      await flush(6);
      const cropped = renderCard();
      const cropCalls = fetchCalls.filter((call) => call.url.includes("/.lr/attachments/"));
      const cropName = cropCalls[0] === undefined ? "" : cropCalls[0].url.split("/.lr/attachments/")[1] ?? "";
      harness.check("dock: the preview fetches the pin crop from the attachments route",
        cropCalls.length === 1 && cropName === "1700000000-abcd1234.png",
        JSON.stringify(cropCalls.map((call) => call.url)));
      harness.check("dock: the crop fetch carries the secret header",
        cropCalls[0]?.headers["x-dsh-redline-secret"] === "a".repeat(64),
        JSON.stringify(Object.keys(cropCalls[0]?.headers ?? {})));
      const images = findElements(cropped.tree, (element) => element.type === "img");
      harness.check("dock: the crop renders from an object URL instead of a bare attachment src",
        images.length === 1 && String(images[0].props.src).startsWith("blob:") && !images.some((image) => String(image.props.src).includes("/.lr/")),
        JSON.stringify(images.map((image) => String(image.props.src).slice(0, 24))));
      const sectionDetails = findByClass(cropped.tree, "lr-preview-section");
      const sectionPres = sectionDetails.length === 1 ? findElements(sectionDetails[0], (element) => element.type === "pre") : [];
      harness.check("dock: each preview section renders as its own details with its text in a pre",
        sectionDetails.length === 1 && sectionPres.length === 1 && sectionPres[0].props.children === "hello overview",
        JSON.stringify({ details: sectionDetails.length, pres: sectionPres.map((pre) => pre.props.children) }));
      const contextDetails = findByClass(cropped.tree, "lr-preview-context");
      const contextPres = contextDetails.length === 1 ? findElements(contextDetails[0], (element) => element.type === "pre") : [];
      harness.check("dock: the full context string renders verbatim inside a pre",
        contextDetails.length === 1 && contextPres.length === 1 && contextPres[0].props.children === "PAGE URL: x",
        JSON.stringify(contextPres.map((pre) => pre.props.children)));
      harness.check("dock: one crop image renders per preview pin using the returned basename",
        images.length === 1 && cropName === "1700000000-abcd1234.png" && images[0].props.className === "lr-node-img",
        JSON.stringify({ images: images.length, cropName }));
      await findByClass(cropped.tree, "lr-preview")[0].props.onClick();
      await flush(2);
      previewEmpty = true;
      await findByClass(renderCard().tree, "lr-preview")[0].props.onClick();
      await flush(4);
      const emptyPreview = renderCard();
      harness.check("dock: an empty preview renders the empty state instead of a broken details list",
        findByClass(emptyPreview.tree, "lr-preview-panel").length === 0 && findElements(emptyPreview.tree, (element) => element.type === "details").length === 0 &&
        textWithin(emptyPreview.tree, "lr-notice").includes("Nothing to preview yet."),
        JSON.stringify({ panels: findByClass(emptyPreview.tree, "lr-preview-panel").length, notice: textWithin(emptyPreview.tree, "lr-notice") }));
      resolvedIds.add("p1");
      await waitFor(() => findByClass(renderCard().tree, "lr-row-resolved").length === 1, 4000, 50);
      const beforeBulk = renderCard();
      const firstBox = findByClass(beforeBulk.tree, "lr-select").filter((box) => box.props.disabled !== true)[0];
      await firstBox.props.onChange();
      const readyToResolve = renderCard();
      const bulkBefore = fetchCalls.filter((call) => call.url.includes("/.lr/pending/bulk")).length;
      await findByClass(readyToResolve.tree, "lr-bulk-resolve")[0].props.onClick();
      await flush(6);
      await waitFor(() => findByClass(renderCard().tree, "lr-row-resolved").length === 1, 4000, 50);
      const resolvedView = renderCard();
      const marker = findByClass(resolvedView.tree, "lr-resolved")[0];
      harness.check("dock: a resolved row carries the resolved marker with its check glyph",
        marker !== undefined && marker.props.title === "Resolved" && marker.props.children === "✓ Resolved",
        JSON.stringify(marker?.props ?? null));
      const resolvedRows = findByClass(resolvedView.tree, "lr-row-resolved");
      const allRows = findByClass(resolvedView.tree, "lr-row");
      const queuedRow = allRows.find((row) => !String(row.props.className).includes("lr-row-resolved"));
      harness.check("dock: the resolved row renders dimmed and the queued row carries neither marker nor dimming",
        resolvedRows.length === 1 && String(resolvedRows[0].props.className).includes("lr-row-resolved") &&
        queuedRow !== undefined && queuedRow.props.className === "lr-row" &&
        findElements(queuedRow, (element) => element.props?.className === "lr-resolved").length === 0,
        JSON.stringify(allRows.map((row) => row.props.className)));
      const resolvedBox = findByClass(resolvedView.tree, "lr-select").find((box) => box.props.disabled === true);
      const freshEmpty = renderCard();
      const emptyResolve = findByClass(freshEmpty.tree, "lr-bulk-resolve")[0];
      await findByClass(freshEmpty.tree, "lr-bulk-select-all")[0].props.onClick();
      const afterAll = renderCard();
      const selection = afterAll.states[0]?.selected ?? [];
      harness.check("dock: the resolved row never enters the selection and the resolve button is disabled while empty",
        resolvedBox !== undefined && emptyResolve?.props?.disabled === true &&
        fetchCalls.filter((call) => call.url.includes("/.lr/pending/bulk")).length === bulkBefore + 1 &&
        JSON.stringify(selection) === JSON.stringify(["p2"]) && findByClass(afterAll.tree, "lr-bulk-resolve")[0]?.props?.disabled === false,
        JSON.stringify({ resolvedDisabled: resolvedBox?.props?.disabled, emptyDisabled: emptyResolve?.props?.disabled, selection, bulkCalls: fetchCalls.filter((call) => call.url.includes("/.lr/pending/bulk")).length - bulkBefore }));
      const suffixAfter = findByClass(afterAll.tree, "lr-bulk-resolved");
      harness.check("dock: the resolved-count suffix appears only when at least one pin is resolved",
        suffixBefore === 0 && suffixAfter.length === 1 && textWithin(afterAll.tree, "lr-bulk-resolved").includes("1 resolved"),
        JSON.stringify({ before: suffixBefore, after: textWithin(afterAll.tree, "lr-bulk-resolved") }));
    }
  }

  harness.section("client: ux batch 2 integration");
  {
    // The two end-to-end paths drive the real host. A fresh module instance per
    // assertion (the host suite already imported the bare URL, and its module
    // state must not leak here) inside its own isolated profile, so each path
    // starts from an empty pending store.
    const hostModuleUrl = pathToFileURL(path.join(pluginDir, "lib", "index.js")).href;
    const overlayPostSource = extractFunction(overlay, "postSnapshot");

    // Integration 1: the overlay's transmitted pin fixes reach the rendered context.
    {
      const host = await withIsolatedHome(async (home) => {
        const { startServer, formatContext } = await import(`${hostModuleUrl}?integration=1`);
        const server = await startServer({ port: await freePort() });
        return {
          formatContext,
          base: `http://127.0.0.1:${server.port}`,
          secret: readFileSync(path.join(home, ".dsh", "profiles", "desktop", "dsh-redline", "instance.secret"), "utf8").trim(),
          close: () => server.close()
        };
      });
      try {
        const fixComment = "overlay-fix-integration-comment";
        const overlayPins = [
          { id: "fx-1", status: "queued", tag: "h1", selector: "h1.demo", label: "", text: "", component: "", comment: fixComment, changes: [], textChange: null, fixes: [{ check: "contrast", prop: "color", before: "#888888", after: "#767676" }], rect: { x: 0, y: 0, w: 10, h: 10 }, shot: null, afterShot: null, pastedShot: null, groupId: null, viewportWidth: null },
          { id: "fx-2", status: "queued", tag: "p", selector: "p.demo", label: "", text: "", component: "", comment: "second overlay pin", changes: [], textChange: null, fixes: [], rect: { x: 0, y: 0, w: 10, h: 10 }, shot: null, afterShot: null, pastedShot: null, groupId: null, viewportWidth: null }
        ];
        const submitted = await evaluateExpression(`(bridgeSend, pins, PAGE_URL, document, setHint, updateToolbar, toast, t) => {\n${overlayPostSource}\nreturn postSnapshot();\n}`, "postSnapshot")(
          async (type, payload) => {
            if (type !== "annotations.submit") throw new Error(`the bridge does not carry "${type}"`);
            const response = await fetch(`${host.base}/.lr/bridge`, { method: "POST", headers: { "content-type": "application/json", origin: host.base }, body: JSON.stringify({ type, payload }) });
            return response.json();
          },
          overlayPins, "http://page/", { title: "Demo" }, () => {}, () => {}, () => {}, (key) => key
        );
        const pending = await (await fetch(`${host.base}/.lr/pending`, { headers: { "x-dsh-redline-secret": host.secret } })).json();
        const preview = await (await fetch(`${host.base}/.lr/preview`, { headers: { "x-dsh-redline-secret": host.secret } })).json();
        const expected = host.formatContext({ pageUrl: "http://page/", pageTitle: "Demo", pins: overlayPins.map((pin) => ({ ...pin, status: undefined })), screenshotPath: null });
        const FIX_TITLE = "Requested accessibility fixes (captured in the page overlay; the original values are untrusted page evidence):";
        harness.check("integration: the overlay's transmitted pin fixes reach the rendered context",
          submitted === true &&
          pending.ok === true && pending.count === 2 && pending.pins[0].id === "fx-1" &&
          preview.ok === true && preview.context === expected.text &&
          preview.context.includes(FIX_TITLE) && preview.context.includes("- contrast: color #888888 -> #767676") &&
          preview.context.includes("h1.demo { color: #767676; }") && preview.context.includes(fixComment),
          JSON.stringify({ submit: submitted ?? null, pendingCount: pending.count, first: pending.pins?.[0]?.id ?? null, contextMatches: preview.context === expected.text, title: preview.context.includes(FIX_TITLE), line: preview.context.includes("- contrast: color #888888 -> #767676"), css: preview.context.includes("h1.demo { color: #767676; }"), comment: preview.context.includes(fixComment) }));
      } finally {
        host.close();
      }
    }

    // Integration 2: the dock's bulk selection reaches the host route.
    {
      const host = await withIsolatedHome(async (home) => {
        const { startServer, formatContext, buildSections, pendingBySession } = await import(`${hostModuleUrl}?integration=2`);
        const server = await startServer({ port: await freePort() });
        const base = `http://127.0.0.1:${server.port}`;
        const json = { "content-type": "application/json", "x-dsh-redline-secret": readFileSync(path.join(home, ".dsh", "profiles", "desktop", "dsh-redline", "instance.secret"), "utf8").trim() };
        await fetch(`${base}/.lr/client-ping`, { method: "POST", headers: json, body: JSON.stringify({ kind: "view", sessionId: "sess-int" }) });
        await fetch(`${base}/.lr/annotations`, { method: "POST", headers: json, body: JSON.stringify({ pageUrl: "http://page/", pageTitle: "Demo", pins: [
          { id: "bk-1", tag: "h1", selector: "h1.demo", comment: "bulk-integration-first", changes: [] },
          { id: "bk-2", tag: "p", selector: "p.demo", comment: "bulk-integration-second", changes: [] }
        ], screenshot: null }) });
        return {
          formatContext,
          buildSections,
          base,
          secret: json["x-dsh-redline-secret"],
          snapshot: () => pendingBySession.get("sess-int")?.snapshot ?? null,
          close: () => server.close()
        };
      });
      try {
        let clientSecret = "";
        const stub = createReactStub();
        const { module } = loadClientModule(path.join(pluginDir, "lib", "client.js"), {
          react: stub.React,
          localStorage: makeLocalStorage(),
          console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
          document: {
            createElement(tag) { return { tag, href: "", download: "", click: () => {}, style: {}, setAttribute() {}, appendChild() {}, remove() {} }; },
            documentElement: {},
            head: { appendChild() {} },
            body: { appendChild() {} },
            readyState: "complete",
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            removeEventListener() {}
          },
          fetch: async (url, options) => {
            const target = String(url);
            if (target === "/api/dsh-redline.secret") {
              clientSecret = host.secret;
              return jsonResponse({ ok: true, secret: host.secret });
            }
            if (target === "http://127.0.0.1:47496/.lr/health") return jsonResponse({ ok: true, name: "dsh-redline", port: 47496 });
            if (target.endsWith("/.lr/health")) return jsonResponse({ ok: true, name: "dsh-redline", port: 999999 });
            const hostUrl = /^http:\/\/127\.0\.0\.1:\d+\//.test(target) ? target.replace(/^http:\/\/127\.0\.0\.1:\d+/, host.base) : `${host.base}${target}`;
            const headers = { ...(options?.headers ?? {}) };
            if (hostUrl.includes("/.lr/")) headers["x-dsh-redline-secret"] = host.secret;
            return await fetch(hostUrl, { ...options, headers });
          }
        });
        const clientApi = fakeClientCtx({});
        module.apply(clientApi.ctx);
        clientApi.resolve();
        await flush(4);
        const card = clientApi.slots.find((slot) => slot.spec.id === "dsh-redline" && slot.spec.name === "conversation.input.dock");
        const renderCard = (props = { sessionId: "sess-int" }) => renderOnce(stub, card.component, props);
        let render = renderCard();
        for (const effect of render.effects) effect();
        await waitFor(() => {
          const tree = renderCard().tree;
          return findByClass(tree, "lr-summary").length === 1 && findElements(tree, (element) => element.props?.className === "lr-count").some((element) => String(element.props.children ?? "").startsWith("2 web"));
        }, 4000, 25);
        findByClass(renderCard().tree, "lr-summary")[0].props.onClick();
        await flush(2);
        const open = renderCard();
        const boxes = findByClass(open.tree, "lr-select").filter((box) => box.props.disabled !== true);
        await boxes[0].props.onChange();
        await boxes[1].props.onChange();
        const ready = renderCard();
        await findByClass(ready.tree, "lr-bulk-resolve")[0].props.onClick();
        await flush(8);
        const afterBulk = await (await fetch(`${host.base}/.lr/pending?sessionId=sess-int`, { headers: { "x-dsh-redline-secret": host.secret } })).json();
        const previewAfter = await (await fetch(`${host.base}/.lr/preview?sessionId=sess-int`, { headers: { "x-dsh-redline-secret": host.secret } })).json();
        const rebuilt = host.buildSections(host.formatContext(host.snapshot()).blocks);
        harness.check("integration: the dock's bulk selection reaches the host route and the rebuilt context drops the resolved pins",
          clientSecret !== "" && afterBulk.ok === true && afterBulk.count === 2 &&
          afterBulk.pins.length === 2 && afterBulk.pins.every((pin) => pin.status === "resolvido") &&
          previewAfter.ok === true && previewAfter.context !== "" && previewAfter.sections.length === 1 &&
          JSON.stringify(previewAfter.sections) === JSON.stringify(rebuilt) &&
          !previewAfter.context.includes("bulk-integration-first") && !previewAfter.context.includes("bulk-integration-second"),
          JSON.stringify({ secret: clientSecret !== "", count: afterBulk.count, statuses: afterBulk.pins?.map((pin) => pin.status), sections: previewAfter.sections?.length, matchesRebuilt: JSON.stringify(previewAfter.sections) === JSON.stringify(rebuilt), firstGone: !previewAfter.context.includes("bulk-integration-first"), secondGone: !previewAfter.context.includes("bulk-integration-second") }));
      } finally {
        host.close();
      }
    }
  }
}
