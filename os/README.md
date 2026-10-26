# Oxidal Linux targets and OS recipes

## Target installation routes

Oxidal targets ordinary Linux computers as well as Raspberry Pi. The same Rust daemon, native audio/plugin adapters, preset formats and browser UI serve both; GPIO or Oxidal Deck must not be prerequisites for playback or control.

| Target                            | Planned delivery                                                                                                          | Qualification boundary                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Older x86-64 laptops and desktops | Install Oxidal into an existing Linux distribution; start with a Debian/Ubuntu-family package and documented dependencies | Exact distribution release, minimum CPU instruction set, native plugin builds, audio devices and performance must be qualified. Existing desktop, network and boot configuration are preserved. |
| Raspberry Pi 5, then Pi 4         | ARM64 application plus a separate, board-qualified OxidalOS appliance image                                               | Pi 5 + Hotone Jogg remains the first hardware baseline; Pi 4 needs its own performance measurements.                                                                                            |
| Orange Pi (candidate)             | Reuse the ARM64 application where compatible; add an image/profile only for a selected board                              | No model is selected. Board revision, SoC, bootloader, kernel, USB audio and cooling need separate qualification. A Raspberry Pi image is not an Orange Pi image.                               |

Initial laptop scope is **64-bit x86 Linux**, not every legacy 32-bit laptop. The first distribution/release baseline and packaging format remain to be qualified; this is a target policy, not a supported-hardware list. On laptops, built-in ALSA audio and USB interfaces are candidates; the selected input/output combination must pass the same latency and xrun checks. Older CPUs need measured model/rig budgets, including switching overlap, rather than an assumption that every rig fits.

Keep platform configuration separate from portable runtime logic. A regular Linux install must not apply Pi boot settings, replace the host network setup, strip desktop packages, or require appliance partitioning. Audio permissions, scheduling and optional service startup must be explicit installation steps. Appliance read-only partitions and future A/B recovery belong to board-image profiles, not mandatory laptop setup.

**Current evidence:** the artifact script packages the build host's native preview and web assets; the configured artifact workflow targets Linux x64. These are control previews, not a completed Linux audio installer or bootable image. ARM64 Linux compile checks do not prove ARM execution, Orange Pi compatibility or audio performance. Native audio hosting, laptop packaging and physical qualification remain pending. Extend the existing OS tests, normal build checks and browser E2E for these routes; keep board/audio qualification results separate.

## General audio-device support target

Jogg is one test fixture, not a device restriction. Discover and configure compatible Linux ALSA devices, including USB interfaces, built-in audio and board audio. Probe capture/playback, channel layouts, sample rates, sample formats, buffer/period constraints and busy status. Allow input/output channel selection and separate input/output devices; independently clocked combinations require drift handling and sustained duplex qualification. Do not hard-code a vendor or card index.

Persist resolvable device identities with duplicate-device handling. Show negotiated settings and actionable busy/missing/unsupported errors. Stage configuration changes with rollback where possible, handle reconnect predictably, and never silently switch live output to a different device. Keep device configuration and calibration separate from tone presets. A Linux driver does not prove that every audio configuration meets Oxidal's latency requirements. These capabilities are planned; native ALSA hosting remains unimplemented. Extend existing native/service suites and hardware qualification rather than creating ad hoc scripts.

## Planned headless and desktop workflows

Appliance images should boot to a headless/CLI environment and start audio, local network access and the web server without a graphical login. Playback and browser editing must work without a desktop. An optional, manually started desktop session on the same installation will allow authoring with the official upstream TONE3000 standalone application. Existing laptop desktops and boot defaults are preserved.

Initially, use explicit audio ownership handoff: resolve unsaved edits and release Oxidal audio before launching standalone; close/release standalone audio before reacquiring the interface and restoring a validated Oxidal rig. This switch interrupts audio. The two applications do not share a live processor instance. Control/web services can remain available if their lifecycle is independent of the audio engine.

Transfer compatible sounds through explicit validated `.t3kpreset` import/export. Calibration, oversampling, MIDI mapping and audio-device settings are separate from preset tone data. Do not automatically load desktop file changes into a playing rig. Mixed external-LV2/Oxidal rigs stay in Oxidal's editor; standalone authoring is not embedded plugin GUI hosting.

The planned **Use TONE3000 — stop Oxidal** action must be owned by an external desktop launcher/service manager. Preflight app availability and graphical-session access, resolve edits, stop the service cleanly and wait for daemon/worker exit before launching standalone. A timeout must not start a competing audio client. Stop/restart operations must be narrowly authorized; the browser cannot supply arbitrary commands. Prevent service restart and duplicate requests from racing the handoff.

Stopping `oxidald` also stops its HTTP/SSE server. **Return to Oxidal** therefore belongs in the desktop launcher/service manager, with CLI recovery independent of the web app. Release standalone audio before restarting Oxidal; reconnect only after readiness, with a fresh daemon session. Recover through a controlled restart if standalone launch fails, and report failed recovery. Do not automatically terminate unrelated standalone sessions or change the next boot default. Existing integration/browser suites must cover prerequisites, unsaved edits, timeout, duplicate requests, launch failure, return and recovery.

**Planned, not delivered:** desktop packaging, mode-switch commands, native Linux audio, service handoff/recovery and Pi ARM64 standalone qualification. Verify the upstream app's exact architecture, release availability and runtime dependencies; an Oxidal-patched build is not an official release. Keep the live path independent of a running display server while retaining any libraries required by the selected native plugin build. Extend existing packaging/service/E2E tests for boot, handoff, failure recovery and preset transfer; qualify audio performance on each target.

## Raspberry Pi recipe foundation

This PoC pins Raspberry Pi OS Lite arm64 Trixie (2026-10-06) and its vendor SHA-256 in `manifests/base.json`. Source: [official Raspberry Pi downloads](https://www.raspberrypi.com/software/operating-systems/). No desktop stripping, package removal, block-device flashing, or service activation is performed by these scripts.

Run checks from the repository root:

```sh
sh os/scripts/check.sh
python3 os/scripts/provision.py --check-manifest
```

The check needs Python 3.9+, ShellCheck, and shfmt. A fixture dry run needs an explicitly marked disposable root. On macOS, use the resolved `/private/tmp` path (the tool deliberately rejects symlinked roots):

```sh
mkdir -p /private/tmp/oxidal-image-fixture/etc
touch /private/tmp/oxidal-image-fixture/.oxidal-disposable-root
printf 'ID=debian\nVERSION_CODENAME=trixie\n' > /private/tmp/oxidal-image-fixture/etc/os-release
python3 os/scripts/provision.py --target-root /private/tmp/oxidal-image-fixture
python3 os/scripts/provision.py --target-root /private/tmp/oxidal-image-fixture --apply
python3 os/scripts/provision.py --target-root /private/tmp/oxidal-image-fixture --apply
```

The final invocation must report no changes. Only the unit file and versioned base manifest are staged. The recipe refuses host/device roots, unmarked/wrong-base roots, and managed paths containing symlinks. The service expects a separately supplied executable and built web assets under `/opt/oxidal`; it remains disabled. Loopback-only service access is deliberate until LAN pairing/security exists. Audio-device permissions and scheduling will be qualified with the native host.

To verify a separately downloaded image without writing a device:

```sh
python3 os/scripts/provision.py --verify-image /path/to/2026-10-06-raspios-trixie-arm64-lite.img.xz
```

Physical installation is a later step: identify the **new, separate SD card** by capacity/serial/device identity, verify the base-image hash, write only that card using an explicitly reviewed target, then qualify boot/services/audio. Preserve the existing working card and installation. This recipe intentionally has no flashing command to guess a device for you.

Recovery for this stage is to power down and use the untouched original card; a failed disposable root can be recreated from the pinned image. A flashable Oxidal image, exact installed-package closure, power-loss durability, and A/B updates/rollback are still unqualified. Host fixture tests do not prove image boot or hardware recovery.
