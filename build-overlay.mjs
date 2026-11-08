import { readFileSync, writeFileSync } from "node:fs";

const template = readFileSync(new URL("./overlay.template.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("./tencil-overlay.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
if (css.includes("__TENCIL_CSS__") || !template.includes("__TENCIL_CSS__")) {
  console.error("missing placeholders");
  process.exit(1);
}
const built = template.replace('"__TENCIL_CSS__"', JSON.stringify(css));
writeFileSync(new URL("./lib/overlay.js", import.meta.url), built);
console.log(`lib/overlay.js built: ${built.length} chars (css ${css.length})`);
