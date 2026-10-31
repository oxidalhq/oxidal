# Storage lock

Oxidal separates the player's writable data from system files before Locked mode is enabled. The lock control is therefore unavailable on ordinary Linux installs and on appliance images that do not carry `/usr/share/oxidal/storage-layout-v1`. Appliance images place persistent state on the labelled third partition: it mounts at `/var/lib`, while its `oxidal-system-connections` directory bind-mounts over `/etc/NetworkManager/system-connections`. This keeps presets, mappings, audit history, package state, NetworkManager state and hotspot profiles writable while the system root is read-only. The system journal is volatile and bounded; `/tmp` and `/var/tmp` are bounded tmpfs mounts in both modes.

## Modes

- **Unlocked** is the default. The boot command line contains `rw oxidal.storage=unlocked`; package updates and qualified effect-pack changes are allowed.
- **Locked** is next-boot only. The helper writes `ro systemd.volatile=state oxidal.storage=locked`. The kernel mounts the system root read-only and systemd supplies volatile state for ordinary `/var` writes. The separate appliance data layout mounts persistent presets, settings, mappings and NetworkManager state back into their fixed locations.
- The interface never remounts a running root. Selecting a mode atomically updates only `/boot/firmware/cmdline.txt`, reports the current and next-boot modes separately and offers an explicitly confirmed restart.
- On first boot from a larger card, `oxidal-grow-data.service` verifies the `OXIDAL_DATA` label and partition number before growing only that final partition and its ext4 filesystem. A normal install never carries this service or marker.

The current mode comes from `/proc/self/mountinfo`, not from the requested boot flag. A missing layout marker, missing root device, duplicate `ro`/`rw`, an inconsistent `systemd.volatile` flag, multiple Oxidal declarations, an unknown declaration or an unreadable mount table fails closed. The original command line is retained on every validation or staging failure.

## Privilege boundary

The browser and daemon cannot choose paths or boot arguments. They send only `locked` or `unlocked` through the typed Unix device protocol. The root helper edits the fixed firmware command line through a same-directory create-new file, file sync, atomic rename and directory sync. A stale staging file blocks another write instead of being followed or overwritten.

Effect-pack changes independently read the active root mount and refuse package work unless it is currently writable. A scheduled Unlocked mode does not permit apt before the restart; a scheduled Locked mode does not stop apt while the current system remains Unlocked.

Settings → Device shows the active and next-boot modes, why a pre-layout installation is unavailable and the restart confirmation. Storage maintenance state does not compete with DSP and playback telemetry in the persistent resource strip. Device power remains a separate typed command and still refuses while network recovery is pending.

## Qualification boundary

Unit tests use disposable command-line, mount-table and layout-marker fixtures to verify both transitions, no live remount and fail-closed parsing. API and browser tests cover an unavailable ordinary host, scheduling and confirmation. Provisioning tests verify the fixed fstab entries, layout marker, grow-service boundary and installed-image mount identities. A real read-only boot, writable data survival, switching back, failed-boot recovery and re-lock after package installation still require disposable image/QEMU or fresh-card qualification.
