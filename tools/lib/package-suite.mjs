import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packedFiles } from "./harness.mjs";
import { listPublishedReleases, readPublishedReleases } from "./release-suite.mjs";

export async function runPackageSuite(harness, { pluginDir, packageName }) {
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, "package.json"), "utf8"));
  const source = readFileSync(path.join(pluginDir, "lib", "index.js"), "utf8");

  harness.section("package: identity");
  harness.eq("the package name matches", manifest.name, packageName);
  harness.check("the package is public", manifest.private !== true);
  harness.check("the package declares a version", /^\d+\.\d+\.\d+$/.test(manifest.version ?? ""), manifest.version);
  const pluginVersion = /PLUGIN_VERSION = "([^"]+)"/.exec(source)?.[1] ?? "";
  harness.eq("PLUGIN_VERSION matches the manifest", pluginVersion, manifest.version);
  harness.check("the repository points at the public repo", typeof manifest.repository?.url === "string" && manifest.repository.url.includes(manifest.name), manifest.repository?.url);
  harness.check("the homepage points at the public repo", typeof manifest.homepage === "string" && manifest.homepage.startsWith("https://github.com/"));

  harness.section("package: entry points");
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    if (target.includes("*")) {
      const directory = path.join(pluginDir, path.dirname(target));
      const pattern = new RegExp(`^${path.basename(target).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      const matches = existsSync(directory) ? readdirSync(directory).filter((entry) => pattern.test(entry)) : [];
      harness.check(`the export ${key} resolves to at least one file`, matches.length > 0, target);
      continue;
    }
    const file = path.join(pluginDir, target);
    harness.check(`the export ${key} resolves`, existsSync(file), target);
  }
  if (typeof manifest.main === "string") {
    harness.check("the main entry resolves", existsSync(path.join(pluginDir, manifest.main)), manifest.main);
  }
  harness.check("the cordis patch exists", existsSync(path.join(pluginDir, "cordis.patch.yml")));
  const patch = readFileSync(path.join(pluginDir, "cordis.patch.yml"), "utf8");
  harness.includes("the cordis patch names the plugin", patch, manifest.name);

  harness.section("package: published files");
  for (const entry of manifest.files ?? []) {
    harness.check(`the published entry ${entry} exists`, existsSync(path.join(pluginDir, entry)), entry);
  }
  for (const readme of ["README.md", "README.pt-BR.md", "README.zh-CN.md"]) {
    if (!harness.check(`the ${readme} exists`, existsSync(path.join(pluginDir, readme)))) continue;
    harness.check(`the ${readme} is not a stub`, readFileSync(path.join(pluginDir, readme), "utf8").length > 500);
  }
  {
    const readmes = ["README.md", "README.pt-BR.md", "README.zh-CN.md"];
    const sectionCounts = readmes.map((readme) => {
      const file = path.join(pluginDir, readme);
      if (!existsSync(file)) return -1;
      return readFileSync(file, "utf8").split("\n").filter((line) => line.startsWith("## ")).length;
    });
    const english = sectionCounts[0];
    harness.check(
      "the translated readmes carry the same top-level sections as the english one",
      english > 0 && sectionCounts.every((count) => count === english),
      sectionCounts.join(" / ")
    );
  }
  harness.check("the license exists", existsSync(path.join(pluginDir, "LICENSE")));
  harness.check("the changelog exists", existsSync(path.join(pluginDir, "CHANGELOG.md")));

  harness.section("package: what npm would publish");
  {
    const files = await packedFiles(pluginDir);
    if (files === undefined) {
      harness.skip("the published file list can be read", "npm pack is not available here");
    } else {
      const required = [
        "lib/index.js",
        "lib/client.js",
        "lib/overlay.js",
        "lib/bridge.js",
        "cordis.patch.yml",
        "package.json",
        "tencil-overlay.css",
        "vendor/html2canvas.min.js",
        "locale/en.json",
        "locale/pt-BR.json",
        "locale/zh-CN.json",
        "docs/assets/icon.png"
      ];
      const missing = required.filter((file) => !files.includes(file));
      harness.check("the published package carries what the host loads", missing.length === 0, missing.join(", "));
    }
  }

  harness.section("package: release invariants");
  const changelog = readFileSync(path.join(pluginDir, "CHANGELOG.md"), "utf8");
  harness.check(`the changelog documents ${manifest.version}`, changelog.includes(`## [${manifest.version}]`), manifest.version);
  const newestSection = /## \[(?!Unreleased)([^\]]+)\]/.exec(changelog)?.[1] ?? "";
  harness.eq("the newest changelog section is the current version", newestSection, manifest.version);
  harness.check("the changelog follows the keep-a-changelog shape", /## \[/.test(changelog) && /### (Added|Changed|Fixed|Removed)/.test(changelog));
  harness.check("the test script is wired", typeof manifest.scripts?.test === "string" && manifest.scripts.test !== "");
  harness.check("no npmrc is committed", !existsSync(path.join(pluginDir, ".npmrc")));
  harness.check("the vendor script is vendored", existsSync(path.join(pluginDir, "vendor", "html2canvas.min.js")));
  harness.check("the third party notices exist", existsSync(path.join(pluginDir, "THIRD-PARTY-NOTICES.md")));

  harness.section("package: published releases");
  const repo = String(manifest.repository?.url ?? "")
    .replace(/^git\+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace("github.com/", "");
  const releases = await listPublishedReleases(repo, 20);
  if (releases === undefined) {
    harness.skip("every published release title follows the convention", "the gh CLI or the network is unavailable");
    harness.skip("no published release body describes another version", "the gh CLI or the network is unavailable");
  } else {
    const wrong = releases.filter((release) => release.name !== `${manifest.name} ${release.tagName}`);
    harness.check("every published release title follows the convention", wrong.length === 0, wrong.map((release) => release.name).join(", "));
    const published = await readPublishedReleases(repo, releases.map((release) => release.tagName));
    harness.eq("every published release body could be read", published.length, releases.length);
    const escapedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stale = published.filter((release) => {
      const version = release.tagName.replace(/^v/, "");
      const body = release.body ?? "";
      const heading = /^#+\s+(?:[A-Za-z0-9_-]+\s+)?v?(\d+\.\d+\.\d+)/m.exec(body);
      const packageRef = new RegExp(`${escapedName}@(\\d+\\.\\d+\\.\\d+)`).exec(body);
      const mentioned = [heading?.[1], packageRef?.[1]].filter((value) => value !== undefined);
      return mentioned.some((other) => other !== version);
    });
    harness.check("no published release body describes another version", stale.length === 0, stale.map((release) => release.tagName).join(", "));
  }

  harness.section("package: secrets");
  const tracked = ["lib/index.js", "lib/client.js", "lib/overlay.js", "lib/bridge.js", "overlay.template.js", "build-overlay.mjs", "tools/smoke.mjs", "tools/test.mjs", "package.json"];
  for (const relative of tracked) {
    const file = path.join(pluginDir, relative);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const leaked = /npm_[A-Za-z0-9]{20,}|_authToken\s*=|NPM_TOKEN\s*=\s*["'][^"']+/.test(text);
    harness.check(`${relative} carries no token`, !leaked);
  }

  harness.section("package: syntax");
  const scripts = ["lib/index.js", "lib/client.js", "lib/overlay.js", "lib/bridge.js", "overlay.template.js", "build-overlay.mjs", "tools/smoke.mjs", "tools/regression.mjs", "tools/strip-comments.mjs", "tools/lib/harness.mjs", "tools/lib/host-suite.mjs", "tools/lib/client-suite.mjs", "tools/lib/package-suite.mjs", "tools/lib/release-suite.mjs"];
  for (const relative of scripts) {
    try {
      await new Promise((resolve, reject) => {
        execFile("node", ["--check", path.join(pluginDir, relative)], { timeout: 120000, windowsHide: true }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      harness.check(`${relative} parses`, true);
    } catch (error) {
      harness.check(`${relative} parses`, false, String(error?.stderr || error?.message || error).slice(0, 300));
    }
  }

  harness.section("package: legal notices survive stripping");
  {
    const stripper = path.resolve(fileURLToPath(import.meta.url), "..", "..", "strip-comments.mjs");
    const strip = async (file) => {
      await new Promise((resolve, reject) => {
        execFile(process.execPath, [stripper, "--write", file], { timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return readFileSync(file, "utf8");
    };
    const dir = await mkdtemp(path.join(tmpdir(), "dsh-strip-"));
    try {
      const cssFixture = path.join(dir, "fixture.css");
      const templateFixture = path.join(dir, "fixture.js");
      const syntheticFixture = path.join(dir, "synthetic.js");
      await writeFile(cssFixture, readFileSync(path.join(pluginDir, "tencil-overlay.css"), "utf8"));
      await writeFile(templateFixture, readFileSync(path.join(pluginDir, "overlay.template.js"), "utf8"));
      await writeFile(syntheticFixture, "// SPDX-License-Identifier: Apache-2.0\nconst answer = 42;\n");
      const strippedCss = await strip(cssFixture);
      const strippedTemplate = await strip(templateFixture);
      const strippedSynthetic = await strip(syntheticFixture);
      harness.check("the css keeps its Apache-2.0 identifier", strippedCss.includes("SPDX-License-Identifier: Apache-2.0"));
      harness.check("the css keeps its copyright notice", strippedCss.includes("Copyright 2026 Pixel Perfect Agency"));
      harness.check("the template keeps its attribution line", strippedTemplate.includes("(c) 2026 Pixel Perfect Agency"));
      harness.check("the template keeps its own SPDX line", strippedTemplate.startsWith("// SPDX-License-Identifier: MIT"));
      harness.check("a non-MIT SPDX line survives verbatim", strippedSynthetic.startsWith("// SPDX-License-Identifier: Apache-2.0"));
      const proseFixture = path.join(dir, "prose.js");
      await writeFile(proseFixture, "// SPDX-License-Identifier: Apache-2.0\n// derived from the tencil design system (c) 2026 Pixel Perfect Agency\n// TODO: refactor this later\n// Copyright note: reviewed by the operator\n/* planned cleanup of the old canvas keys */\nconst answer = 42;\n");
      const strippedProse = await strip(proseFixture);
      harness.check("the stripper still removes prose comments", !strippedProse.includes("refactor this later"));
      harness.check("the stripper keeps legal keywords inside prose comments", strippedProse.includes("Copyright note: reviewed by the operator"));
      harness.check("the stripper removes non-legal block comments", !strippedProse.includes("planned cleanup of the old canvas keys"));
      const stripperSource = readFileSync(stripper, "utf8");
      const defaultTargets = /const DEFAULT_TARGETS = \[([\s\S]*?)\];/.exec(stripperSource);
      harness.check("the comment stripper never targets the generated overlay", defaultTargets !== null && !defaultTargets[1].includes("lib/overlay.js"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
