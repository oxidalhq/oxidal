# Development and delivery

Use the pinned Node 22.21.0, pnpm 10.32.1 and Rust 1.95.0 toolchains. `pnpm bootstrap` installs locked dependencies and local verification tools. `pnpm hooks:install` installs repository hooks without replacing a different existing hooks configuration.

`pnpm check` runs Rust formatting, Clippy, tests, contract drift checks, web formatting/lint/type/unused checks, unit tests, production build, OS fixture checks, tooling tests, dependency checks and browser e2e. Stop any running preview/dev server first; tests own ports 3210 and 5173. Run `pnpm guardrails:prove` separately to verify negative lint/type/format/unused fixtures.

Commits use a single Conventional Commit title, at most 100 characters, with no body. Use a GitHub noreply identity when personal email privacy is required. Stage and review only product files. Repository boundary checks reject private workspace paths and obvious credentials/local paths; they supplement review and are not a comprehensive secret detector.

Release-please prepares separate core (`.`), UI (`apps/web`) and OS (`os`) version PRs. Before 1.0, features and breaking changes bump minor; fixes bump patch. After 1.0, breaking changes bump major. Version PRs do not create GitHub releases. Reviewed component tags (`core-v*`, `ui-v*`, `os-v*`) build preview artifacts; package publication and qualified appliance deployment are separate. Root Node package version is tooling metadata, not an independent release unit.

`pnpm release:dry-run` checks version consistency locally. `pnpm release:artifacts` packages a native-host preview, web assets and OS recipe with checksums and source revision. This is not a flashable Pi image. Remote workflows, branch protection and bot activation require remote configuration; local checks do not establish them.

Physical audio, gapless switching/trails, real MIDI transport, target-phone performance, image boot and recovery require independent qualification. Use a fresh SD card for Pi tests and preserve any existing working installation.
