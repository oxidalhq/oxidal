# TONE3000 account

Settings → Connections → TONE3000 account supports the provider's device authorization flow. Enter your application's **publishable API key (`client_id`)**, choose Connect TONE3000, open the displayed provider link on a phone/computer, and enter the code. Oxidal checks authorization automatically; returning to the page is enough. A secret `t3k_cs_…` key is rejected. The device needs internet access for this flow; existing local presets remain independent of the account service.

The implementation follows [TONE3000's authentication and device authorization documentation](https://www.tone3000.com/api). The publishable key identifies the application; it is not the user's account authorization. Successful authorization supplies access and refresh tokens to the daemon. No borrowed reference application identity is bundled.

## Current boundary

This supplies account connection, cancellation, persistent sign-in, refresh and local disconnection. It does not yet provide an online tone browser, provider preset/model downloads, ownership/library synchronization, or remote authoring. Those must be integrated and qualified separately. Real account testing requires an application publishable key and user authorization. Local HTTP fixtures are protocol evidence, not proof of production account access.

Disconnect removes saved tokens from this device. It does not delete local presets, delete the provider account, or promise remote token revocation. Disconnect does not interrupt audio. Reset connection is available after a saved-account or authorization error; a storage failure is surfaced rather than falsely confirming removal.

## Runtime and storage

- `GET /api/v1/account/tone3000` returns public connection state, revision, publishable key and the temporary user-facing code. Device codes, access tokens and refresh tokens are never returned.
- `POST /api/v1/account/tone3000` accepts session/revision-checked `connect`, `cancel` or `disconnect`. The Rust contract generates browser types and validation. Lost replies should be resolved by refreshing state, not replaying a command with a stale revision.
- A separate owner performs fixed-origin HTTPS requests with redirects disabled, a 15-second request deadline and 32 KiB response limit. No browser-supplied URL or arbitrary network proxy is accepted. Polling honors the returned interval, adds five seconds for `slow_down`, expires temporary codes and retries transient refresh failures independently of audio.
- Cancellation drops the pending request before acknowledging disconnected state. Late network replies cannot complete a cancelled authorization. Backend work continues if the browser navigates away; opening Connections restores its current state.
- The daemon stores `accounts/tone3000-account.json` below `OXIDAL_PRESET_DIR`. Writes use a new owner-only temporary file (0600 on Unix), sync, atomic rename and directory sync. Invalid schema, oversized data, symlinks and unsafe file permissions are rejected on load. Incomplete temporary files are never restored.
- The account is revalidated through refresh after daemon restart. `invalid_grant` clears saved tokens; temporary network errors show reconnecting. Storage failure prevents a new connection from being reported as persisted and connected.
- Do not distribute this runtime account directory. Preset exports and the maintained development image seeder do not include it; the seeder only accepts regular `.t3kpreset` inputs. Image builds must not copy a live device's state directory as factory content.
- The service uses the existing loopback API and authenticated device proxy. Account tokens are unencrypted on local disk, protected by daemon ownership and file permissions; a device administrator can access them.

## Repeatable checks

`cargo test --locked -p oxidal-api` includes a local HTTP provider fixture for device authorization, persistence, refresh after restart, stale requests and cancellation during an outstanding HTTP request. It also covers polling/backoff/expiry, storage failure and private atomic records. The existing HTTP API suite verifies availability without audio and secret-key rejection without reflecting the key.

`pnpm test:e2e --grep 'TONE3000 account'` covers the real disconnected API and browser-side secret-key rejection, then uses an explicitly labelled UI contract fixture for code/link presentation, cancellation, automatic connected state, disconnection and portrait/landscape layouts. The latter does not contact TONE3000. XR uses WebKit; Fold cover/open and BOOX use the maintained touch/e-paper profiles. Physical browser/authorization acceptance remains required.
