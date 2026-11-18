# Connect a TONE3000 account

You can use local presets, NAM captures and IRs offline. Connect an account
when you want to browse and download models from TONE3000.

1. Open **Settings → Accounts → TONE3000**.
2. Enter your application's publishable client ID and choose **Sign in to TONE3000**.
   Keep the secret key private.
3. Open the displayed provider link and enter the code. The device needs internet
   access while it waits for authorization.
4. Return to Oxidal. The connection status updates when authorization completes.

The account card uses the same pattern as Storybook, with actual device state.
It shows the issued verification link, code and expiry, offers Cancel while waiting,
and keeps expired/error and reconnecting states visible. Reset connection clears
an unsuccessful session. The device API does not return a user name, so a completed
connection says signed in on this device. Account tokens never reach the browser.
If Library sent you here, its return action appears after sign-in.

## Catalog selection

- Use **Library** to download a model for later.
- Use **Change model** on a supported running block to audition a capture or IR.
- Save a copy after auditioning if you want to recall the new tone offline.

## Disconnect or move to another device

**Sign out** clears the saved account tokens on this device. Local files
remain available and playback continues. Tokens are stored on the device with
owner-only file permissions and are excluded from library backups.

## References

- [TONE3000 API documentation](https://www.tone3000.com/api)
- [TONE3000 API terms](https://www.tone3000.com/api/terms)
- [Account and provider implementation](../crates/oxidal-api/src/provider)
- [Local library](library.md)
