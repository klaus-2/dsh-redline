# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The overlay appears again in the harness browser panel.** Since the dsh
  0.2.2-rc.3 the browser panel creates its guest with the lease token in the
  `src` attribute and navigates it with `loadURL()`, so the attribute keeps
  saying `about:blank#<lease>` for the whole life of the guest. The client read
  the page's url from that attribute and refused to inject the overlay into
  every guest the panel renders. It now reads the guest's own url and falls
  back to the attribute for the carriers that do not expose one, so the
  overlay, the bridge and the pins come back in the panel while a guest that
  has not navigated yet still waits for its page.
- **The final live test now covers the client half.** The regression above
  shipped because the served-path checks never exercised the client that
  injects into webviews. The final test runs the real client against a stub
  webview shaped like the harness guest, so a client that cannot inject into
  the panel fails the release instead of shipping.

### Changed

- **The group mode reads like the rest of the overlay.** Picked elements keep
  the solid accent outline instead of a washed dashed rectangle, and each pick
  shows its order in a small badge so a multi-select is legible; the badge
  moves inside the element when there is no room above it.
- **The preview-width control is a button with a menu instead of a select.**
  The button shows the active preset (or "Largura total") and turns accent
  while a preset is applied; the menu lists the fixed presets and the zoom
  steps, marks the active one, and follows the dropdown language the draw
  tools already use.

## [1.2.0] - 2026-11-13

This release expands the review toolkit: the inspector suggests the site's
design tokens, adjusted pins produce an applicable CSS patch and capture the
before and after of the change, one comment covers a group of elements, the
page previews at fixed widths, the pin popover audits accessibility, and the
pending annotations export as a report.

_The new toolbar controls and popover sections appear after the dsh restarts
with the updated plugin: the host serves the overlay the installed version
carries._

### Added

- **The style inspector suggests the site's own design tokens.** When a color,
  spacing, typography or radius field holds a value that matches a CSS custom
  property defined on the page, the inspector offers chips with the matching
  `var(--token)` names, and choosing one records the token reference instead
  of the literal value, so the fix keeps following the design system.
  ([`2ec6c4f`](https://github.com/klaus-2/dsh-redline/commit/2ec6c4f))

- **Adjusted pins produce a CSS patch the agent can apply directly.** The
  recorded changes build a `selector { property: value; }` block: the pin
  popover copies it to the clipboard, and the context the agent receives
  renders the same block under "Requested CSS", keeping token references as
  written instead of resolved values.
  ([`07f9340`](https://github.com/klaus-2/dsh-redline/commit/07f9340))

- **Pins whose element disappears are marked stale instead of drifting
  silently.** A page that re-renders under a pinned marker used to leave the
  marker floating at its old position with no sign the target was gone. The
  overlay re-resolves each pin's selector when the page mutates, repositions
  the markers that still resolve, dims the ones that no longer do and warns
  in the popover, and dragging a stale marker re-anchors it to the element
  under the drop point.
  ([`9b58eeb`](https://github.com/klaus-2/dsh-redline/commit/9b58eeb))

- **The pending annotations export as a Markdown or JSON report.** Two buttons
  in the pending card download every annotation the host holds, each with its
  target, selector, comment, recorded adjustments and screenshot paths, so the
  feedback moves into issues and chats outside the harness. The report covers
  pending annotations only; delivered ones are gone from the snapshot.
  ([`d9e0c4f`](https://github.com/klaus-2/dsh-redline/commit/d9e0c4f))

- **One comment covers a group of elements.** Picking several elements in
  group mode files them as one annotation with a single comment, and the agent
  context renders the group as one numbered section listing every member's own
  selector and screenshot, so repeating the same request across five buttons
  stops costing five separate pins. Groups live on one page; navigating away
  clears them with the rest of the page's annotations.
  ([`c51715e`](https://github.com/klaus-2/dsh-redline/commit/c51715e))

- **The page previews at fixed widths, and pins record the width they
  captured.** A toolbar picker constrains the page to 375, 768 or 1280 pixels
  and centers it, pins created under a preset record that width, and the agent
  context names it, so layout problems that only appear in one width band
  survive into the review. Pages using `100vw` units or fixed-position
  navigation do not honor the constraint.
  ([`3726a81`](https://github.com/klaus-2/dsh-redline/commit/3726a81))

- **The pin popover audits the element for five common accessibility
  problems.** Opening a pin checks text contrast against the effective
  background, the accessible name, `alt` on images, an explicit or implicit
  role and the 24-pixel minimum target size, and each row reports pass, fail,
  warn, unknown or not applicable, so the reviewer gets an objective second
  read without leaving the overlay.
  ([`ff4e680`](https://github.com/klaus-2/dsh-redline/commit/ff4e680))

- **Adjusted pins capture the before and after of the change.** Confirming
  adjustments saves two crops of the marked region, one with the original
  styles and one with the live adjustments applied, and the agent context
  lists both image paths, so the agent sees the exact visual effect the
  reviewer asked for instead of inferring it from property pairs.
  ([`f7172ff`](https://github.com/klaus-2/dsh-redline/commit/f7172ff))

## [1.1.0] - 2026-11-12

This release hardens everything the plugin shares with the pages it reviews and
files annotations more carefully. Review storage is now private to each site,
and annotations saved before this release are not carried over: pins and panel
positions are discarded the first time each site loads after updating.

### Added

- **Each site's annotations stay private to that site.** Pins and panel
  positions used to live in Web Storage keys shared by every page the plugin
  served, so a reviewed site could read or overwrite the annotations left on
  another one. The keys are now derived from the page's origin and path, the
  overlay purges keys that belong to other pages when it loads, and the host
  derives the same keys from the target it serves, so the overlay and the host
  can never disagree about where a page's annotations live. Pins and panel
  positions saved before this release are discarded on the first visit to each
  site after updating; drawings are kept in the host store and survive.
  ([`bd4b392`](https://github.com/klaus-2/dsh-redline/commit/bd4b392))

### Changed

- **The context that reaches the agent is bounded once.** A snapshot with many
  pins could hand the agent more text than the session budget. The delivery now
  fits the annotations into one budget, drops whole comments that no longer fit
  and names how many were dropped instead of trimming silently.
  ([`fc0412d`](https://github.com/klaus-2/dsh-redline/commit/fc0412d))
- **The setup docs and the translated readmes match the shipped plugin.** The
  setup steps, the security notes and the Português (Brasil) and 简体中文
  readmes had drifted from the current behavior. All three languages carry the
  same sections now, and a package check fails the suite when the sections
  drift again.
  ([`85731cb`](https://github.com/klaus-2/dsh-redline/commit/85731cb))

### Fixed

- **Unquoted attributes and srcset candidates are rewritten too.** The HTML
  rewriter only handled quoted attribute values, so pages built with
  `href=/search?q=1` kept unproxied links and a srcset candidate whose URL
  contains a comma was split at the wrong place. The rewriter covers quoted and
  unquoted values with the WHATWG tokenizer's `=` handling now, ends srcset
  candidates at the comma that follows the URL, and an unterminated quote no
  longer eats the markup that follows it.
  ([`56de6c2`](https://github.com/klaus-2/dsh-redline/commit/56de6c2))
- **Pins stay where they were placed when the page is scrolled.** Saved pins
  were positioned with page coordinates that shifted with the scroll position,
  so a restored marker could land away from its element. Markers now anchor in
  viewport coordinates and land exactly where the pin was placed.
  ([`be8239e`](https://github.com/klaus-2/dsh-redline/commit/be8239e))
- **A pin leaves the page only when the host no longer holds it.** The overlay
  removed every queued pin as soon as any delivery happened after they were
  created, so an unrelated message wiped annotations that were never sent.
  Queued pins are removed by id now, only when the host reports that id
  delivered, and stay on the page otherwise.
  ([`fdb979e`](https://github.com/klaus-2/dsh-redline/commit/fdb979e))
- **The comment text survives the page moving the draft.** Repositioning the
  page rebuilt the draft popover from scratch and cleared the text being typed.
  The draft now moves without being rebuilt.
  ([`c223cf4`](https://github.com/klaus-2/dsh-redline/commit/c223cf4))
- **Annotations are filed under the session that was active when they arrived.**
  The session was read after the screenshot was saved, so a snapshot submitted
  while the user switched chats could attach to the wrong conversation. The
  session is captured before the first await now.
  ([`8eed93f`](https://github.com/klaus-2/dsh-redline/commit/8eed93f))
- **The plugin keeps its state in the profile that installed it.** The host
  derived the profile directory from a fixed desktop path, so a web-profile
  install shared state with the desktop profile, including the instance secret.
  The directory is now derived from where the package is installed, with an
  environment override for tests.
  ([`54c426b`](https://github.com/klaus-2/dsh-redline/commit/54c426b))
- **Every overlay and card string follows the language setting.** The remaining
  hardcoded Portuguese strings in the card (element labels, the crop label, the
  attachment notice) resolved through the locale tables now, and the overlay,
  panel and card tables are checked against the translation files so a missing
  key fails the suite.
  ([`1107073`](https://github.com/klaus-2/dsh-redline/commit/1107073))
- **Proxying on the session-relative route stays on the reviewed site.** A
  request path that resolved outside the site being reviewed, through dot
  segments or backslashes, was proxied to that other target. The branch refuses
  anything whose resolved origin differs from the session's site now.
  ([`7107323`](https://github.com/klaus-2/dsh-redline/commit/7107323))
- **A page cannot name where its screenshot crops are written.** The submission
  accepted a page-supplied screenshot path and deleted the file it named. The
  host derives the path itself now, ignores what the page sent, and deletes
  only the file it wrote.
  ([`70088a1`](https://github.com/klaus-2/dsh-redline/commit/70088a1))
- **The card identifies the host before it sends anything.** The card scanned
  loopback ports and trusted whatever answered them. The host is verified by
  name and port before authentication now, and an unidentified host fails
  closed instead of being trusted.
  ([`4a68929`](https://github.com/klaus-2/dsh-redline/commit/4a68929))
- **License notices survive the comment stripper.** The shipped-source stripper
  dropped legal notices from public files. It keeps them now and strips only
  its declared targets, and the package suite parses every shipped script so
  silent corruption fails the suite.
  ([`4332172`](https://github.com/klaus-2/dsh-redline/commit/4332172))

## [1.0.25] - 2026-11-10

### Changed

- **The update check asks the npm registry only.** The row also asked GitHub
  for the release notes, which no longer had a reader, and that API answers
  403 once an unauthenticated caller spends its sixty requests an hour. The
  release page button still carries the notes.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))

### Fixed

- **The update row no longer claims an update worked when it did not.** A
  release the panel could not name as a version was refused silently, so
  clicking "Update now" did nothing at all. A host that refuses or cancels the
  update named nothing as installed either, and the row now says what the host
  said instead of reporting a version that never landed. A settings change
  that failed to reach the host no longer leaves the "Saved" banner on screen
  over a value that was never written.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))
- **The update now goes through the host's own update API.** Installing a
  tarball URL as the dependency left the profile with a dependency the host
  refuses to update, which locked the plugin out of its own update path. The
  host's update API replaces the installed copy and keeps the dependency saved
  under its own name. A profile that still holds the old tarball dependency is
  repaired by the update itself, which installs the version with pnpm and
  rewrites the dependency as a registry spec.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))
- **A settings change made over an unreadable panel is refused.** When the
  service could not be read, the panel showed the default settings as if they
  were the ones in use, and saving a change wrote those defaults over the real
  settings. The panel now refuses the save and says the settings could not be
  read.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))
- **The update check no longer says "no releases published" when it never
  ran.** A refused or unreachable update check left the row reading as if the
  registry had been asked and had nothing to offer. The row now reports the
  failed check, and the same applies to a settings read the host refused.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))
- **The version that landed is the version the row names.** An install that
  landed a version other than the one that was asked for was reported as a
  failure, so a successful install looked like a broken one. The route names
  the version that is on disk, and the row keeps saying which one was asked
  for when pnpm holds a release back.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))
- **An install that stops making progress says so.** An install that ran past
  its bound was reported with a line of pnpm output that read like a network
  problem. The row now says the install was stopped, and a second install
  asked for while the first one runs is refused instead of writing the same
  profile at the same time.
  ([`a481542`](https://github.com/klaus-2/dsh-redline/commit/a481542))

## [1.0.24] - 2026-11-09

### Fixed

- **The proxied page no longer receives review text.** The inline config no
  longer broadcasts the saved drawings, and an inline guard that runs before
  `window.__LR__` is defined removes the legacy `lr-drawings` and
  `lr-drawings:*` keys and the off-page pin and panel keys from both
  `sessionStorage` and `localStorage`. The bridge relay purges the legacy
  drawing keys again when it loads, so a page script that re-creates them
  after the guard does not keep them for the next page. Drawings now live
  only in memory in the overlay; the only repository of saved drawings is the
  host store behind the instance secret.
  ([`7afc873`](https://github.com/klaus-2/dsh-redline/commit/7afc873))
- **Panel positions are tab-scoped now.** The saved position of a panel
  followed every tab of the same site through a key shared across tabs;
  positions live in `sessionStorage` per tab now and survive that tab's
  reloads.
  ([`7afc873`](https://github.com/klaus-2/dsh-redline/commit/7afc873))

## [1.0.23] - 2026-11-08

### Changed

- **The bridge is rate limited.** Pages that a browser served from this origin
  can annotate, and third-party content proxied on this origin could hammer
  that channel. The bridge keeps a per-origin token bucket (60 tokens, 10/s)
  and answers `429` when a page bursts past it.
  ([`d212d2d`](https://github.com/klaus-2/dsh-redline/commit/d212d2d))
- **`annotations.submit` from the bridge caps the pins at 40.** The pending
  snapshot stays small and cheap to render no matter what a page sends. The
  bridge is an annotation channel; pages with third-party content delivered
  through the proxy can annotate, and the context labels everything as
  untrusted page evidence.
  ([`d212d2d`](https://github.com/klaus-2/dsh-redline/commit/d212d2d))

### Fixed

- **The OPTIONS preflight answers under the gate's authority.** It used to
  echo a CORS grant to any origin that asked; now it answers `204` with the
  CORS echo only when the request carries the secret or comes from the app
  origin, and every other preflight gets a bare `401` with no CORS headers.
  ([`d212d2d`](https://github.com/klaus-2/dsh-redline/commit/d212d2d))
- **The bridge drain drops messages beyond the batch of 20 per tick no
  more.** A queue larger than the batch used to lose the excess; the drain
  now takes at most 20 messages per tick and leaves the rest queued, so the
  next 200 ms tick picks them up and every `send()` promise resolves.
  ([`d212d2d`](https://github.com/klaus-2/dsh-redline/commit/d212d2d))

## [1.0.22] - 2026-11-08

### Fixed

- **The instance secret never reaches the page any more.** The plugin used to
  hand the secret to every page it injected the overlay into, so any script on
  that page could read it and call the private API: the review data, the
  screenshots, the settings and the control routes. The secret now stays in
  the host, and the page talks to it through a limited message bridge. The
  bridge carries four messages and no more: submit the annotations, save the
  drawings, read the narrow state the overlay draws (language, delivery,
  pending ids, settings) and report a diagnostic. Every other route still
  answers `401` to the page, the bridge never hands the session id back, and
  the state the page reads is a projection, not the raw status: the agent
  ticker (tool arguments, agent text) stays in the host. The overlay itself no
  longer calls the private API at all: it has no secret, no header and no
  secret in a URL, only the bridge. The server also answers only for its own
  host names, so a name that resolves to 127.0.0.1 (DNS rebinding) cannot
  reach it. The page authenticates to the bridge with the `Origin` header,
  which a browser sets and a script cannot forge; that origin also carries
  pages the plugin proxies from third-party sites, so the bridge stays an
  annotation channel and never a data channel.
  ([`2d0f883`](https://github.com/klaus-2/dsh-redline/commit/2d0f883))
- **The overlay loads again in a page the host serves.** `/.lr/overlay.js` and
  `/.lr/bridge.js` are static assets with no review data in them, so they are
  served the way the vendored html2canvas already was: a `<script>` tag cannot
  carry a header, and the secret requirement kept the overlay from loading at
  all.
  ([`2d0f883`](https://github.com/klaus-2/dsh-redline/commit/2d0f883))
- **The page keeps its own settings.** The client used to overwrite the page
  config when it injected the overlay, which dropped the language and the
  hotkeys. The config is merged now, and the settings reach the overlay in
  both modes.
  ([`2d0f883`](https://github.com/klaus-2/dsh-redline/commit/2d0f883))
- **A page cannot wipe the pending annotations.** Submitting an empty
  annotation set through the bridge left the snapshot alone; the user discards
  it from the card.
  ([`2d0f883`](https://github.com/klaus-2/dsh-redline/commit/2d0f883))
- **The comments say where they come from.** A comment is now described as the
  text the Redline overlay captured on the page, and the guidance asks the
  agent to apply it together with the user's own request, never in place of
  it.
  ([`2d0f883`](https://github.com/klaus-2/dsh-redline/commit/2d0f883))

## [1.0.21] - 2026-11-08

### Added

- **The comment, pin, and adjust popovers can be moved anywhere on the
  screen.** Grabbing a panel's header bar drags it wherever you want, the
  position survives a reload and a resize, and a double-click on the header
  puts the panel back where it first appeared.
  ([`d959d61`](https://github.com/klaus-2/dsh-redline/commit/d959d61))

## [1.0.20] - 2026-11-08

### Fixed

- **The update row survives the plugin being reloaded.** Installing a new
  version takes the plugin's host half down for a moment, and the row then
  said the service was unreachable and showed a version number it had
  invented. It now remembers the version it installed, asks for the restart
  instead of showing an error, and never shows a version it does not know.
  ([`6da07c8`](https://github.com/klaus-2/dsh-redline/commit/6da07c8))

## [1.0.19] - 2026-11-08

### Fixed

- **The update check no longer fails when GitHub's hourly quota runs out.**
  The row asked GitHub for the latest release, and that API answers 403 once
  an unauthenticated caller spends its sixty requests an hour, so the row
  could say the check had failed even with a release waiting. The version now
  comes from the registry, which says what can actually be installed and has
  no such quota; the release notes are read from GitHub on a best effort
  basis, and a blocked notes request no longer breaks the check.
  ([`dc695b3`](https://github.com/klaus-2/dsh-redline/commit/dc695b3))

## [1.0.18] - 2026-11-08

### Fixed

- **The update row keeps the release page link.** It only appeared while an
  update was waiting, so a plugin that was already up to date had no way to
  reach the notes of the version it was running.
  ([`80b4969`](https://github.com/klaus-2/dsh-redline/commit/80b4969))

## [1.0.17] - 2026-11-08

### Fixed

- **The update goes through the host, so a broken package never reaches your
  profile.** The plugin used to install the new version with its own `pnpm`
  call, which meant the host never checked the package it had just installed.
  A release missing a file the host reads (the bundle patch) was installed
  anyway and broke the dsh on the next start. The update goes through the
  host's plugin manager now, the same way the host's own plugins do, and falls
  back to the plugin's own route only where there is no managed profile.
  ([`3ed7b8d`](https://github.com/klaus-2/dsh-redline/commit/3ed7b8d))
- **The update row only offers a release the registry already has.** A release
  can reach GitHub before it reaches npm; offering it then failed the install
  for a reason that had nothing to do with your profile.
  ([`3ed7b8d`](https://github.com/klaus-2/dsh-redline/commit/3ed7b8d))
- **The update row names the failure instead of the install's progress.** The
  message it showed was the first line of the install log, pnpm's own
  progress, so a refused install looked like a network problem. It now shows
  the line the host refused on.
  ([`3ed7b8d`](https://github.com/klaus-2/dsh-redline/commit/3ed7b8d))

### Removed

- **The "Release notes" link in the update row.** It opened a panel that only
  appeared while an update was waiting, so it looked broken, and the release
  page button next to it already carries the notes.
  ([`ed161b2`](https://github.com/klaus-2/dsh-redline/commit/ed161b2))

## [1.0.16] - 2026-11-08

### Fixed

- **Update now works on profiles that enforce a package age policy.** The
  in-app update runs `pnpm add` in the user's profile, and a profile with a
  minimum release age (or a lockfile entry for a package published in the
  last 24 hours) made that install fail with a supply-chain policy error. The
  update passes `minimumReleaseAge=0` and `minimumReleaseAgeStrict=false` for
  its own install now, so it updates the plugin it was asked to update and
  nothing else.
  ([`784957b`](https://github.com/klaus-2/dsh-redline/commit/784957b))

## [1.0.15] - 2026-11-08

### Fixed

- **Screenshots work again.** The overlay loads the vendored html2canvas with
  a plain `<script src>`, which cannot carry the instance secret; since
  v1.0.14 that request was rejected and every screenshot failed to capture.
  The vendored library under `/.lr/vendor/` is a public MIT asset with no
  review data in it, so it is served without the secret again. Every other
  `/.lr/*` route keeps the instance-secret requirement and the restricted
  origins.
  ([`fc6a4b7`](https://github.com/klaus-2/dsh-redline/commit/fc6a4b7))

## [1.0.14] - 2026-11-08

### Changed

- **The protected loopback contract shipped again with the full security
  notes.** The loopback server keeps the instance secret and the restricted
  origins; this release republishes it so the install notes describe the whole
  contract.
  ([`9e407ab`](https://github.com/klaus-2/dsh-redline/commit/9e407ab))

## [1.0.13] - 2026-11-07

### Fixed

- **The loopback server no longer serves review data and screenshots to anyone
  who can reach 127.0.0.1.** The host creates a random 32-byte instance secret
  on first boot and keeps it in the profile
  (`~/.dsh/profiles/<profile>/dsh-redline/instance.secret`, mode 0600). Every
  `/.lr/*` route except the public health probe requires it now, as a header,
  a `Bearer` token, or a `key` query parameter for image loads. Requests
  without it get `401` and no CORS headers, so a page on any other site can
  neither read the review data nor drive the control routes. No more
  `access-control-allow-origin: *`: a response echoes the caller's origin only
  when the request carries the valid secret, and unauthenticated answers carry
  no CORS headers at all. The secret travels over the authenticated Harness
  connection: the client reads it from `GET /api/dsh-redline.secret`, the same
  authenticated channel the dsh uses for plugin routes, and hands it to the
  overlay it injects into the harness browser. The secret file itself stays
  inside the profile and is not served.
  ([`202a8ce`](https://github.com/klaus-2/dsh-redline/commit/202a8ce))
- **The in-app update survives a reboot.** The update installed with the
  `pnpm` found on `PATH`; the harness ships its own runtime pnpm, so the
  install did not survive the next restart. The update goes through the
  runtime pnpm the harness itself uses now.
  ([`6f398ea`](https://github.com/klaus-2/dsh-redline/commit/6f398ea))

## [1.0.12] - 2026-11-07

### Fixed

- **The updates row no longer overflows the settings panel.** A long release
  note pushed the row past the panel width. The row wraps now, and the release
  notes open inside the same panel instead of under the row.
  ([`c06f788`](https://github.com/klaus-2/dsh-redline/commit/c06f788))

## [1.0.11] - 2026-11-07

### Fixed

- **The plugin manager shows the name and the description.** The plugin did
  not declare the locale service, so the metadata carried by
  `locale/<lang>.json` never reached the manager and the entry showed up
  blank.
  ([`ceec973`](https://github.com/klaus-2/dsh-redline/commit/ceec973))

## [1.0.10] - 2026-11-07

### Fixed

- **A profile install resolves the locale files and the manifest.** The
  package only exported its main entry, so `dsh-redline/locale/<lang>.json`
  and `dsh-redline/package.json` could not be read from an installed copy.
  Both subpaths are exported now.
  ([`9e96ee3`](https://github.com/klaus-2/dsh-redline/commit/9e96ee3))

## [1.0.9] - 2026-11-07

### Fixed

- **The inspector rows and the pending counter follow the language.** They
  looked up their translation by passing the Portuguese label as the key, so
  they fell back to the untranslated text. They resolve through the `prop.*`
  and pending keys now, which every language carries.
  ([`6603e2f`](https://github.com/klaus-2/dsh-redline/commit/6603e2f))

## [1.0.8] - 2026-11-07

### Fixed

- **The draft comment placeholder follows the language setting.** It was
  hardcoded in English while the rest of the overlay translated.
  ([`55f98ef`](https://github.com/klaus-2/dsh-redline/commit/55f98ef))

## [1.0.7] - 2026-11-07

### Added

- **In-app updates, Composer Plus style.** When a newer release exists, the
  Updates row offers Update now: the host fetches the release files from the
  version tag, stages and verifies them, swaps them into the plugin directory
  and reports installed, with a restart of the dsh to load it. Local
  development copies (a `.git` in the plugin directory) are refused with a
  git-pull note.
  ([`633aec1`](https://github.com/klaus-2/dsh-redline/commit/633aec1))

### Fixed

- **Settings actually load from disk now.** The host used `readFileSync`
  without importing it, so every boot silently fell back to defaults and the
  language, hotkeys and screenshot padding reset on each restart.
  ([`633aec1`](https://github.com/klaus-2/dsh-redline/commit/633aec1))

## [1.0.6] - 2026-11-07

### Fixed

- **The adjust inspector and the draw dock follow the language setting.**
  Property labels (text color, background, font, weight, line height, letter
  spacing and the rest) were hardcoded in Portuguese and looked up by their
  own text; they resolve through the locale keys now, the dock tooltips
  re-render on a language change, and the counter, restored-pins and delivered
  toasts are locale-driven.
  ([`b7f7eac`](https://github.com/klaus-2/dsh-redline/commit/b7f7eac))

## [1.0.5] - 2026-11-07

### Added

- **Changing the language in the settings now applies to the live overlay.**
  The overlay resolved its language once per page load and kept it until the
  page reloaded; the status poll carries the configured language now and the
  toolbar labels, titles, hotkey chips and pending counter re-render when it
  changes. The pending counter, restored-pins toast and delivered toast are
  locale-driven instead of hardcoded Portuguese.
  ([`8f7c84d`](https://github.com/klaus-2/dsh-redline/commit/8f7c84d))

## [1.0.4] - 2026-11-07

### Fixed

- **Internal server errors no longer masquerade as CORS failures.** The
  catch-all error response omitted the `Access-Control-Allow-Origin` header,
  so a failing route surfaced in the app console as a blocked cross-origin
  request instead of the real 500. Error responses carry the CORS header now
  and the underlying error is logged to the host console.
  ([`1d42baa`](https://github.com/klaus-2/dsh-redline/commit/1d42baa))

## [1.0.3] - 2026-11-07

### Fixed

- **The overlay resets after the annotations are delivered.** Sent pins stayed
  on the page as dimmed markers with their popovers; the delivery event now
  clears the queued pins, the draft popover and the highlight, so the overlay
  starts clean for the next review.
  ([`f901e33`](https://github.com/klaus-2/dsh-redline/commit/f901e33))
- **The delete button closes the pin popover.** It removed the pin but left
  the comment panel open on screen.
  ([`f901e33`](https://github.com/klaus-2/dsh-redline/commit/f901e33))

## [1.0.2] - 2026-11-07

### Fixed

- **The card's send button delivers with an empty composer, with or without
  composer-plus.** The send path only carried the annotations when the
  composer draft was non-empty; with an empty draft it fell back to a
  conversation call that, outside composer-plus, queued the message instead of
  starting the turn, leaving the pins pending. The prompt is written into the
  composer through the native value setter plus an input event and submitted
  through the shell now, with the conversation call kept only as a reported
  fallback.
  ([`2399a15`](https://github.com/klaus-2/dsh-redline/commit/2399a15))

## [1.0.1] - 2026-11-07

### Added

- **The plugin manager shows Redline with its icon and description.** The list
  reads `meta.title` and `meta.description` from the plugin locales and an
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
  [tencil](https://tencil.dev/) (Apache-2.0, modified; see
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
  ([`e9702aa`](https://github.com/klaus-2/dsh-redline/commit/e9702aa))
- **Adjust styles live with rollback.** The inspector covers colors,
  typography, size, spacing, borders, constraints, shadow and transform, with
  drag-to-scrub numbers, presets, linked box-model and radius edits and a
  per-row reset; every tweak records as `before → after` and Esc rolls it
  back.
  ([`e9702aa`](https://github.com/klaus-2/dsh-redline/commit/e9702aa))
- **Annotations reach the agent as structured context.** Confirming collects
  the pins into a card above the composer; sending attaches the snapshot to
  the next message of the viewed session, rendered natively in the chat, with
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
  settings page inside the harness settings covers language, hotkeys,
  screenshot padding and the update check.
  ([`5fdc41f`](https://github.com/klaus-2/dsh-redline/commit/5fdc41f))
