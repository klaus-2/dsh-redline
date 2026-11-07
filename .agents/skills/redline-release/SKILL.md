---
name: redline-release
description: Build, verify, release and update workflow for the dsh-redline plugin (DeepSeek Harness visual review plugin). Triggers when asked to build, test, release, bump, update or publish dsh-redline.
---

# Redline release workflow

Everything needed to edit, build, verify and publish the dsh-redline plugin.
Work from the repository root (`dsh-redline/`).

## Layout

- `overlay.template.js` + `tencil-overlay.css` — overlay sources. `lib/overlay.js`
  is generated; never edit it directly.
- `lib/index.js` — host service: loopback server on 127.0.0.1:47477 with port
  fallback, proxy, annotation intake, screenshot store, settings store at
  `~/.dsh/redline/settings.json`, update check against GitHub releases.
- `lib/client.js` — chat face: dock card, chat-card DOM patcher, settings
  section injected into the harness settings page via the `settings.section`
  slot, update checker UI.
- `locale/*.json` — translation mirrors. The runtime dictionaries are inline
  in `overlay.template.js` / `lib/client.js`; update both together.
- `tools/smoke.mjs` — 33-check suite on isolated port 47950.
- `tools/strip-comments.mjs` — comment stripper (real JS lexer). Shipped code
  carries no narrative comments, only one SPDX line per file.

## Everyday loop

```bash
npm run build     # overlay.template.js + tencil-overlay.css -> lib/overlay.js
npm test          # 33 checks against the release lib (no dsh needed)
node --check lib/index.js && node --check lib/client.js
```

After changing anything under `lib/` or the template, restart the DeepSeek
Harness app (host + client load at boot) and reload the page (the overlay
loads per page view). Run `node tools/smoke.mjs` before any commit.

## Shipped-code policy

- No comments in shipped files except one `// SPDX-License-Identifier: MIT`
  line at the top of each file.
- After editing sources, run `npm run strip-comments` on every touched JS/CSS
  file, then `npm run build`, then `npm test`.
- User-facing strings: update the inline locale tables in
  `overlay.template.js` / `lib/client.js` AND the mirrors in `locale/`.
- Never regex-replace a multi-line dictionary — anchor edits by line range.

## Update system

- Host `GET /.lr/update` fetches
  `https://api.github.com/repos/klaus-2/dsh-redline/releases/latest` and
  compares semver against `PLUGIN_VERSION` in `lib/index.js`.
- The settings page auto-checks on open and shows release notes plus a link
  when a newer version exists.
- Releasing a new version: bump `version` in `package.json`, bump
  `PLUGIN_VERSION` in `lib/index.js`, add a `CHANGELOG.md` entry, run the full
  loop, commit, tag (`git tag vX.Y.Z && git push --tags`), publish a GitHub
  release with the changelog body — the settings page picks it up.

## Publish checklist (when going public)

1. `gh repo edit klaus-2/dsh-redline --visibility public`
2. `npm publish` (package metadata is ready in package.json).
3. PR an entry to awesome-dsh-plugin (see docs/REGISTER.md).
4. Verify topics: dsh-plugin, dsh, deepseek-harness, ai-agents,
   browser-annotation, human-in-the-loop.
5. Post to the harness Discussions and the Discord showcase.

## Verification rules

- Every claim needs fresh evidence: run the suite, read the output.
- `node --check` every shipped JS file after any edit.
- The settings page lives inside dsh's own settings UI (slot
  `settings.section`) — after touching it, restart dsh and open
  Settings → Redline to validate.
