# Device service and network setup

`oxidald` stays unprivileged and serves `GET/POST /api/v1/device/network`. When `OXIDAL_DEVICE_SOCKET` is absent, it reports network administration unavailable without changing the host. The appliance enables a separate root `oxidal-device-service` over `/run/oxidal-device/control.sock`. Existing Linux installs are not automatically given an access point, group, helper or altered network settings.

The helper uses a root-owned runtime directory and group-restricted socket, checks the connecting UID against the current `oxidald` DynamicUser via systemd NSS (or root), and admits only typed status, scan, join, hotspot, confirm, cancel and forget commands. The HTTP bridge also verifies the server peer is root. JSON frames are limited to 64 KiB, reads/writes/commands have deadlines, external commands use fixed absolute binaries and argument arrays, and stderr is discarded. There is no shell, caller-supplied executable, filesystem path or arbitrary `nmcli` option. Network passwords are redacted from Debug, omitted from readback and never put on process command lines. Keyfiles and the temporary rollback journal are root-only. The existing authenticated HTTPS/origin boundary remains required; this endpoint does not make the loopback API a public service.

## Current workflow

- Settings shows network interfaces, Wi-Fi radio state and nearby SSIDs; Scan refreshes NetworkManager's cache. The form accepts an SSID manually, including hidden networks. This first slice supports WPA2 Personal with 8–63 printable ASCII password characters, not open, enterprise or WPA3-only networks.
- Join Wi-Fi saves an Oxidal-owned client profile. Edit hotspot changes the appliance recovery AP name/password while retaining its existing UUID, 2.4 GHz band and shared IPv4 address. Regulatory region remains the provisioned value; country/channel editing and all five PiPedal-inspired automatic policies are still pending.
- Review explains the expected phone disconnection. Apply first creates a NetworkManager checkpoint and a durable backup of the affected profile, with trial autoconnect disabled. The helper returns a transaction token before activating the new connection.
- Reconnect the phone and browse to `https://oxidal.local` (or `https://10.42.0.1` on the hotspot), then Keep this connection within 90 seconds. Confirmation requires active connection readback and only then enables persistence/autoconnect. A single radio normally cannot keep the old hotspot while joining the router.
- No confirmation, a failed activation, explicit Cancel or helper restart restores the previous profile. NetworkManager's checkpoint timeout is independent of the browser/helper; the helper also restores persistent keyfiles and attempts the recovery hotspot if no Wi-Fi link returns. A durable journal blocks overlapping changes and permits retry after a failed recovery. Do not interpret this as physical-radio qualification.
- Forget applies only to inactive, Oxidal-managed client profiles; it cannot delete the recovery hotspot or another application's connections. Switching to a previously saved SSID currently uses the join form again. Web credentials remain separate from Wi-Fi credentials.

## Verification and remaining work

`cargo test -p oxidal-device` exercises frame bounds, credential redaction, escaped SSIDs/keyfile values, confirmation/readback, failed passwords, expiry without a browser and helper restart with recovery credentials preserved. Transaction tests use temporary real files and a scoped fake command transport; they do not claim real RF coverage. `cargo test -p oxidal-api` covers unsupported hosts, strict commands and non-echoed passwords. The existing Playwright suite covers the review/apply/reconnect/confirm browser flow and clearing passwords, with a controlled network transport. The device layout suite covers target screen sizes.

Disposable ARM64 Linux qualification also exercises the real NetworkManager keyfile parser (including escaped passwords/SSIDs), the checkpoint D-Bus wire format, helper socket permissions and rejection of unauthorized peer UIDs. Run with a system bus and NetworkManager already running, as root **only in a disposable container/image**:

```sh
cargo build --locked -p oxidal-device --bin oxidal-device-service
OXIDAL_TEST_DEVICE=1 OXIDAL_DEVICE_BINARY="$CARGO_TARGET_DIR/debug/oxidal-device-service" python3 -m unittest discover -s os/tests -p test_device.py -v
OXIDAL_TEST_DEVICE=1 cargo test --locked -p oxidal-device real_networkmanager_keyfile_roundtrip -- --ignored
```

If `CARGO_TARGET_DIR` is unset, use the repository's `target/debug/oxidal-device-service`. The keyfile test creates/deletes a uniquely identified inactive profile and creates/destroys a checkpoint without activating connections. Qualification passed on NetworkManager 1.42.4; this does not replace testing the Pi image's installed version and radio.

Physical single-radio AP/client transitions, hidden networks, saved-client boot recovery, NetworkManager restart during a change, radio disappearance and radio-specific scan restrictions need hardware acceptance before a v1 release. System reboot/shutdown, automatic hotspot policies and a separate authenticated debug console are later service slices; they are not exposed by this helper. The runtime currently keeps the first prototype's static AP fallback configuration.

References: NetworkManager's [checkpoint API](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.html), [checkpoint flags](https://www.networkmanager.dev/docs/api/latest/nm-dbus-types.html) and [nmcli command interface](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html).

## Automatic hotspot and power

The web settings support Always, Never, No Ethernet, Not at home and No remembered Wi-Fi in range. Home and remembered policies use visibility, not Internet reachability. Settings are persisted privately; a change has the same 90-second confirmation journal as a Wi-Fi join. Timeout or helper restart restores both policy and keyfile. Normal automatic decisions require two observations 30 seconds apart and pause during a pending transaction. Failed remembered-network authentication keeps the recovery AP available. Never can require Ethernet access. The helper manages only an appliance with its recovery AP installed; existing Linux hosts remain untouched. Country/channel configuration and physical radio transitions still require qualification.

System Reboot and Shut down use an explicit confirmation in Settings and only two fixed systemctl verbs in the root helper. They invoke normal systemd shutdown, which sends SIGTERM to the daemon, awaits audio-worker cleanup and stops the service control group. They do not force power removal. Pending network changes block power requests. Audio Stop remains a separate operation that keeps the editor available. Unsaved editor changes must be saved first. Physical shutdown completion is not proven by the UI acknowledgement.
