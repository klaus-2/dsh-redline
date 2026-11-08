import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectCallArguments, createReactStub, evaluateObjectLiteral, extractObjectLiteral, fakeClientCtx, findElements, flush, loadClientModule, makeLocalStorage, renderOnce } from "./harness.mjs";

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
  const overlay = readFileSync(overlayPath, "utf8");
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
    harness.includes("the client forwards the secret to the overlay", client, "secret: INSTANCE_SECRET");

    const unprotected = [];
    for (const argument of collectCallArguments(client, "fetch")) {
      if (!argument.includes("/.lr/") && !argument.includes("API_BASE")) continue;
      if (argument.includes("/.lr/health")) continue;
      if (!argument.includes("authHeaders")) unprotected.push(argument.slice(0, 80));
    }
    harness.check("every loopback call carries the secret", unprotected.length === 0, unprotected.join(" | "));

    const overlayUnprotected = [];
    for (const argument of collectCallArguments(overlay, "fetch")) {
      if (!argument.includes("/.lr/") && !argument.includes("API_BASE")) continue;
      if (!argument.includes("authHeaders") && !argument.includes("AUTH")) overlayUnprotected.push(argument.slice(0, 80));
    }
    harness.check("every overlay call carries the secret", overlayUnprotected.length === 0, overlayUnprotected.join(" | "));
    harness.includes("the overlay reads the secret from the page config", overlay, "__LR__");
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
      return { stub, section, client };
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
    }
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
}
