# Device service and network setup

`oxidald` stays unprivileged and serves `GET/POST /api/v1/device/network`. When `OXIDAL_DEVICE_SOCKET` is absent, it reports network administration unavailable without changing the host. The appliance enables a separate root `oxidal-device-service` over `/run/oxidal-device/control.sock`. Existing Linux installs are not automatically given an access point, group, helper or altered network settings.

The helper uses a root-owned runtime directory and group-restricted socket, checks the connecting UID against the current `oxidald` DynamicUser via systemd NSS (or root), and admits only typed network, power and effect-pack commands. The HTTP bridge also verifies the server peer is root. JSON frames are limited to 64 KiB, reads/writes/commands have deadlines, and external commands use fixed absolute binaries and argument arrays. Package-manager stderr is retained in the service journal for diagnosis. There is no shell, caller-supplied executable, filesystem path, Debian package name or arbitrary command option. Network passwords are redacted from Debug, omitted from readback and never put on process command lines. Keyfiles and the temporary rollback journal are root-only. The existing authenticated HTTPS/origin boundary remains required; this endpoint does not make the loopback API a public service.

## Effect packs

Settings → Effects uses `GET /api/v1/packs` and the fixed `POST /api/v1/packs/{id}/install|remove` actions. The helper maps eight stable IDs to exact Debian packages: Guitarix, Dragonfly Reverb, Calf, Invada, x42, MDA, SWH and FOMP. LSP and any collection with no harness-usable plugins are absent. Browser input cannot select another package. The list reports measured usable counts from the ARM64 pack harness, approximate installed size, installed version and the relevant qualification note.

One helper-owned job may run at a time. It executes apt through fixed `nice -n 19` and idle-I/O `ionice -c 3` arguments, uses apt/dpkg locking, has a 30-minute deadline and survives the initiating HTTP request. The browser polls job state and may leave the screen. The daemon refuses Install or Remove while any native, graph or mixed engine owns the audio device. Package failure—including offline repositories—is reported rather than presented as an empty or successful collection. Removal names only the selected top-level package; apt does not autoremove dependencies. Reinstall remains available.

Package installation necessarily gives this narrowly allowlisted root service system and Internet write access that network-only operation did not need. The unit deliberately omits systemd's `NoNewPrivileges`: that setting is inherited by children and prevents apt's HTTP worker from dropping from root to the Debian `_apt` account, causing `setresuid` failures before a package can be downloaded. Configuring apt to download as root would remove apt's own privilege boundary and is not used.

This is a scoped defence-in-depth exception, not a general command facility. Home protection, private temporary storage, peer-UID checks, the typed protocol and the fixed package allowlist remain; the unit admits only Unix/netlink/IPv4/IPv6 address families. The unprivileged daemon cannot choose an executable, package name, path or option. Any broader package or command surface requires a new security review.

## Storage mode

Storage mode uses the same typed boundary but a separate fixed target. The browser sends only `locked` or `unlocked`; the helper validates and atomically replaces `/boot/firmware/cmdline.txt`. It never remounts the running root. The control is unavailable until the appliance writable-data layout marker exists, and effect-pack work independently refuses an actively read-only root. See [storage lock](storage-lock.md).

## Current workflow

- Settings → Connections shows network interfaces, Wi-Fi radio state and nearby SSIDs; Scan refreshes NetworkManager's cache. The form accepts an SSID manually, including hidden networks. This first slice supports WPA2 Personal with 8–63 printable ASCII password characters, not open, enterprise or WPA3-only networks.
- Join Wi-Fi saves an Oxidal-owned client profile. Edit hotspot changes the appliance recovery AP name/password while retaining its existing UUID, 2.4 GHz band and shared IPv4 address. Country/channel selection and five automatic hotspot policies use the same confirmation and recovery flow; see Automatic hotspot and power below.
- Review explains the expected phone disconnection. Apply first creates a NetworkManager checkpoint and a durable backup of the affected profile, with trial autoconnect disabled. The helper returns a transaction token before activating the new connection.
- Reconnect the phone and browse to `https://oxidal.local` (or `https://10.42.0.1` on the hotspot), then Keep this connection within 90 seconds. Confirmation requires active connection readback and only then enables persistence/autoconnect. A single radio normally cannot keep the old hotspot while joining the router.
- No confirmation, a failed activation, explicit Cancel or helper restart restores the previous profile. NetworkManager's checkpoint timeout is independent of the browser/helper; the helper also restores persistent keyfiles and attempts the recovery hotspot if no Wi-Fi link returns. A durable journal blocks overlapping changes and permits retry after a failed recovery. Do not interpret this as physical-radio qualification.
- Forget applies only to inactive, Oxidal-managed client profiles; it cannot delete the recovery hotspot or another application's connections. Switching to a previously saved SSID currently uses the join form again. Web credentials remain separate from Wi-Fi credentials.

## Verification and remaining work

`cargo test -p oxidal-device` exercises frame bounds, credential redaction, the fixed non-empty effect-pack allowlist, escaped SSIDs/keyfile values, confirmation/readback, failed passwords, expiry without a browser and helper restart with recovery credentials preserved. Transaction tests use temporary real files and a scoped fake command transport; they do not claim real RF coverage. `cargo test -p oxidal-api` covers unsupported hosts, the read-only curated pack catalog, strict commands and non-echoed passwords. Frontend tests cover audio refusal, asynchronous install state and inline removal confirmation. The existing Playwright suite covers the network review/apply/reconnect/confirm browser flow and clearing passwords, with a controlled transport. The device layout suite covers target screen sizes.

Disposable ARM64 Linux qualification also exercises the real NetworkManager keyfile parser (including escaped passwords/SSIDs), the checkpoint D-Bus wire format, helper socket permissions and rejection of unauthorized peer UIDs. Run with a system bus and NetworkManager already running, as root **only in a disposable container/image**:

```sh
cargo build --locked -p oxidal-device --bin oxidal-device-service
OXIDAL_TEST_DEVICE=1 OXIDAL_DEVICE_BINARY="$CARGO_TARGET_DIR/debug/oxidal-device-service" python3 -m unittest discover -s os/tests -p test_device.py -v
OXIDAL_TEST_DEVICE=1 cargo test --locked -p oxidal-device real_networkmanager_keyfile_roundtrip -- --ignored
```

If `CARGO_TARGET_DIR` is unset, use the repository's `target/debug/oxidal-device-service`. The keyfile test creates/deletes a uniquely identified inactive profile and creates/destroys a checkpoint without activating connections. Qualification passed on NetworkManager 1.42.4; this does not replace testing the Pi image's installed version and radio.

Physical single-radio AP/client transitions, hidden networks, saved-client boot recovery, NetworkManager restart during a change, radio disappearance and radio-specific scan restrictions need hardware acceptance before a v1 release. Automatic hotspot decisions and confirmed reboot/shutdown are implemented below. Interactive terminals and the restricted debug runner use separate services, described in [debug-console.md](debug-console.md); arbitrary command execution is never part of this root network helper.

References: NetworkManager's [checkpoint API](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/gdbus-org.freedesktop.NetworkManager.html), [checkpoint flags](https://www.networkmanager.dev/docs/api/latest/nm-dbus-types.html) and [nmcli command interface](https://networkmanager.pages.freedesktop.org/NetworkManager/NetworkManager/nmcli.html).

## Automatic hotspot and power

The web settings support Always, Never, No Ethernet, Not at home and No remembered Wi-Fi in range. Home and remembered policies use visibility, not Internet reachability. Settings are persisted privately; a change has the same 90-second confirmation journal as a Wi-Fi join. Timeout or helper restart restores both policy and keyfile. Normal automatic decisions require two observations 30 seconds apart and pause during a pending transaction. Failed remembered-network authentication keeps the recovery AP available. Never can require Ethernet access. The helper manages only an appliance with its recovery AP installed; existing Linux hosts remain untouched. The hotspot form also supports persisted country and automatic/fixed 2.4 GHz channel selection. Country codes must exist in the system country database; the kernel must accept the country, and fixed channels must be permitted by the selected radio (disabled, no-IR and radar channels are excluded). Country/keyfile changes share the recovery journal. Physical radio transitions still require qualification.

System Reboot and Shut down use an explicit confirmation in Settings and only two fixed systemctl verbs in the root helper. They invoke normal systemd shutdown, which sends SIGTERM to the daemon, awaits audio-worker cleanup and stops the service control group. They do not force power removal. Pending network changes block power requests. Audio Stop remains a separate operation that keeps the editor available. Unsaved editor changes must be saved first. Physical shutdown completion is not proven by the UI acknowledgement.

## Hotspot welcome and discovery

Pi hotspot provisioning includes an offline Oxidal welcome page with the shipped
wordmark, large Open Oxidal link, friendly hostname and short browser help.
NetworkManager's shared-mode dnsmasq answers selected Apple/Android HTTP-probe
names and `oxidal.local` locally; explicit local zones also prevent AAAA probes
from leaking upstream. Other domains, including the provider/account services,
keep normal upstream DNS forwarding. No wildcard public-domain interception or
new privileged service is introduced. Ordinary Linux bundle installs do not
receive these hotspot files.

The HTTP welcome is available only to the hotspot IPv4 subnet on its gateway
address. Probe paths redirect to a fixed `http://10.42.0.1/welcome`; no incoming
host/path/query controls the destination. The page serves only welcome content
and the fixed logo, and links to the existing authenticated HTTPS app. HTTP does
not proxy APIs, collect credentials or run commands. The current self-signed
certificate setup is retained. A new browser context is requested for the app;
phone captive assistants may require the user to open Safari/Chrome manually.

This uses legacy HTTP-probe discovery rather than advertising a CAPPORT API URL
whose TLS certificate a first-time phone would not yet trust. Popups depend on
client OS detection, VPN/private-DNS policy and remembered network preferences.
Friendly `https://oxidal.local` and the gateway link remain available if detection
is suppressed. iPhone users may need Without Internet to remain associated with
this offline device network. Physical XR/Fold/BOOX join/popup behavior remains an
acceptance test, independently of DNS/HTTP software qualification.

The existing OS access/provision suites exercise real nginx and dnsmasq, fixed
redirects, AP address/client isolation, forbidden HTTP writes, offline A/AAAA
resolution and unchanged provider DNS forwarding. The maintained device-layout
browser flow renders the exact shipped HTML/logo in portrait and landscape and
checks touch size, overflow and accessibility.
