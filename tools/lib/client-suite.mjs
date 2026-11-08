import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectCallArguments, evaluateObjectLiteral, extractObjectLiteral } from "./harness.mjs";

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
    const css = readFileSync(path.join(pluginDir, "tencil-overlay.css"), "utf8");
    const expected = template.replace('"__TENCIL_CSS__"', JSON.stringify(css));
    harness.check("the built overlay matches the template", expected === overlay, `template ${expected.length} chars, built ${overlay.length} chars`);
    const templateMissing = REQUIRED_OVERLAY_SYMBOLS.filter((symbol) => !template.includes(symbol));
    harness.check("the template keeps its core symbols", templateMissing.length === 0, templateMissing.join(", "));
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
}
