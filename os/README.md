# Oxidal OS recipe foundation

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
