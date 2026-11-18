# Device service and network setup

| Task                                      | Where to go                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| Connect Oxidal to Wi-Fi                   | **Settings → Network**                                          |
| Connect a phone directly to the appliance | [Hotspot welcome and discovery](#hotspot-welcome-and-discovery) |
| Install effects                           | [Settings → Effects](#effect-packs)                             |
| Change storage mode                       | [Storage lock](storage-lock.md)                                 |
| Configure hotspot fallback or power off   | [Automatic hotspot and power](#automatic-hotspot-and-power)     |

For first boot and the generated credentials, follow the
[appliance setup guide](../os/README.md#phone-access-and-first-sound).

`oxidald` stays unprivileged and serves `GET/POST /api/v1/device/network`. When `OXIDAL_DEVICE_SOCKET` is absent, it reports network administration unavailable without changing the host. The appliance enables a separate root `oxidal-device-service` over `/run/oxidal-device/control.sock`. Existing Linux installs are not automatically given an access point, group, helper or altered network settings.

The helper uses a root-owned runtime directory and group-restricted socket, checks the connecting UID against the current `oxidald` DynamicUser via systemd NSS (or root), and admits only typed network, power and effect-pack commands. The HTTP bridge also verifies the server peer is root. JSON frames are limited to 64 KiB, reads/writes/commands have deadlines, and external commands use fixed absolute binaries and argument arrays. Package-manager stderr is retained in the service journal for diagnosis. There is no shell, caller-supplied executable, filesystem path, Debian package name or arbitrary command option. Network passwords are redacted from Debug, omitted from readback and never put on process command lines. Keyfiles and the temporary rollback journal are root-only. The existing authenticated HTTPS/origin boundary remains required; this endpoint does not make the loopback API a public service.

## Current interface addresses

Each `interfaces` record in the network response may include `addresses`, up to
eight canonical IPv4 addresses read for that exact interface. Empty values are
omitted; older helper replies remain compatible. The optional `address_message`
reports unavailable readback. An error clears address values rather than
presenting a previous address as current. The existing network transaction and
confirmation message remain authoritative.

The unprivileged API runs a fixed read-only NetworkManager query for device
names and IPv4 addresses. It accepts no caller-selected command or arguments,
limits output to 64 KiB, applies a two-second deadline, and shares a two-second
positive/negative cache between viewers. The cache admits one concurrent read.
Other hosts report unavailable without changing their network configuration.
This avoids adding netlink sockets to the daemon's address-family permissions.

The HTTPS proxy also accepts Host equal to its actual local socket address,
and Origin exactly `https://` plus that address. Named address rules and
authentication remain. Another private-looking IP or a forged forwarding header
does not satisfy these checks. The existing certificate still covers only its
listed names; reaching a current Wi-Fi IP does not resolve its TLS name mismatch.

## Effect packs

Settings → Effects uses `GET /api/v1/packs` and the fixed `POST /api/v1/packs/{id}/install|remove` actions. The helper maps ten stable IDs to exact Debian packages: Guitarix, Dragonfly Reverb, Calf, Invada, x42, MDA, SWH, FOMP, ZamAudio and DISTRHO Ports (the last two qualified in an ARM64 container so far). LSP and any collection with no harness-usable plugins are absent. Browser input cannot select another package. The list reports measured usable counts from the ARM64 pack harness, approximate installed size, installed version and the relevant qualification note.

One helper-owned job may run at a time. It executes apt through fixed `nice -n 19` and idle-I/O `ionice -c 3` arguments, uses apt/dpkg locking, has a 30-minute deadline and survives the initiating HTTP request. The browser polls job state and may leave the screen. The daemon refuses Install or Remove while any native, graph or mixed engine owns the audio device. Package failure—including offline repositories—is reported rather than presented as an empty or successful collection. Removal names only the selected top-level package; apt does not autoremove dependencies. Reinstall remains available.

Package installation necessarily gives this narrowly allowlisted root service system and Internet write access that network-only operation did not need. The unit deliberately omits systemd's `NoNewPrivileges`: that setting is inherited by children and prevents apt's HTTP worker from dropping from root to the Debian `_apt` account, causing `setresuid` failures before a package can be downloaded. Configuring apt to download as root would remove apt's own privilege boundary and is not used.

This is a scoped defence-in-depth exception, not a general command facility. Home protection, private temporary storage, peer-UID checks, the typed protocol and the fixed package allowlist remain; the unit admits only Unix/netlink/IPv4/IPv6 address families. The unprivileged daemon cannot choose an executable, package name, path or option. Any broader package or command surface requires a new security review.

## Public hotspot settings

The network response may include `hotspot` with the managed recovery profile's
public `ssid` and configured `channel` (zero means automatic). This is a saved
setting, not a measurement of the active RF channel. Wireless country still comes
from `radio`. When these values cannot be read, `hotspot_message` explains their
absence; no previous name/channel is retained as current data.

The unprivileged daemon queries only `802-11-wireless.ssid` and
`802-11-wireless.channel` on the fixed `oxidal-hotspot` profile. It never requests
secrets, changes a connection or invokes a shell. Output is limited to 4 KiB with
a two-second deadline; one query is shared across viewers through a two-second
success/failure cache. This read runs alongside address readback. Optional omitted
fields retain compatibility with older helper replies; no privileged helper
upgrade is needed for this readback.

## Saved Wi-Fi names

`SavedNetwork.name` is the NetworkManager connection label. Oxidal-managed
client profiles can share the label `oxidal-wifi`; it does not identify their
SSID. Optional `ssid` contains the public network name read for that record's
exact UUID. Existing actions continue to use UUIDs. `saved_message` reports
unavailable names without presenting cached old values as current.

The daemon reads at most 128 managed UUIDs in one fixed public-field `nmcli`
command, with a 64 KiB output bound and two-second deadline. A sorted exact UUID
set keys its shared two-second success/failure cache. Changed sets invalidate it;
an empty set starts no command. Invalid, missing, duplicate or unexpected records
fail closed. These reads run alongside current-address and hotspot reads, never
request secrets and do not parse root keyfiles or activate a connection. Older
helper replies remain compatible. More than 128 managed profiles leaves names
unavailable with a message; existing connection identities and removal remain.

## Reconnecting a saved profile

Updated device services accept the typed `connect` command with only an interface
and an inactive managed connection UUID. This backend path reuses stored
credentials rather than submitting a new password. It admits no unmanaged/active
profile, path or arbitrary command. The existing 90-second checkpoint and durable
recovery journal protect the old connection. Activation temporarily disables
autoconnect and binds the requested interface; confirmation checks both active
state and that interface before enabling persistence. Failure, cancellation,
timeout or restart restores the original profile bytes and recovery path.

The new read-only `network_capabilities` helper command reports schema version 1
and capability flags `saved_connect`, `open_join` and `hotspot_radio`. Missing
additional flags default false. Ordinary helper status replies omit this field so older strict
daemons can still read them. The HTTP bridge adds optional `capabilities` and
`capabilities_message` to network state after a read. Old, missing or future
helpers do not claim support. Probes have a one-second deadline, shared 30-second
success/two-second failure caches and no credentials. A write reads only an
immediately available cache entry; it starts no probe and waits for no in-flight
probe behind activation. Unsupported new network requests receive a clear
service-update error. This API support is separate from completion of the
Network screen and physical radio qualification.

## Open clients and hotspot radio changes

`join_open` accepts only an interface and SSID. It requires a freshly read advertised
open network and rejects a secured network with the same SSID, an absent network,
or an existing owned profile for that name. Use the saved profile or explicitly
forget it first. Its infrastructure profile has no Wi-Fi security setting; an empty
WPA2 password never selects this operation. Hotspots remain password-protected.
Enterprise, WPA3-only and hidden open networks are not qualified.

`hotspot_radio` accepts interface, country and channel. It reuses the managed AP's
UUID and preserves its SSID/password, changing only band/channel and trial
autoconnect through fixed NetworkManager arguments. Regulatory validation and
exact-interface confirmation apply. Failure, cancellation, expiry or restart
restores original profile bytes and country. Both actions require their advertised
capability and the explicit administrative device-service update below.

The shared 90-second clock starts before checkpoint creation and includes
preparation. Activation and confirmation each use the same remaining trial
budget for their entire sequence, including active readback, autoconnect and
checkpoint finalisation. A stalled confirmation rolls back instead of persisting
a late candidate. An already expired trial cannot issue activation commands. Readback reports time from that same clock; this software
limit does not establish physical radio or reconnection timing.

## Administrator service updates

The existing [local deployment workflow](../os/README.md#local-deployment)
provides an explicit `pnpm deploy:local device-service` update for development
images. Use `--build-only` to prepare and review the ARM64 archive first. This
part requires the administrator password and briefly interrupts audio; it is not
in the ordinary passwordless rule or default deployment set. Regular application
archives continue to reject root-service executables. Transfers use a private
SSH-user staging directory; the installer reads the service archive only from a
fixed root-only directory under `/run`.

The installer admits only one bounded ARM64 ELF at the fixed service path. It
refuses a pending network transaction, an active/unknown pack job, an unsafe target
or unreadable service state. It stops the daemon before its final guards, checks
pending recovery again after the fixed helper probe, then preserves the prior
service activity while replacing the executable. The bounded fixed-socket probes
verify a root peer and typed capability version. Failed installation, restart or
capability health restores the previous executable and activity; credentials,
network profiles, unit permissions and worker binaries are preserved. The prior
executable is retained in a root-only rollback directory. Inactive services remain
inactive. This does not qualify physical wireless transitions.

## Storage mode

Storage mode uses the same typed boundary but a separate fixed target. The browser sends only `locked` or `unlocked`; the helper validates and atomically replaces `/boot/firmware/cmdline.txt`. It never remounts the running root. The control is unavailable until the appliance writable-data layout marker exists, and effect-pack work independently refuses an actively read-only root. See [storage lock](storage-lock.md).

## Current workflow

- Settings → Network uses the shared Storybook list, review forms and confirmation dialog. Nearby networks come first; interface details, manual Wi-Fi entry and UUID-scoped saved profiles remain available. Scan refreshes NetworkManager's cache. Manual setup supports WPA2 Personal with 8–63 printable ASCII password characters. Updated helpers also support explicit advertised open-network join and saved-profile reconnection. Enterprise, WPA3-only and physical hidden-network behavior remain unqualified.
- Join Wi-Fi saves an Oxidal-owned client profile. Edit hotspot changes the appliance recovery AP name/password while retaining its existing UUID, 2.4 GHz band and shared IPv4 address. Country/channel selection and five automatic hotspot policies use the same confirmation and recovery flow; see Automatic hotspot and power below.
- Review explains the expected phone disconnection. Apply first creates a NetworkManager checkpoint and a durable backup of the affected profile, with trial autoconnect disabled. The helper returns a transaction token before activating the new connection.
- Reconnect the phone and browse to `https://oxidal.local` (or `https://10.42.0.1` on the hotspot), then Keep this connection within 90 seconds. Confirmation requires active connection readback and only then enables persistence/autoconnect. A single radio normally cannot keep the old hotspot while joining the router.
- No confirmation, a failed activation, explicit Cancel or helper restart restores the previous profile. NetworkManager's checkpoint timeout is independent of the browser/helper; the helper also restores persistent keyfiles and attempts the recovery hotspot if no Wi-Fi link returns. A durable journal blocks overlapping changes and permits retry after a failed recovery. Do not interpret this as physical-radio qualification.
- Forget applies only to inactive, Oxidal-managed client profiles; it cannot delete the recovery hotspot or another application's connections. Saved reconnection uses its UUID and stored credentials when the helper advertises support. Web credentials remain separate from Wi-Fi credentials.

The browser has one polling/command owner. Five-second reads do not overlap;
starting a command aborts and invalidates an older read. Every HTTP operation is
bounded to 25 seconds. An uncertain result triggers readback without replaying the
write; stale state disables mutations. Open form drafts survive background reads,
and passwords clear before Apply/Cancel and disappear on unmount. Confirm reads the
server's transaction phase/time; rollback remains available while activation is in
progress. Unreachable readback disables both mutations and provides a refresh action
inside the confirmation dialog. Two saved profiles with the same SSID retain
separate UUID-specific actions.

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

Settings → Device uses shared power rows and a mandatory review dialog. Opening
or cancelling the dialog sends no power command. Confirmation reads current
availability and pending network state again before requesting power. An accepted
request disables repeated actions; the dialog cannot be dismissed while sending.

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
host/path/query controls the destination. The page serves welcome content,
the fixed logo and the exact public certificate files below, and links to the
existing authenticated HTTPS app. HTTP does not proxy APIs, collect credentials
or run commands. The existing personal device CA and server certificate are
retained. A new browser context is requested for the app;
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

## Public certificate access

Provisioning with the original setup folder installs only its public `ca.crt`
under `/usr/share/oxidal/public/`, together with `certificate.json`. The CA must
be one PEM certificate of at most 16 KiB, have CA basic constraints, verify the
existing server chain and cover the expected `oxidal.local` and `10.42.0.1`
server names. The CA private key stays in the private setup folder. No new
credentials or certificates are generated by this operation.

| Route                                      | Boundary                                        | Response                                 |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------------------- |
| `GET/HEAD /api/v1/device/certificate`      | Existing authenticated HTTPS Host/Origin policy | Public PEM, `application/x-x509-ca-cert` |
| `GET/HEAD /api/v1/device/certificate.json` | Same HTTPS policy                               | Metadata JSON                            |
| `GET/HEAD /certificate.crt`                | Existing hotspot subnet and gateway HTTP guards | Same public PEM                          |
| `GET/HEAD /certificate.json`               | Same hotspot HTTP guards                        | Same metadata                            |

The JSON record contains `schema_version: 1`, `fingerprint_sha256` (uppercase
colon-separated SHA-256 of the DER certificate), `file_name: "oxidal-ca.crt"`,
`https_download: "/api/v1/device/certificate"`, `hotspot_download` (the exact
`"/certificate.crt"` path, or `null` without a hotspot), and the actual
`server_names` from the verified server certificate. These are static nginx
downloads, independent of the unprivileged daemon's API. Only these exact files
are aliased; writes are refused. HTTP retains its no-store/CSP headers and does
not expose any control API.

Before installing trust, compare the downloaded certificate's SHA-256 fingerprint
against the original setup certificate on a trusted device:

```sh
openssl x509 -in /path/to/original-device-access/ca.crt -noout -fingerprint -sha256
```

A fingerprint fetched through the same HTTP connection is a convenient display,
not independent proof of identity. Trusting the CA still does not make a
router-assigned address match the certificate's names. Use the covered hostname
or hotspot gateway. Physical trust installation remains platform-specific
acceptance. Existing development images use the standard
[deploy helper](../os/README.md#local-deployment),
which verifies the installed chain and rolls back a rejected nginx update.
