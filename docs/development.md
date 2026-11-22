# Development and delivery

Use the pinned Node 22.21.0, pnpm 10.32.1 and Rust 1.95.0 toolchains. `pnpm bootstrap` installs locked dependencies and local verification tools. `pnpm hooks:install` installs repository hooks without replacing a different existing hooks configuration.

`pnpm check` runs Rust formatting, Clippy, tests, contract drift checks, web formatting/lint/type/unused checks, unit tests, production build, OS fixture checks, tooling tests, dependency checks and browser e2e. Stop any running preview/dev server first; tests own ports 3210 and 5173. Run `pnpm guardrails:prove` separately to verify negative lint/type/format/unused fixtures. When a development server is already running, set `OXIDAL_E2E_API_PORT` and `OXIDAL_E2E_WEB_PORT` to two available local ports for the release check. Media tests exercise the real free-space reserve on the filesystem containing their temporary directory.

Commits use a single Conventional Commit title, at most 100 characters, with no body. Use a GitHub noreply identity when personal email privacy is required. Stage and review only product files. Repository boundary checks reject private workspace paths and obvious credentials/local paths; they supplement review and are not a comprehensive secret detector.

Release-please prepares separate core (`.`), UI (`apps/web`) and OS (`os`) version PRs. Before 1.0, features and breaking changes bump minor; fixes bump patch. After 1.0, breaking changes bump major. Version PRs do not create GitHub releases. Reviewed component tags (`core-v*`, `ui-v*`, `os-v*`) build preview artifacts; package publication and qualified appliance deployment are separate. Root Node package version is tooling metadata, not an independent release unit.

`pnpm release:dry-run` checks version consistency locally. `pnpm release:artifacts` packages a native-host preview, web assets and OS recipe with checksums and source revision. This is not a flashable Pi image. Remote workflows, branch protection and bot activation require remote configuration; local checks do not establish them.

Physical audio, gapless switching/trails, real MIDI transport, target-phone performance, image boot and recovery require independent qualification. Use a fresh SD card for Pi tests and preserve any existing working installation.

## Dependency ownership

The app and Storybook use `@oxidal/design-system` from `packages/ui`. Radix primitives, the shared Tailwind theme and class utilities belong to that package. The app declares its own direct imports, including React, Phosphor icons, Recharts, Ajv and xterm. The workspace locks the JavaScript packages in `pnpm-lock.yaml`.

The LV2 crate uses `url` for plugin resource URLs. Its Linux worker feature enables the device crate and Tokio alongside ALSA support. Rust versions and features are recorded in the crate manifests and `Cargo.lock`.

`node scripts/dependencies.mjs` runs the Rust advisory and licence checks, checks for unused Rust dependencies, and audits the pnpm lockfile at the high-severity threshold. The root check runs this before the browser suite. [Third-party licensing](../THIRD_PARTY.md)

## Automatic Markdown formatting

Prettier 3.9.10 formats Markdown and tables consistently. `pnpm format:md` formats the documentation tree; `pnpm format:md:check` checks it. The aggregate `pnpm check` includes Markdown formatting checks.

Installed pre-commit hooks automatically format staged Markdown with pinned `git-format-staged` 4.0.2. Only staged content enters the commit; unstaged edits remain unstaged, including in partially staged files. Formatting conflicts leave the working file intact. Run `pnpm install --frozen-lockfile` and `pnpm hooks:install` in each new checkout/worktree before committing. This requires Node, pnpm and Python 3, already part of the development environment.

VS Code settings enable Markdown format-on-save and recommend `esbenp.prettier-vscode`. Install that recommended extension for editor formatting; the Git hook works independently of the editor. Generated/dependency/build trees are excluded. Never replace formatting with a manual table-alignment step.

## Preset-library verification

`pnpm check` includes the native reader/store tests, HTTP integration tests, a real daemon termination/restart test, and Playwright desktop/mobile upload/download flows. Tests use isolated temporary storage. The browser flows exercise real file upload, deduplication, a second tab, reload, byte-exact download and rejected corrupt input while checking that the rig remains unchanged. They also run accessibility and horizontal-overflow checks. API tests cover storage failure, oversized uploads and cross-origin rejection. No auxiliary test runner is needed.

The committed native fixtures are tiny project-authored JUCE files without model weights. An optional, ignored-by-default Rust test qualifies all eight hash-pinned upstream factory files when separately available; see [fixture provenance and the repeatable command](../crates/oxidal-presets/tests/fixtures/README.md). Ordinary checks require neither those assets nor an upstream checkout. A skipped external-corpus test is not factory qualification; record its explicit run separately.

`pnpm dev` and `pnpm preview` retain originals in `.local/presets`. Direct daemon launches can set `OXIDAL_PRESET_DIR`; the default is `.local/presets` relative to the working directory. Do not point tests at a user's library. These flows qualify storage and control behavior, not native preset editing/playback or physical audio.

## Control-preview regression coverage

The ordinary `pnpm check` suite exercises edit ownership, sequence conflicts, exact terminal values, bounded receipts, cancel/expiry rollback, MIDI/preset takeover and recovery after transport failure. Browser cases use two clients and the real daemon, and deliberately wait for the real 30-second lease on desktop and mobile emulation. They cover navigation cancellation, a disconnected preview, retained local draft without replay, and accessibility/overflow with the editor open. The lease tests add about one minute to the suite; no test-only timeout setting or separate test script is needed.

## Optional Linux LV2 qualification

Install `liblilv-dev lv2-dev swh-lv2` on Debian/Ubuntu and run `pnpm lv2:check` for the native host and control-to-DSP graph suite. Linux CI runs the same gate after the standard checks. See [LV2 hosting](lv2.md) for supported plugins, graph semantics and current integration limits. Default macOS and cross-compilation checks keep the native feature disabled.

### Browser tests alongside a running preview

The maintained Playwright suite always starts its own daemon and web server. To
leave an existing preview running, choose a separate pair of unused loopback ports:

```sh
OXIDAL_E2E_API_PORT=3211 OXIDAL_E2E_WEB_PORT=5174 pnpm test:e2e
```

The API proxy and browser requests use that pair together. Defaults remain 3210
and 5173; occupied test ports fail rather than reusing a potentially unrelated
server or its preset library. Native-worker qualification flags remain unchanged.

### Shared UI runtime contracts

The product imports runtime UI through `@oxidal/design-system` exports. Reference
screens and `*.demo.tsx`, `*.fixtures.ts` and `*.data.ts` are Storybook inputs;
they must not supply product state. The existing product stores, edit queues and
shared feeds retain ownership of audio, media, jobs and saved data.

`RigSurface` accepts confirmed comparison, scenes and transition settings, with
explicit request callbacks. A comparison request does not change its hearing
indicator until readback. Supply the complete product change list and Discard
command when state extends beyond the visual route. Route projections are not
lossless audio transactions. Shared numeric fields report values; the product
queue owns preview, commit, cancel, session identity and stale-response guards.
Relative touch adjustment keeps Fine, restore and pointer-cancellation behaviour.

`PracticePanel` reads a complete confirmed value and emits only explicit edits;
mounting another view never sends defaults. `StemWorkspace` reads the confirmed
mix and delegates runtime Undo/Redo to its shared owner. Its bounded local history
is for isolated editors/stories. `VenueEq` reads confirmed output/profile state
and emits no audio commands on mount or remote readback. Profile writes are
requests to the product store; they must be confirmed before selection changes.

The AppShell reads one shared monitor feed through the product adapter. Simple
health stays visible with the sticky masthead; Detailed shows the full strip.
Navigation retains the product's leave guards and existing hash aliases.

### Product layout review

`pnpm --dir apps/web layout` checks the actual product pages, rather than the
Storybook examples, at the six representative Storybook widths in Default,
Night, Sunlight and E-paper, in both orientations. It reuses the isolated
Playwright daemon/web servers and the port overrides above. These are Chromium
viewport checks; existing functional WebKit coverage and physical phone/e-paper
acceptance remain separate.

The initial sweep visits the stopped Rig, Guitars, Levels and existing Library
and Settings sections. It verifies content/theme readiness and reports horizontal
overflow, visible control geometry and page errors, attaching full-page captures
for findings and a JSON report for every case. A failure does not stop inspection
of later surfaces. The command fails when findings exist; it is not a visual
approval or an audio measurement. Add populated rigs, Stage, overlays and new
sections as their product integrations land. Reviewers distinguish primary touch
targets from secondary compact controls when classifying geometry findings.

Run a focused case while developing:

```sh
pnpm --dir apps/web layout --project=iphone-16 --grep 'default · portrait'
```

The layout command is separate from root checks while its existing-product
baseline is being established; no existing failures are suppressed as passes.

## Import order

ESLint enforces import order using `eslint-plugin-simple-import-sort`, with one
configuration shared by tooling, web, Storybook and the UI package. Keep external
packages/Node built-ins first, `@oxidal/*` workspace libraries second and relative
modules last, with one blank line between groups. Paths and named specifiers are
sorted automatically; type imports follow the same grouping. All imports belong
above executable declarations. Side-effect imports keep their relative order
within a group, including CSS initialization.

Run the package's `pnpm exec eslint . --fix`, followed by its Prettier formatter.
The repository VS Code settings enable ESLint fixes on explicit save. Prettier
handles formatting and does not compete with ESLint for import sorting.
