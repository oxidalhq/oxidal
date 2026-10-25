# Development and delivery

Use the pinned Node 22.21.0, pnpm 10.32.1 and Rust 1.95.0 toolchains. `pnpm bootstrap` installs locked dependencies and local verification tools. `pnpm hooks:install` installs repository hooks without replacing a different existing hooks configuration.

`pnpm check` runs Rust formatting, Clippy, tests, contract drift checks, web formatting/lint/type/unused checks, unit tests, production build, OS fixture checks, tooling tests, dependency checks and browser e2e. Stop any running preview/dev server first; tests own ports 3210 and 5173. Run `pnpm guardrails:prove` separately to verify negative lint/type/format/unused fixtures.

Commits use a single Conventional Commit title, at most 100 characters, with no body. Use a GitHub noreply identity when personal email privacy is required. Stage and review only product files. Repository boundary checks reject private workspace paths and obvious credentials/local paths; they supplement review and are not a comprehensive secret detector.

Release-please prepares separate core (`.`), UI (`apps/web`) and OS (`os`) version PRs. Before 1.0, features and breaking changes bump minor; fixes bump patch. After 1.0, breaking changes bump major. Version PRs do not create GitHub releases. Reviewed component tags (`core-v*`, `ui-v*`, `os-v*`) build preview artifacts; package publication and qualified appliance deployment are separate. Root Node package version is tooling metadata, not an independent release unit.

`pnpm release:dry-run` checks version consistency locally. `pnpm release:artifacts` packages a native-host preview, web assets and OS recipe with checksums and source revision. This is not a flashable Pi image. Remote workflows, branch protection and bot activation require remote configuration; local checks do not establish them.

Physical audio, gapless switching/trails, real MIDI transport, target-phone performance, image boot and recovery require independent qualification. Use a fresh SD card for Pi tests and preserve any existing working installation.

## Automatic Markdown formatting

Prettier 3.9.10 formats Markdown and tables consistently. `pnpm format:md` formats the documentation tree; `pnpm format:md:check` checks it. The aggregate `pnpm check` includes Markdown formatting checks.

Installed pre-commit hooks automatically format staged Markdown with pinned `git-format-staged` 4.0.2. Only staged content enters the commit; unstaged edits remain unstaged, including in partially staged files. Formatting conflicts leave the working file intact. Run `pnpm install --frozen-lockfile` and `pnpm hooks:install` in each new checkout/worktree before committing. This requires Node, pnpm and Python 3, already part of the development environment.

VS Code settings enable Markdown format-on-save and recommend `esbenp.prettier-vscode`. Install that recommended extension for editor formatting; the Git hook works independently of the editor. Generated/dependency/build trees are excluded. Never replace formatting with a manual table-alignment step.

## Preset-library verification

`pnpm check` includes the native reader/store tests, HTTP integration tests, a real daemon termination/restart test, and Playwright desktop/mobile upload/download flows. Tests use isolated temporary storage. The browser flows exercise real file upload, deduplication, a second tab, reload, byte-exact download and rejected corrupt input while checking that the rig remains unchanged. They also run accessibility and horizontal-overflow checks. API tests cover storage failure, oversized uploads and cross-origin rejection. No auxiliary test runner is needed.

The committed native fixtures are tiny project-authored JUCE files without model weights. An optional, ignored-by-default Rust test qualifies all eight hash-pinned upstream factory files when separately available; see [fixture provenance and the repeatable command](../crates/oxidal-presets/tests/fixtures/README.md). Ordinary checks require neither those assets nor an upstream checkout. A skipped external-corpus test is not factory qualification; record its explicit run separately.

`pnpm dev` and `pnpm preview` retain originals in `.local/presets`. Direct daemon launches can set `OXIDAL_PRESET_DIR`; the default is `.local/presets` relative to the working directory. Do not point tests at a user's library. These flows qualify storage and control behavior, not native preset editing/playback or physical audio.
