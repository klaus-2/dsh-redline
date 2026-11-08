# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.19] - 2026-11-08

### Fixed

- **The update check no longer fails when GitHub's hourly quota runs out.**
  The row asked GitHub for the latest release, and that API answers 403 once
  an unauthenticated caller spends its sixty requests an hour — so the row
  could say the check had failed even with a release waiting. The version now
  comes from the registry, which says what can actually be installed and has
  no such quota; the release notes are read from GitHub on a best effort
  basis, and a blocked notes request no longer breaks the check.

## [1.0.18] - 2026-11-08

### Fixed

- **The update row keeps the release page link.** It only appeared while an
  update was waiting, so a plugin that was already up to date had no way to
  reach the notes of the version it was running.

## [1.0.17] - 2026-11-08

### Fixed

- **The update goes through the host, so a broken package never reaches your
  profile.** The plugin used to install the new version with its own `pnpm`
  call, which meant the host never checked the package it had just installed —
  a release missing a file the host reads (the bundle patch) was installed
  anyway and broke the dsh on the next start. The update now goes through the
  host's plugin manager, the same way the host's own plugins do, and falls back
  to the plugin's own route only where there is no managed profile.
- **The update row only offers a release the registry already has.** A release
  can reach GitHub before it reaches npm; offering it then failed the install
  for a reason that had nothing to do with your profile.
- **The update row names the failure instead of the install's progress.** The
  message it showed was the first line of the install log — pnpm's own
  progress — so a refused install looked like a network problem. It now shows
  the line the host refused on.

### Removed

- **The "Release notes" link in the update row.** It opened a panel that only
  appeared while an update was waiting, so it looked broken, and the release
  page button next to it already carries the notes.

## [1.0.16] - 2026-11-08

### Fixed

- **Update now works on profiles that enforce a package age policy.** The in-app
  update runs `pnpm add` in the user's profile, and a profile with a minimum
  release age (or a lockfile entry for a package published in the last 24 hours)
  made that install fail with a supply-chain policy error. The update now passes
  `minimumReleaseAge=0` and `minimumReleaseAgeStrict=false` for its own install,
  so it updates the plugin it was asked to update and nothing else.

## [1.0.15] - 2026-11-08

### Fixed

- **Screenshots work again.** The overlay loads the vendored html2canvas with a
  plain `<script src>`, which cannot carry the instance secret — since v1.0.14
  that request was rejected and every screenshot failed to capture. The vendored
  library under `/.lr/vendor/` is a public MIT asset with no review data in it,
  so it is served without the secret again. Every other `/.lr/*` route keeps the
  instance-secret requirement and the restricted origins.

## [1.0.14] - 2026-11-08

### Changed

- **The protected loopback contract shipped again with the full security
  notes.** The loopback server keeps the instance secret and the restricted
  origins; this release republishes it so the install notes describe the whole
  contract.

## [1.0.13] - 2026-11-07

### Security

- **The loopback server no longer serves review data and screenshots to anyone
  who can reach 127.0.0.1.**
  - *Instance secret*: the host creates a random 32-byte secret on first boot
    and keeps it in the profile
    (`~/.dsh/profiles/<profile>/dsh-redline/instance.secret`, mode 0600). Every
    `/.lr/*` route except the public health probe now requires it — as a
    header, a `Bearer` token, or a `key` query parameter for image loads.
    Requests without it get `401` and no CORS headers, so a page on any other
    site can neither read the review data nor drive the control routes.
  - *The secret travels over the authenticated Harness connection*: the client
    reads it from `GET /api/dsh-redline.secret`, the same authenticated channel
    the dsh uses for plugin routes, and hands it to the overlay it injects into
    the harness browser. The secret file itself stays inside the profile and is
    not served.
  - *Origins restricted*: no more `access-control-allow-origin: *`. A response
    echoes the caller's origin only when the request carries the valid secret;
    unauthenticated answers carry no CORS headers at all.

### Fixed

- **The in-app update survives a reboot.** The update installed with the `pnpm`
  found on `PATH`; the harness ships its own runtime pnpm, so the install did
  not survive the next restart. The update now goes through the runtime pnpm
  the harness itself uses.

## [1.0.12] - 2026-11-07

### Fixed

- **The updates row no longer overflows the settings panel.** A long release
  note pushed the row past the panel width. The row wraps now, and the release
  notes open inside the same panel instead of under the row.

## [1.0.11] - 2026-11-07

### Fixed

- **The plugin manager shows the name and the description.** The plugin did not
  declare the locale service, so the metadata carried by
  `locale/<lang>.json` never reached the manager and the entry showed up
  blank.

## [1.0.10] - 2026-11-07

### Fixed

- **A profile install resolves the locale files and the manifest.** The package
  only exported its main entry, so `dsh-redline/locale/<lang>.json` and
  `dsh-redline/package.json` could not be read from an installed copy. Both
  subpaths are exported now.

## [1.0.9] - 2026-11-07

### Fixed

- **The inspector rows and the pending counter follow the language.** They
  looked up their translation by passing the Portuguese label as the key, so
  they fell back to the untranslated text. They resolve through the `prop.*`
  and pending keys now, which every language carries.

## [1.0.8] - 2026-11-07

### Fixed

- **The draft comment placeholder follows the language setting.** It was hardcoded
  in English while the rest of the overlay translated.

## [1.0.7] - 2026-11-07

### Added

- **In-app updates, Composer Plus style.** When a newer release exists, the
  Updates row offers Update now: the host fetches the release files from the
  version tag, stages and verifies them, swaps them into the plugin directory
  and reports installed — restart the dsh to load it. Local development copies
  (a `.git` in the plugin directory) are refused with a git-pull note.

### Fixed

- **Settings actually load from disk now.** The host used `readFileSync` without
  importing it, so every boot silently fell back to defaults and the language,
  hotkeys and screenshot padding reset on each restart.


## [1.0.6] - 2026-11-07

### Fixed

- **The adjust inspector and the draw dock follow the language setting.** Property
  labels (text color, background, font, weight, line height, letter spacing and
  the rest) were hardcoded in Portuguese and looked up by their own text; they
  now resolve through the locale keys, the dock tooltips re-render on a language
  change, and the counter, restored-pins and delivered toasts are locale-driven.


## [1.0.5] - 2026-11-07

### Added

- **Changing the language in the settings now applies to the live overlay.** The
  overlay resolved its language once per page load and kept it until the page
  reloaded; the status poll now carries the configured language and the toolbar
  labels, titles, hotkey chips and pending counter re-render when it changes.
  The pending counter, restored-pins toast and delivered toast are locale-driven
  instead of hardcoded Portuguese.


## [1.0.4] - 2026-11-07

### Fixed

- **Internal server errors no longer masquerade as CORS failures.** The catch-all
  error response omitted the `Access-Control-Allow-Origin` header, so a failing
  route surfaced in the app console as a blocked cross-origin request instead of
  the real 500. Error responses now carry the CORS header and the underlying
  error is logged to the host console.


## [1.0.3] - 2026-11-07

### Fixed

- **The overlay resets after the annotations are delivered.** Sent pins stayed on the
  page as dimmed markers with their popovers; the delivery event now clears the queued
  pins, the draft popover and the highlight, so the overlay starts clean for the next
  review.
  ([`e7c8f83`](https://github.com/klaus-2/dsh-redline/commit/e7c8f83))
- **The delete button closes the pin popover.** It removed the pin but left the
  comment panel open on screen.
  ([`e7c8f83`](https://github.com/klaus-2/dsh-redline/commit/e7c8f83))

## [1.0.2] - 2026-11-07

### Fixed

- **The card's send button now delivers with an empty composer, with or without composer-plus.**
  The send path only carried the annotations when the composer draft was non-empty; with an empty
  draft it fell back to a conversation call that, outside composer-plus, queued the message instead
  of starting the turn, leaving the pins pending. The prompt is now written into the composer through
  the native value setter plus an input event and submitted through the shell, with the conversation
  call kept only as a reported fallback.


## [1.0.1] - 2026-11-07

### Added

- **The plugin manager now shows Redline with its icon and description.** The
  list reads `meta.title` and `meta.description` from the plugin locales and an
  `icon` path from the package manifest; the npm tarball ships the icon file.
  ([`cbea413`](https://github.com/klaus-2/dsh-redline/commit/cbea413))

## [1.0.0] - 2026-11-06

First public release.

### Added

- **Point at any element on the page and comment on it.** Hover highlight on
  any page rendered by the harness browser; the pin captures the selector,
  role, text and a cropped screenshot of exactly the marked region, with an
  adjustable context padding. Per-pin comments edit in place and support
  resolve, reopen and delete. The overlay design system is derived from
  [tencil](https://tencil.dev/) (Apache-2.0, modified — see
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
  ([`e9702aa`](https://github.com/klaus-2/dsh-redline/commit/e9702aa))
- **Adjust styles live with rollback.** The inspector covers colors,
  typography, size, spacing, borders, constraints, shadow and transform, with
  drag-to-scrub numbers, presets, linked box-model and radius edits and a
  per-row reset; every tweak records as `before → after` and Esc rolls it back.
  ([`e9702aa`](https://github.com/klaus-2/dsh-redline/commit/e9702aa))
- **Annotations reach the agent as structured context.** Confirming collects
  the pins into a card above the composer; sending attaches the snapshot to the
  next message of the viewed session, rendered natively in the chat, with
  reconciliation between the card and the page overlay.
  ([`e9702aa`](https://github.com/klaus-2/dsh-redline/commit/e9702aa))
- **A free annotation canvas sketches over the whole page.** Brush, lines,
  arrows, rectangles, ellipses, numbered step markers, text typed directly on
  the canvas, five colors, three stroke widths, undo and redo, and a selection
  mode that moves or deletes any drawing. One click sends the full page to the
  chat with every drawing composited into the screenshot.
  ([`1ae66f9`](https://github.com/klaus-2/dsh-redline/commit/1ae66f9))
- **Review modes are exclusive.** Comment, adjust and draw never run at the
  same time; entering one leaves the others, and deselecting a tool returns to
  the canvas selection.
  ([`aacdd1d`](https://github.com/klaus-2/dsh-redline/commit/aacdd1d))
- **Works out of the box.** The overlay ships in English, Português (Brasil)
  and 简体中文, html2canvas is vendored so installs need no build step, and a
  settings page inside the harness settings covers language, hotkeys, screenshot
  padding and the update check.
  ([`5fdc41f`](https://github.com/klaus-2/dsh-redline/commit/5fdc41f))
