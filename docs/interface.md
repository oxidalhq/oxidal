# Interface theme and navigation

Oxidal uses a shared shadcn-style Button primitive, Radix composition and Tailwind v4 semantic tokens. The custom Orchid theme is defined in `apps/web/src/theme.css`; it is not an imported Mira preset. Colours, surface pairs, radius, spacing, type scale and touch-target size can be changed there without editing component markup. Tailwind classes are sorted by the pinned Prettier plugin.

- Rig is the playing/control surface. Actual native playback shows confirmed sounding blocks and only controls reported by that session. Stopping audio shows playback status and library/audio actions, never example effects. The isolated control simulator requires both `?development=simulator` and a server advertising the simulator capability; its mapping/validation tools are not the physical MIDI feature.
- Library separates Browse (import, originals and artwork) from Author (offline native editing and saved copies).
- Monitor owns detailed signal/system graphs; the compact resource strip stays visible everywhere.
- Settings separates Audio, Connections, MIDI, Display and Maintenance. Only the selected section is mounted. Maintenance holds interactive terminals and the restricted diagnostic runner; it does not crowd performance controls.
- Display mode lives in Settings → Display, never in the playing header. Form inputs remain at least 16 px to avoid Safari input zoom. Short landscape keeps telemetry on one row; safe-area insets protect controls from the notch. The floating editor follows visual viewport changes and does not automatically open the keyboard.
- Main navigation remains stable on every page. Selected destinations have a persistent underline and `aria-current`; selection does not rely on colour alone.
- Parameter readouts are the adjustment triggers; there is no repeated Edit action. A compact floating panel keeps the chain visible and provides relative drag, fine mode, increment/decrement, reset and optional numeric entry. Tapping the track alone does not change the value. Done keeps the adjustment; Cancel/Escape restores owned preview state. Sounding scalar controls audition while the adjustment is open; Done retains the confirmed value and Save copy persists it separately. This follows the existing PiPedal touch interaction while keeping Oxidal transport ownership and stale-session guards.
- Connection and audio state have a dedicated telemetry rail. Effect power remains on its effect; unsaved/saved state remains with the sound being authored.
- Buttons share primary, secondary, outline and ghost states. Primary colour identifies the main action; navigation and secondary actions use quieter surfaces. Button feedback is immediate, without colour transitions that obscure contrast during stage use.
- Touch targets remain at least 44 px, or 48 px in sunlight, dark-stage and e-paper modes. Dense layout does not shrink the touch area. E-paper disables animation and uses monochrome distinctions.

The existing Playwright device suite checks both orientations, each Settings section, keyboard/accessibility rules, no horizontal clipping, aligned navigation, repeated portrait/landscape and keyboard-sized resizing during an edit, and edit retention across Fold 4 transitions. It covers representative iPhone XR WebKit, Fold 4 cover/open and BOOX Air3 C browser viewports. Screenshots and browser checks do not replace physical sunlight, e-paper refresh/ghosting or on-stage acceptance.

## Fullscreen and screen timeout

Settings → Display provides separate **Enter fullscreen** and **Keep screen awake** controls. Fullscreen uses the browser's page Fullscreen API when available and follows native exit events. Unsupported browsers show that limitation; no video workaround or orientation lock is used.

Keep-awake is a browser-local preference, off by default. It survives view changes and reloads, requests a screen wake lock while the page is visible, releases on disable/unmount, and reacquires on return. Active, requesting, paused, denied and unsupported states are explicit, with a retry after browser/system release or refusal. A late pending request is released if the preference has since been disabled. It does not affect the Linux audio daemon, screen brightness or BOOX refresh settings.

[Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) requires a supported browser and a secure context; use the device's trusted HTTPS address. Browser/power policies can revoke it, and leaving or locking the phone releases it. Fullscreen alone does not prevent timeout. There is no claim of background browser operation or an override of OS power settings.

The maintained unit suite covers visibility return, release/denial, explicit retry, late acquisition and fullscreen events. Device-layout tests cover control placement, navigation/reload, rotation and browser fullscreen availability on XR/Fold/BOOX; wake-lock behavior uses a browser API fixture. Actual idle-timeout prevention and power-saving behavior require physical-device acceptance.

## Spacing and visual review

Independent button actions use `.action-row`: wrapping, aligned controls and the theme's `--action-gap` (8px by default). Joined navigation and compact adjustment controls have their own patterns. Settings and offline-authoring forms use `.control-stack` with `--control-gap` (12px); mobile `.form-grid` retains that separation when it becomes one column. Do not add unstyled toolbar classes or remove gaps just to fit a phone.

The maintained device suite checks visible gaps as well as target size, overflow and alignment, and captures every Settings section in both orientations. Review the screenshots: a passing geometry check is not a UX sign-off or proof of physical stage usability.

Secondary setup explanations are collapsed under labelled help disclosures. Native draft tone controls are directly tappable; the full block/device control selector remains available under All controls. Artwork without an image is compact metadata behind a count, while cached images stay visible and served locally. A silent draft is labelled explicitly; these presentation changes do not imply shared structural authoring with the playing worker.
