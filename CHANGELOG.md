# Changelog

## 1.0.0 — 2026-11-06

First public release.

- Overlay design system derived from [tencil](https://tencil.dev/) (Apache-2.0, modified) — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
- Element picking with hover highlight on any page rendered by the harness
  browser (`C` comment, `V` adjust, `Esc` cancel).
- Per-pin comments with in-place editing, resolve/reopen/delete.
- Live style inspector with rollback: colors, typography, size, spacing,
  borders, constraints, shadow and transform; drag-to-scrub numbers, presets,
  linked box-model and radius edits, per-row reset.
- Cropped screenshots per pin (element region with context, not the full
  viewport).
- Annotations attach to the next message of the viewed session as structured
  context; the chat renders them as a native card.
- Reconciliation between the composer card and the page overlay.
- Overlay UI in English, Português (Brasil) and 简体中文.
- Free-form annotation canvas (`D`): brush, line, arrow, rectangle, ellipse and numbered step markers, text typed directly on the canvas, five colors, three stroke widths, undo/redo, clear and a selection mode that moves or deletes any drawing. One click sends the full page to the chat with every drawing composited into the screenshot.
- Review modes are exclusive: comment, adjust and draw never run at the same time.
