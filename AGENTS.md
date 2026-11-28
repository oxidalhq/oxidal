# AGENTS.md — Oxidal

These are the repository instructions for coding agents.

## Writing

- Use plain language in code names, comments, UI text and documentation.
- Name the specific file, model version, licence, source or build result.
- Avoid vague claims and AI-style filler. Do not call work complete when the relevant platform or hardware has not been tested.
- Keep public documentation independent of private workspaces, sprint files and reference checkouts.

## Repository

Oxidal is a monorepo with:

- Rust crates in `crates/`;
- the React/TypeScript interface in `apps/web/`;
- the shared design system in `packages/ui/` and its Storybook host in `apps/storybook/`;
- appliance image files in `os/`;
- native C++ adapters and effects in `native/`; and
- build and release tools in `scripts/`.

Read [README.md](README.md), [docs/architecture.md](docs/architecture.md) and
[docs/development.md](docs/development.md) before changing a subsystem.

## Platform boundary

- The audio appliance runs on Linux. Raspberry Pi 5 with 8 GB RAM and 64-bit Raspberry Pi OS Lite is the tested target.
- Other Linux distributions are not yet qualified.
- macOS and Windows are development hosts and browser clients, not supported audio appliances.
- The Linux audio paths use ALSA and Lilv. Keep hardware claims separate from ALSA-null, container, emulator and browser test results.

## Commands

Run commands from the repository root:

```sh
pnpm bootstrap
pnpm hooks:install
pnpm dev
pnpm preview
pnpm check
pnpm guardrails:prove
pnpm contract:check
pnpm release:dry-run
```

Use `pnpm native:check` for the optional native adapter and `pnpm lv2:check`
for Linux LV2 qualification. Browser tests require ports 3210 and 5173.

Generated API types and schemas come from Rust. Run `pnpm contract:generate`
after changing the contract; CI checks the result with `pnpm contract:check`.

## Audio and effects

- Audio workers own the device; the daemon owns control, storage and worker supervision.
- Keep allocation, file access, logging, blocking locks and process work out of audio callbacks.
- LV2 support is limited to the capabilities documented in [docs/lv2.md](docs/lv2.md). Do not claim general LV2 compatibility.
- Oxidal effects keep their algorithm sources in `REFERENCES.md` and their licence statement in `NOTICE`. Update both when an algorithm or source changes.
- Do not copy, port or translate third-party DSP source into Oxidal's original effects. Oxidal Pitch is the documented exception because it builds the pinned TONE3000 pitch engine.

## Build and release rules

- Product builds and tests must not depend on a private workspace or read-only reference checkout.
- Keep source documentation links inside this repository.
- Use the pinned Node, pnpm and Rust versions.
- Format Markdown with the pinned Prettier configuration.
- Use title-only Conventional Commits.
- Do not push, publish packages or create a release without owner approval.
- Cargo and npm publication remain disabled.

## Licences

The repository licence does not replace third-party terms. Keep
[THIRD_PARTY.md](THIRD_PARTY.md), component notices, bundled licence files and
exact source pins accurate. Do not bundle presets, captures, models, impulse
responses or artwork without confirmed redistribution rights.
