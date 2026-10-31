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

The storage-lock control follows that boundary: ordinary installs and pre-layout images report it unavailable. The appliance profile starts Unlocked. Its labelled third partition mounts at `/var/lib`, with NetworkManager profiles bind-mounted from the same partition; the final partition grows to a larger card only after its label and partition number are verified. Settings may schedule `ro systemd.volatile=state` or `rw` in the fixed firmware command line for the next boot; it never live-remounts the root. See [storage lock](../docs/storage-lock.md).

Image assembly writes explicit `rw oxidal.storage=unlocked` boot flags and removes
the vendor resize flag, because Oxidal owns the three-partition layout. In Locked
mode a systemd condition prevents the normal startup remount from overriding the
kernel's read-only root. Tmpfiles recreates nginx's log directory in volatile
`/var`; persistent `/var/lib` and the NetworkManager profile bind remain separate.
The data-grow script reads the partition number from sysfs and verifies both
partition 3 and `OXIDAL_DATA` before changing its size.

On first daemon startup, `/opt/oxidal/factory/seed.py` installs ten asset-free
factory examples through the loopback API. Its completion marker is persistent
under `/var/lib/oxidal`, so later reboots do not restore deleted examples. The
startup hook is unprivileged and nonfatal; errors are in `journalctl -u oxidald`.
The installed-image test verifies all ten examples and a repeated no-op run.
The image never includes private NAM captures or development presets by default.

`os/tests/test_storage_boot.py` exercises the actual next-boot API through
Unlocked → Locked → Unlocked → Locked on a disposable QEMU overlay. Set
`OXIDAL_TEST_STORAGE_IMAGE`, `OXIDAL_TEST_BOOT_KERNEL` and
`OXIDAL_TEST_BOOT_INITRD` as for the boot test below. It enlarges the virtual disk,
checks data growth and persistent state, attempts actual root writes, and checks
services and temporary mounts after each boot. It never writes the source image
or a physical card. This test does not replace Pi firmware, SD power-loss or
physical USB/Wi-Fi acceptance.

**Current delivery:** `node scripts/artifacts.mjs --appliance` builds a relocatable native Linux bundle containing the daemon, web UI, isolated native editor, saved-preset player, general LV2 graph worker and mixed-rig worker. `scripts/image.py` assembles that ARM64 bundle into a fresh disposable Pi OS image, installs its dependencies, enables boot services, captures the package closure and runs the installed-service qualification before producing checksums. This is an experimental first-boot image, not hardware or live-performance qualification. The ordinary artifact workflow remains a preview build; Linux laptop package lifecycle and Orange Pi images remain separate work.

## General audio-device support target

Jogg is one test fixture, not a device restriction. Discover and configure compatible Linux ALSA devices, including USB interfaces, built-in audio and board audio. Probe capture/playback, channel layouts, sample rates, sample formats, buffer/period constraints and busy status. Allow input/output channel selection and separate input/output devices; independently clocked combinations require drift handling and sustained duplex qualification. Do not hard-code a vendor or card index.

Persist resolvable device identities with duplicate-device handling. Show negotiated settings and actionable busy/missing/unsupported errors. Stage configuration changes with rollback where possible, handle reconnect predictably, and never silently switch live output to a different device. Keep device configuration and calibration separate from tone presets. A Linux driver does not prove that every audio configuration meets Oxidal's latency requirements. Hardware enumeration and exact single-endpoint configuration probes are implemented; experimental same-endpoint duplex transport and isolated saved-preset playback are implemented and tested against ALSA null. Explicit saved-session boot configuration is implemented. Physical streaming, device reconnect recovery and real-time qualification remain pending. Extend existing native/service suites and hardware qualification rather than creating ad hoc scripts.

## Planned headless and desktop workflows

Appliance images should boot to a headless/CLI environment and start audio, local network access and the web server without a graphical login. Playback and browser editing must work without a desktop. An optional, manually started desktop session on the same installation will allow authoring with the official upstream TONE3000 standalone application. Existing laptop desktops and boot defaults are preserved.

Initially, use explicit audio ownership handoff: resolve unsaved edits and release Oxidal audio before launching standalone; close/release standalone audio before reacquiring the interface and restoring a validated Oxidal rig. This switch interrupts audio. The two applications do not share a live processor instance. Control/web services can remain available if their lifecycle is independent of the audio engine.

Transfer compatible sounds through explicit validated `.t3kpreset` import/export. Calibration, oversampling, MIDI mapping and audio-device settings are separate from preset tone data. Do not automatically load desktop file changes into a playing rig. Mixed external-LV2/Oxidal rigs stay in Oxidal's editor; standalone authoring is not embedded plugin GUI hosting.

The normal **Use TONE3000** action must stop only the audio engine and release its interface, preserving `oxidald`, HTTP/SSE and silent authoring. Preflight the desktop/app, resolve edits and wait for actual audio release before launch. **Return to Oxidal** releases the managed standalone audio owner before validating and starting the Oxidal rig. Keep offline edits and preset import explicit; no automatic replacement of a playing rig.

Plan Stop/Start audio, Restart audio, Use TONE3000, Return to Oxidal, and saved audio-device settings. Whole-service shutdown/restart is an advanced maintenance action that disconnects the UI and requires recovery outside the service. See [audio lifecycle](../docs/audio.md) for ownership, failure handling and qualification requirements. Current discovery and exact probe endpoints work on ALSA-feature Linux builds; experimental Start/Stop/Restart now keep authoring available, including opt-in saved-session restoration on daemon startup; managed desktop handoff and hardware qualification remain pending.

**Planned, not delivered:** desktop packaging, managed mode-switch commands, physical audio qualification and Pi ARM64 standalone qualification. Verify the upstream app's exact architecture, release availability and runtime dependencies; an Oxidal-patched build is not an official release. Keep the live path independent of a running display server while retaining any libraries required by the selected native plugin build. Extend existing packaging/service/E2E tests for boot, handoff, failure recovery and preset transfer; qualify audio performance on each target.

## Build the first Pi prototype image

The base is Raspberry Pi OS Lite ARM64 Trixie (2026-10-06), pinned by official URL and SHA-256 in `manifests/base.json`. The builder accepts regular files only and contains no flashing or block-device commands. Existing Pi installations are untouched.

On a native ARM64 Linux build host/container, install the native build prerequisites in [native adapter setup](../docs/native-tone3000.md), plus `libguestfs-tools`, QEMU, `xz-utils`, `openssl`, `liblilv-dev`, `lv2-dev`, `libasound2-dev` and `pkg-config`. Run normal checks before building:

```sh
pnpm check
pnpm native:check
pnpm lv2:check
node scripts/artifacts.mjs --appliance
python3 os/scripts/provision.py --create-access .local/device-access
# Download the exact URL in os/manifests/base.json to .local/images/base.img.xz.
python3 os/scripts/provision.py --verify-image .local/images/base.img.xz
python3 os/scripts/image.py \
  --base .local/images/base.img.xz \
  --bundle .local/artifacts/oxidal-linux-arm64-appliance \
  --access .local/device-access \
  --output .local/images/oxidal-prototype.img
```

The default `--profile appliance` masks automatic apt refresh/upgrade and other measured background maintenance, while keeping apt available for explicit Unlocked maintenance. `--profile development` keeps the broader service/timer environment and adds ALSA, LV2, process and syscall diagnostics; it still masks automatic apt work. Both profiles retain the recovery terminals and installed qualification.

### Effect installation and helper hardening

Settings → Effects installs or removes only the fixed Debian package allowlist compiled into the root device helper. The helper unit intentionally does not set `NoNewPrivileges`: apt starts its transport as root and then changes to the Debian `_apt` account, and the inherited kernel restriction otherwise makes that required `setresuid` fail. Oxidal does not work around this by making apt download as root. The exception is limited to this typed helper; the browser and unprivileged daemon cannot supply a command, package name, path or option, while socket peer checks, home protection, private temporary storage and restricted address families remain active. Package-manager errors are recorded in the helper journal. See [device service and effect packs](../docs/device-service.md#effect-packs) for the complete boundary.

The native artifact build uses pinned source/patch hashes. The image build records installed Debian package versions; package repositories are not snapshot-pinned, so image rebuilds are auditable rather than bit-for-bit reproducible. The output includes the image, SHA-256, manifest and installed test/package evidence. No successful readiness report is produced when installation or validation fails. A failed output is a diagnostic artifact, not a candidate to flash; use a new output filename after correcting the failure.

The image is 8 GiB and expects a fresh card of at least 16 GB. It retains the vendor boot partition/kernel, gives the system root 5 GiB and places writable state on a separate ext4 data partition which grows to fill the card at first boot. It uses a headless multi-user boot. The service selects the performance CPU governor and permits bounded real-time scheduling; automatic apt timers and competing network services are disabled. These baseline settings do not by themselves qualify complex audio deadlines. It installs ALSA/Lilv/native dependencies and SWH, Guitarix, Invada and MDA LV2 plugins plus bundled Oxidal Hold and Pitch for the 32 factory recipes, enables the unprivileged daemon with audio-group access, and keeps persistent user and package state under the data-backed `/var/lib`. The system journal and the bounded `/tmp` and `/var/tmp` mounts are volatile. It also configures authenticated HTTPS, mDNS, SSH recovery and a WPA-protected 2.4 GHz NetworkManager hotspot on `wlan0` (New Zealand regulatory profile). Ethernet remains available. The appliance disables cloud-init and masks systemd-networkd so it cannot compete with NetworkManager or hold network-online waiting for an unmanaged link. Use the generated credentials; do not add Raspberry Pi Imager OS customizations to this already configured image. Wi-Fi radio behavior, Pi boot and actual sound still require physical verification.

### Phone access and first sound

- Keep `.local/device-access/` private. `access.txt` contains independently generated web, Wi-Fi and recovery credentials. Credentials are not printed into build logs or web assets. Do not reuse one image/credential set across multiple devices.
- Copy `ca.crt` to your own phone/tablet and install/trust that personal CA. The CA private key stays outside the image. The device certificate covers `oxidal.local` and `10.42.0.1`; do not bypass certificate validation.
- Join the generated hotspot. Where the phone supports discovery, the Oxidal welcome page offers **Open Oxidal** and the friendly address. Otherwise open `https://oxidal.local` or `https://10.42.0.1` directly. Sign in as `oxidal` with the generated web password. All UI, API and event-stream requests require authentication.
- The API itself stays on `127.0.0.1:3210`. Nginx checks external Host and Origin before forwarding requests. HTTP is not an alternative authenticated control endpoint. Provider accounts and internet access are not required for local playback.
- Initially audio is stopped. Import a preset in Library, select/probe the interface in Settings, then start the saved session. Both directions initially require the same hardware clock/endpoint. Keep output levels low for the first physical test.
- After verifying a session, select **Use this session on boot** for headless restoration. Stop audio leaves the UI and silent native editor running. A failed boot audio attempt reports its error without switching interfaces or retrying unexpectedly.
- Current source bundles include native, LV2 and mixed-rig workers, with shared device exclusion. The browser authors whole-native/LV2 rigs and guarded 48 kHz amp/cab pairs, including immediate controls/EQ and verified NAM/IR audition before Save. Named Save embeds models for offline recall and retains source provenance. Confirmed edits survive supported Audio Apply, recovery and explicit boot capture. Preloaded scenes and independent parallel NAM branches use sample-smoothed selection with shared downstream effect histories. The web panel configures hardware MIDI input and PC/CC scene or CC branch mappings. Missing MIDI hardware reports separately while PCM continues. Preselected whole mixed rigs also share one continuous PCM owner; whole-preset dynamic gapless/trails, full authoring/settings parity and physical audio/MIDI qualification remain open. The simulator requires explicit development access.
- These are source capabilities, not evidence that an older card contains them. Image manifests record the exact packaged revision. Raspberry Pi 5 is the deployment target; actual NAM loading time, model capacity, thermals, xruns and transitions must be measured on that device.

### Testing and recovery

`sh os/scripts/check.sh` runs the OS suite; Linux with nginx/openssl additionally runs actual TLS, authentication and origin tests. Image building runs `os/tests/test_installed.py` against the final filesystem: relocated dynamic dependencies, daemon startup, native editor, graph/audio availability, UI, ALSA discovery and orderly shutdown. Audio boot preference/restart/failure recovery is covered by the existing native integration/browser suites using ALSA null. An additional real systemd boot test uses a disposable QEMU overlay, a generic ARM64 kernel/initrd and its matching module directory; it checks the unprivileged daemon, native editor, HTTPS authentication boundary, network services, recovery login timeout, unchanged optional development originals, honest stopped-meter state and service restart. It also runs a real unprivileged debug command and verifies systemd removes a cancelled descendant which escaped the shell process group. The candidate image stays unchanged:

```sh
OXIDAL_TEST_BOOT_IMAGE=/absolute/path/to/oxidal-prototype.img \
OXIDAL_TEST_BOOT_KERNEL=/boot/vmlinuz-MATCHING-ARM64-VERSION \
OXIDAL_TEST_BOOT_INITRD=/boot/initrd.img-MATCHING-ARM64-VERSION \
OXIDAL_TEST_BOOT_CA=/absolute/path/to/device-access/ca.crt \
python3 -m unittest discover -s os/tests -p test_boot.py -v
```

The host must provide `/lib/modules/MATCHING-ARM64-VERSION`. The generic kernel/modules exist only in the test overlay; the candidate retains its Raspberry Pi kernel. These are software checks, not hardware measurements.

SSH recovery uses `oxidal-admin` and its separate generated password. Console login allows 180 seconds. Reusing an existing private access directory preserves that device’s credentials; a new directory creates new credentials. Useful target commands:

```sh
systemctl status oxidald nginx NetworkManager
journalctl -u oxidald -b
sudo systemctl restart oxidald
# Stop the whole service only for maintenance (this disconnects the UI).
sudo systemctl stop oxidald
# Disable an unwanted/corrupt boot-audio preference while stopped.
sudo rm -f /var/lib/oxidal/presets/boot-audio.json
sudo systemctl start oxidald
```

Back up `/var/lib/oxidal` before replacing an image. The data partition also carries package and network state; it is not a substitute for an image-compatible restore procedure. Full-service stop is distinct from the UI’s audio-only stop. No A/B updates, power-loss guarantees or automatic rollback are claimed. Recovery from an unbootable prototype is to power down and use the untouched original card, or rebuild and rewrite only the separate prototype card after identifying it explicitly.

### Fixture staging and regular Linux boundary

`provision.py --target-root PATH` still supports read-only planning and `--apply` to an explicitly marked disposable Trixie root. Add `--bundle PATH` for verified application files, and optionally `--access PATH` for HTTPS configuration. `--hotspot` is Pi-only and opt-in. It validates all managed paths and hashes before writes, rejects symlinks/host roots and leaves service activation to the image builder. Without a bundle it only stages the unit and base manifest; that is not a runnable installation.

Regular laptop installation must preserve its network, desktop and boot settings. The bundle format supports Linux x64, but the exact x64 distribution/CPU baseline and install/upgrade/remove lifecycle still require qualification. Do not apply the Pi image or hotspot setup to a laptop.

## Device branding

Appliance provisioning includes a plain ASCII block-letter Oxidal login and post-login banner, with no terminal control sequences or backslashes for the login program to interpret. Browser branding, SVG masters and derived PNGs travel with the web bundle. To show the supplied artwork during Linux startup, pass `--boot-splash` to `image.py`; this installs Plymouth, selects the Oxidal theme and rebuilds the initramfs. The option requires the branded bundle. It does not replace the Pi EEPROM/firmware display or change its bootloader. The normal console remains available (Escape switches a Plymouth splash to diagnostics); serial-console output remains usable. Graphical startup is not yet qualified on physical HDMI hardware. Ordinary Linux package installation does not change the host's theme or login banner.

## Private development presets

The normal bundle/image contains no factory-preset payloads. For an owner-only test image, pass `--development-presets /path/to/local/presets` to `image.py`. The bundled `oxidal-preset-seed` validates every native preset before importing unchanged originals into the initial library; the image stores a development-only manifest with names, SHA-256 and sizes. This opt-in does not establish redistribution rights for embedded models or other assets. Keep the resulting personalized test image private.

For local testing, run `cargo run -p oxidal-presets --bin oxidal-preset-seed -- --development-only SOURCE NEW_OUTPUT`, then start the daemon with `OXIDAL_PRESET_DIR=NEW_OUTPUT/presets`. Existing output is never overwritten. The normal parser/store admission limits apply, and invalid source files prevent initial output creation. The source directory is explicit; builds never assume a private reference checkout or download an account's presets.

The appliance also packages the [device service](../docs/device-service.md) for browser network setup and system power controls. Hotspot country/channel changes use the radio’s current regulatory capabilities and the same confirmed rollback as credentials. Five automatic policies preserve a recovery AP when managed client activation fails; physical RF transitions require testing. Keep its OS group, socket permissions and unprivileged daemon boundary intact.

The separate [debug executor](../docs/debug-console.md) runs as locked, non-login `oxidal-debug`, with no capabilities or privilege escalation. Systemd limits its resources and removes its complete control group after each job. The web daemon remains unprivileged; enabling debug is temporary and never grants package-install or network-administration privileges. [Monitoring](../docs/monitoring.md) displays real worker/host counters; unavailable readings remain unavailable.
