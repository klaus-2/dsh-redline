import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KEYWORDS = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

const LEGAL = /SPDX-License-Identifier|Copyright|\(c\)\s*\d{4}|Apache-2.0|MIT License/i;
function isLegal(commentText) {
  return LEGAL.test(commentText);
}

function stripJs(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let lastSignificant = "";
  let lastWord = "";
  const frames = [];
  let state = "code";
  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : "";
    if (state === "code") {
      if (ch === "/" && next === "/") {
        let end = i;
        while (end < n && source[end] !== "\n") end += 1;
        const lineText = source.slice(i, end);
        if (isLegal(lineText)) out += lineText;
        i = end;
        continue;
      }
      if (ch === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        const span = end < 0 ? n : end + 2;
        const comment = source.slice(i, span);
        if (isLegal(comment) || comment.startsWith("/*!")) out += comment;
        else if (comment.includes("\n")) out += "\n";
        else out += " ";
        i = span;
        continue;
      }
      if (ch === "/") {
        const canBeRegex = lastSignificant === "" || "(,=:[!&|?{};".includes(lastSignificant) || (lastWord !== "" && KEYWORDS.has(lastWord)) || lastSignificant === "=>";
        if (canBeRegex) {
          let j = i + 1;
          let inClass = false;
          let closed = false;
          while (j < n) {
            const c = source[j];
            if (c === "\\") { j += 2; continue; }
            if (c === "[") inClass = true;
            else if (c === "]") inClass = false;
            else if (c === "/" && !inClass) { closed = true; j += 1; break; }
            else if (c === "\n") break;
            j += 1;
          }
          if (closed) {
            out += source.slice(i, j);
            i = j;
            lastSignificant = "/";
            lastWord = "";
            continue;
          }
        }
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        if (ch === "`") {
          frames.push({ type: "tpl" });
          state = "tpl";
        } else {
          state = ch === "'" ? "sq" : "dq";
        }
        out += ch;
        lastSignificant = ch;
        lastWord = "";
        i += 1;
        continue;
      }
      if (ch === "{") {
        const top = frames[frames.length - 1];
        if (top !== undefined && top.type === "expr") top.braceDepth += 1;
        out += ch;
        lastSignificant = ch;
        lastWord = "";
        i += 1;
        continue;
      }
      if (ch === "}") {
        const top = frames[frames.length - 1];
        if (top !== undefined && top.type === "expr") {
          if (top.braceDepth > 0) top.braceDepth -= 1;
          else {
            frames.pop();
            const enclosing = frames[frames.length - 1];
            state = enclosing !== undefined && enclosing.type === "tpl" ? "tpl" : "code";
            out += ch;
            i += 1;
            continue;
          }
        }
        out += ch;
        lastSignificant = ch;
        lastWord = "";
        i += 1;
        continue;
      }
      if (/\s/.test(ch)) {
        out += ch;
        i += 1;
        continue;
      }
      if (/[A-Za-z_$0-9]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z_$0-9]/.test(source[j])) j += 1;
        lastWord = source.slice(i, j);
        lastSignificant = source[i];
        out += lastWord;
        i = j;
        continue;
      }
      out += ch;
      lastSignificant = ch;
      lastWord = "";
      i += 1;
      continue;
    }
    if (state === "sq" || state === "dq") {
      const quote = state === "sq" ? "'" : '"';
      if (ch === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
      if (ch === quote) { state = "code"; lastSignificant = quote; }
      out += ch;
      i += 1;
      continue;
    }
    if (state === "tpl") {
      if (ch === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
      if (ch === "`") {
        frames.pop();
        const enclosing = frames[frames.length - 1];
        state = enclosing !== undefined && enclosing.type === "expr" ? "code" : "code";
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "$" && next === "{") {
        frames.push({ type: "expr", braceDepth: 0 });
        state = "code";
        out += "${";
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
  }
  return out;
}

function collapseBlank(source) {
  return source.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "");
}

function stripCss(source) {
  return collapseBlank(
    source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => (isLegal(m) || m.startsWith("/*!") ? m : m.includes("\n") ? "\n" : " "))
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
  );
}

function stripYaml(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const DEFAULT_TARGETS = [
  "lib/index.js",
  "lib/client.js",
  "lib/bridge.js",
  "overlay.template.js",
  "tencil-overlay.css",
  "cordis.patch.yml"
];

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const unknown = argv.filter((arg) => (arg.startsWith("-") && arg !== "--write") || arg === "");
if (unknown.length > 0) {
  console.error(`unknown option: ${unknown.join(", ")} (use --write to modify files)`);
  process.exit(1);
}
const positional = argv.filter((arg) => !arg.startsWith("-") && arg !== "");
const targets = positional.length > 0 ? positional : DEFAULT_TARGETS;
const rootDir = fileURLToPath(new URL("..", import.meta.url));

for (const target of targets) {
  const targetPath = isAbsolute(target) ? target : resolve(rootDir, target);
  const source = readFileSync(targetPath, "utf8");
  const isSpdx = source.startsWith("// SPDX-License-Identifier:") ? source.split("\n")[0] + "\n" : "";
  let body = isSpdx ? source.slice(isSpdx.length) : source;
  if (targetPath.endsWith(".css")) body = stripCss(body);
  else if (targetPath.endsWith(".yml")) body = stripYaml(body);
  else body = stripJs(body);
  body = collapseBlank(body);
  const next = isSpdx + body.trimStart() + (body.endsWith("\n") ? "" : "\n");
  const changed = next !== source;
  if (write) {
    writeFileSync(targetPath, next);
    console.log(`${target} -> ${body.length} chars${changed ? " (rewritten)" : " (unchanged)"}`);
  } else {
    console.log(`${target} -> ${changed ? `would change (${source.length} -> ${next.length} chars)` : "clean"}`);
  }
}
