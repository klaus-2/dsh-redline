# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
