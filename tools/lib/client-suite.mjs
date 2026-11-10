import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import vm from "node:vm";
import { collectCallArguments, createReactStub, evaluateExpression, evaluateObjectLiteral, extractArrowConst, extractFunction, extractObjectLiteral, fakeClientCtx, findElements, flush, jsonResponse, loadClientModule, makeLocalStorage, renderOnce, runCleanups, storageShim, waitFor } from "./harness.mjs";

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
  "function setHint",
  "function postSnapshot",
  "function openAdjustPanel",
  "const EDITABLE_PROPS",
  "const PROP_META",
  "const t = (key) =>"
];

// The mirrors carry the strings of the settings panel as well as the overlay's. These are the
// panel's, and they live in the client's table, not in the overlay's.
const MIRROR_ONLY_KEYS = new Set([
  "hotkeyComment",
  "hotkeyAdjust",
  "hotkeyDraw",
  "capture",
  "duplicateKey"
]);

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
    harness.includes("the client reads the secret from the host", client, "/api/dsh-redline.secret");
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
        privateCalls: () => calls.filter((call) => call.url.includes("/.lr/") && !call.url.endsWith("/.lr/health")),
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
    const unknownError = await mediated.window.__LR_BRIDGE__.send("settings.update", {}).then(() => "resolved", (error) => String(error?.message ?? error));
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
    fakeWebview.executeJavaScript = async (code) => {
      executed.push(code);
      if (code.includes("window.__LR__ = Object.assign")) {
        try {
          vm.runInContext(code, pageSandbox, { filename: "injected.js" });
        } catch {
          // The overlay needs a DOM this shim does not have; the relay runs
          // before it and is what the round trip needs.
        }
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
    const guardScript = /const guardScript = `([^`]*)`;/.exec(hostSource)?.[1] ?? "";
    const guardCode = /<script>([\s\S]*?)<\/script>/.exec(guardScript)?.[1] ?? "";
    const guardHref = "https://example.com/";
    const guardOtherHref = "https://example.com/other";
    const guardSeed = {
      "lr-drawings": "old",
      "lr-drawings:https://a.example": "old",
      [`lr:pins:${guardOtherHref}`]: "old",
      [`lr:pins:${guardHref}`]: "keep",
      [`lr-panel-pos:${guardOtherHref}`]: "old",
      [`lr-panel-pos:${guardHref}`]: "keep",
      foreign: "keep"
    };
    const guardExpected = [`lr:pins:${guardHref}`, `lr-panel-pos:${guardHref}`, "foreign"];
    const runStorageGuard = (code) => {
      const session = storageShim(guardSeed);
      const local = storageShim(guardSeed);
      const context = vm.createContext({ window: { location: { href: guardHref }, sessionStorage: session, localStorage: local } });
      vm.runInContext(code, context, { filename: "storage-guard.js" });
      return { sessionKeys: Object.keys(session), localKeys: Object.keys(local) };
    };
    const guardResult = runStorageGuard(guardCode);
    harness.check("the storage guard keeps only this page's keys",
      guardCode.includes("window.location.href") &&
      JSON.stringify(guardResult.sessionKeys) === JSON.stringify(guardExpected) &&
      JSON.stringify(guardResult.localKeys) === JSON.stringify(guardExpected),
      `session ${JSON.stringify(guardResult.sessionKeys)} | local ${JSON.stringify(guardResult.localKeys)}`);
    const noGuardScript = guardScript.replace(/<script>[\s\S]*?<\/script>/, "<script></script>");
    const noGuardCode = /<script>([\s\S]*?)<\/script>/.exec(noGuardScript)?.[1] ?? "";
    const noGuardResult = runStorageGuard(noGuardCode);
    assert.deepEqual(noGuardResult.sessionKeys, Object.keys(guardSeed));
    assert.deepEqual(noGuardResult.localKeys, Object.keys(guardSeed));

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

  harness.section("client: overlay locales");
  {
    const locales = localeKeys(overlay);
    if (!harness.check("the overlay carries the locale dictionaries", locales !== undefined)) {
      return;
    }
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
    // table sends the translator to the wrong text.
    const mirrorOf = { en: "en.json", pt: "pt-BR.json", zh: "zh-CN.json" };
    const drifted = [];
    for (const [code, file] of Object.entries(mirrorOf)) {
      const mirror = JSON.parse(readFileSync(path.join(pluginDir, "locale", file), "utf8"));
      const dictionary = dictionaries[code] ?? {};
      for (const [key, value] of Object.entries(dictionary)) {
        if (mirror[key] !== value) drifted.push(`${code}:${key}`);
      }
      for (const key of Object.keys(mirror)) {
        if (key === "meta") continue;
        if (dictionary[key] === undefined && !MIRROR_ONLY_KEYS.has(key)) drifted.push(`${code}:${key} (only in the mirror)`);
      }
    }
    harness.check("the translation mirrors match the inline tables", drifted.length === 0, drifted.slice(0, 8).join(", "));
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
    harness.check("the draft pin carries the tencil rim shimmer", css.includes(".pin-draft .pin-body") && css.includes("rim-travel 2.4s linear infinite"), css.includes("rim-travel") ? "draft rule missing" : "rim animation missing");
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
    const handler = /if \(hotkeyMatches\(event, hotkeyComment\)\)[\s\S]*?else if \(hotkeyMatches\(event, hotkeyDraw\)\)[^\n]*/.exec(overlaySource)?.[0] ?? "";
    harness.check("the overlay's key handler asks the matcher", handler.includes("hotkeyMatches(event, hotkeyComment)") && handler.includes("hotkeyMatches(event, hotkeyAdjust)") && handler.includes("hotkeyMatches(event, hotkeyDraw)"), handler.slice(0, 120));
    // One key arms one mode: the three checks are chained, not independent.
    const chained = handler.match(/hotkeyMatches\(event, hotkey(Comment|Adjust|Draw)\)/g) ?? [];
    harness.eq("the three hotkeys are checked in a chain", chained.length, 3);
    harness.check("one key arms one mode", (handler.match(/\belse if\b/g) ?? []).length === 2, handler.slice(0, 120));
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
          if (target.includes("/.lr/update/install")) {
            return new Response(JSON.stringify({ ok: true, installed: "1.0.17" }), { status: 200, headers: { "content-type": "application/json" } });
          }
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

    const fallbackCalls = [];
    const withoutManager = build(undefined, fallbackCalls);
    const renderedFallback = renderOnce(withoutManager.stub, withoutManager.section.component, {});
    for (const effect of renderedFallback.effects) effect();
    await flush(4);
    const withButtonFallback = renderOnce(withoutManager.stub, withoutManager.section.component, {});
    const fallbackButtons = findElements(withButtonFallback.tree, (element) => element.props?.children === "Update now");
    harness.eq("the update button appears without a plugin manager", fallbackButtons.length, 1);
    if (fallbackButtons.length === 1) {
      await fallbackButtons[0].props.onClick();
      await flush(4);
      const installCall = fallbackCalls.find((entry) => entry.url.includes("/.lr/update/install"));
      harness.check("the own install route is used when there is no plugin manager", installCall !== undefined, JSON.stringify(fallbackCalls.map((entry) => entry.url.slice(0, 60))));
      harness.check("the own install route carries the version", String(installCall?.body ?? "").includes("1.0.17"), String(installCall?.body ?? ""));
      harness.eq("the fallback install remembers the version the host installed", withoutManager.localStorage.getItem("dsh-redline.updated"), "1.0.17");
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

  harness.section("client: a host that answers without settings does not break the panel");
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

  harness.section("client: a copy that is already installed is asked for by its exact tarball");
  {
    // The manager refuses name@version because the package is already there: the row asks again with the
    // exact tarball, and the answer that comes back is the one the row must name.
    const stub = createReactStub();
    const localStorage = makeLocalStorage();
    const calls = [];
    const pluginManager = {
      async installBundle(spec) {
        calls.push(spec);
        if (calls.length === 1) return { ok: true, value: { application: "failed", error: { code: "already-installed" } } };
        return { ok: true, value: { application: "restart-required", version: "1.0.24" } };
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
      harness.eq("the manager is asked twice", calls.length, 2);
      harness.eq("the retry asks for the exact tarball", calls[1], "https://registry.npmjs.org/dsh-redline/-/dsh-redline-1.0.24.tgz");
      harness.eq("the version that landed on disk is remembered", localStorage.getItem("dsh-redline.updated"), "1.0.24");
      const after = renderOnce(stub, section.component, {});
      const restart = findElements(after.tree, (element) => typeof element.props?.children === "string" && element.props.children.includes("1.0.24") && element.props.children.includes("installed"));
      harness.check("the row names the version that landed", restart.length > 0, JSON.stringify(after.tree).slice(0, 200));
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
    const build = async (pluginManager) => {
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
    harness.eq("a refusal names nothing as installed", refused.stub.getStates()[0].installed, "");
    harness.eq("a refusal is not remembered as installed", refused.localStorage.getItem("dsh-redline.updated"), null);
    harness.check("a refusal names the host's own reason", String(refused.stub.getStates()[0].installError).includes("not installed from a registry"), String(refused.stub.getStates()[0].installError));

    const cancelled = await build({
      async updateBundle(name, version) {
        return { ok: true, value: { from: "1.0.23", to: version, step: "install", result: { changed: false, application: "cancelled", stage: "install", target: name } } };
      }
    });
    await click(cancelled);
    harness.eq("a cancellation names nothing as installed", cancelled.stub.getStates()[0].installed, "");
    harness.eq("a cancellation is not remembered as installed", cancelled.localStorage.getItem("dsh-redline.updated"), null);
    harness.check("a cancellation is reported", cancelled.stub.getStates()[0].installError !== "", String(cancelled.stub.getStates()[0].installError));

    const fallbackCalls = [];
    const recovered = await build({
      async updateBundle() {
        return { ok: true, value: { from: "1.0.23", to: "1.0.24", step: "check", result: { changed: false, application: "failed", stage: "install", target: "dsh-redline", error: { code: "invalid-spec", diagnostic: "dsh-redline is not installed from a registry under its own name" } } } };
      },
      async installBundle(spec) {
        fallbackCalls.push(spec);
        return { ok: true, value: { application: "restart-required", version: "1.0.24" } };
      }
    });
    await click(recovered);
    harness.eq("the plain spec is asked for after the refusal", fallbackCalls.length, 1);
    harness.eq("the plain spec names the package and the version", fallbackCalls[0], "dsh-redline@1.0.24");
    harness.eq("the copy that landed is remembered", recovered.localStorage.getItem("dsh-redline.updated"), "1.0.24");
    harness.eq("the refusal does not survive the recovery", recovered.stub.getStates()[0].installError, "");
  }

  harness.section("client: a host that only has the update API is still asked");
  {
    const stub = createReactStub();
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
}
