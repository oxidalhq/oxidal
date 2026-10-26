# Oxidal

Native Rust foundation for a NAM/LV2 guitar appliance, with a browser control interface and OS recipes. The current build implements routing validation, shared web/MIDI control state and an immutable native preset library; it does not process live guitar audio. Owned NAM Linear/LSTM inference is tested separately; WaveNet/A2 and native audio hosting remain unimplemented.

| Path        | Content                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------- |
| `crates/`   | Graph validation, control state, HTTP/SSE API, native preset storage and owned NAM inference |
| `apps/web/` | React/TypeScript interface and browser integration tests                                     |
| `os/`       | Pinned Trixie base manifest and safe provisioning recipe                                     |
| `scripts/`  | Reproducible development, verification and packaging commands                                |
| `docs/`     | Product architecture and contributor documentation                                           |

Oxidal targets existing **x86-64 Linux laptops/desktops** and **Raspberry Pi ARM64**, with **Orange Pi as a board-specific candidate**. The portable application and board images have separate installation and qualification paths; see the [Linux target plan](os/README.md#target-installation-routes). Live audio and installation support for these targets are not yet qualified.

## Run the local PoC

Use Node **22.21.0**, pnpm **10.32.1**, and Rust **1.95.0**. On a fresh machine:

```sh
rustup toolchain install 1.95.0 --profile minimal --component clippy,rustfmt
# Install/select Node 22.21.0 with your existing Node version manager.
npm install --global pnpm@10.32.1
# macOS shell checks; disable unrelated Homebrew updates/cleanup.
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install shellcheck shfmt
pnpm bootstrap
pnpm hooks:install
pnpm dev
```

On Linux, install ShellCheck, shfmt, `libasound2-dev` and `pkg-config` with the distribution package manager (Debian/Ubuntu names). `pnpm bootstrap` performs locked dependency installation, installs workspace-local Rust dependency tools and Chromium, and fetches native dependencies. Browser system dependencies may also be needed on Linux (`pnpm --dir apps/web exec playwright install --with-deps chromium`).

Open **http://127.0.0.1:5173**. Rust runs on port 3210; Vite proxies the versioned API. The service listens on loopback only. No Pi is needed. See [core](docs/core.md), [web](apps/web/README.md), [OS recipes](os/README.md), and [our NAM crate](crates/oxidal-nam/README.md).

Try this:

1. Select **Parallel** and inspect paths A/B merging into the shared wet section.
2. Open **Settings**, send MIDI value **127**, then return to the rig: NAM A becomes 100%. A second browser tab updates too.
3. Change NAM A on the web; Settings shows the confirmed MIDI feedback value.
4. Try MIDI learn, pickup, range/scaling, or map a CC to bypass/preset selection. These are control-state operations; they process no audio.
5. Use **Edit** beside a numeric control to preview an exact percentage, then **Commit** or **Cancel**. Another browser sees the preview and cannot overwrite its target.
6. Open the rig validation inspector, remove the nodes, and validate: the Rust service rejects it.
7. Disconnect/reconnect the browser: editing disables, and the current daemon snapshot returns. MIDI simulation can run through the API with no browser open.

Open **Library** to import a `.t3kpreset`, retain its original bytes and download it unchanged. This does not load or play the preset.

MIDI mappings and imported originals persist; rig/parameter state resets on restart. The MIDI device is a simulator. NAM inference is tested independently; ALSA/LV2 live hosting, WaveNet/A2, provider login/downloads, target-phone qualification, and physical controller feedback remain later work. **Use a fresh, separate SD card for all Pi provisioning; preserve the existing working installation.**

The optional [native TONE3000 adapter](docs/native-tone3000.md) is an offline integration spike. `pnpm native:check` builds and qualifies the real processor separately; it does not enable audio in this preview.

## Verify and prepare releases

```sh
pnpm check
pnpm guardrails:prove
pnpm contract:check
pnpm release:dry-run
```

Stop `pnpm dev` before e2e/aggregate checks; tests own their local service and ports. Run the negative-fixture proof separately from other checks. See [development and release policy](docs/development.md) for checks and versioning. Nothing is pushed or published by these local commands.

The [draft Oxidal preset specification](docs/presets/format.md) describes native TONE3000 preservation, mixed rigs and explicit conversion/export rules. Run `pnpm presets:check` for manifest/schema checks; this does not establish runtime compatibility.

### Optional native preset editing

After `pnpm native:check` builds and verifies the pinned native backend on macOS, run `OXIDAL_NATIVE_EDITOR=1 pnpm preview`. Library provides real preset load, preview/cancel/commit, owned-copy save and reload. Five controls are qualified in this slice; imported originals stay immutable. Audio output, native Linux hosting and full settings parity are still pending. See [native editor](docs/native-tone3000.md).

Linux builds expose **Settings → Audio devices** for real ALSA hardware discovery and exact non-streaming configuration checks. Playback remains unavailable. See [audio devices and lifecycle](docs/audio.md).
