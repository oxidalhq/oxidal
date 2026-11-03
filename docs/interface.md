# Interface theme and navigation

Oxidal uses a shared shadcn-style Button primitive, Radix composition and Tailwind v4 semantic tokens. The Oxidal identity (paper, ink and one oxide accent reserved for live or committed state; category colour only as block LEDs; one 4 px radius; no shadows or gradients) is defined in `apps/web/src/theme.css`; it is not an imported Mira preset. Display modes are Default, Night (stored as `stage`), Sunlight and E-paper; a stored `orchid` preference migrates to Default. Colours, surface pairs, radius, spacing, type scale and touch-target size can be changed there without editing component markup. Tailwind classes are sorted by the pinned Prettier plugin.

- Rig is the playing/control surface. Actual native playback shows confirmed sounding blocks and only controls reported by that session. Stopping audio shows playback status and library/audio actions, never example effects. The isolated control simulator requires both `?development=simulator` and a server advertising the simulator capability; its mapping/validation tools are not the physical MIDI feature.
- Library separates Browse (import, originals and artwork) from Author (offline native editing and saved copies).
- Monitor owns detailed signal/system graphs; the compact resource strip stays visible everywhere.
- Settings separates Audio, Network, Accounts, MIDI, Effects, Display, Device and Maintenance. Only the selected section is mounted. Maintenance holds interactive terminals and the restricted diagnostic runner; it does not crowd performance controls.
- Display mode lives in Settings → Display, never in the playing header. Form inputs remain at least 16 px to avoid Safari input zoom. Short landscape keeps telemetry on one row; safe-area insets protect controls from the notch. The floating editor follows visual viewport changes and does not automatically open the keyboard.
- Main navigation remains stable on every page. Selected destinations have a persistent underline and `aria-current`; selection does not rely on colour alone.
- Parameter readouts are the adjustment triggers; there is no repeated Edit action. A compact floating panel keeps the chain visible and provides relative drag, fine mode, increment/decrement, reset and optional numeric entry. Tapping the track alone does not change the value. Done keeps the adjustment; Cancel/Escape restores owned preview state. Sounding scalar controls audition while the adjustment is open; Done retains the confirmed value and Save copy persists it separately. This follows the existing PiPedal touch interaction while keeping Oxidal transport ownership and stale-session guards.
- Connection and audio state have a dedicated telemetry rail. Effect power remains on its effect; unsaved/saved state remains with the sound being authored.
- Buttons share primary, secondary, outline and ghost states. Primary colour identifies the main action; navigation and secondary actions use quieter surfaces. Button feedback is immediate, without colour transitions that obscure contrast during stage use.
- Touch targets remain at least 44 px, or 48 px in Sunlight, Night and E-paper modes. Dense layout does not shrink the touch area. E-paper disables animation and uses monochrome distinctions.

The existing Playwright device suite checks both orientations, each Settings section, keyboard/accessibility rules, no horizontal clipping, aligned navigation, repeated portrait/landscape and keyboard-sized resizing during an edit, and edit retention across Fold 4 transitions. It covers representative iPhone XR WebKit, Fold 4 cover/open and BOOX Air3 C browser viewports. Screenshots and browser checks do not replace physical sunlight, e-paper refresh/ghosting or on-stage acceptance.

## Fullscreen and screen timeout

Settings → Display provides separate **Enter fullscreen** and **Keep screen awake** controls. Fullscreen uses the browser's page Fullscreen API when available and follows native exit events. Unsupported browsers show that limitation; no video workaround or orientation lock is used.

Keep-awake is a browser-local preference, off by default. It survives view changes and reloads, requests a screen wake lock while the page is visible, releases on disable/unmount, and reacquires on return. Active, requesting, paused, denied and unsupported states are explicit, with a retry after browser/system release or refusal. A late pending request is released if the preference has since been disabled. It does not affect the Linux audio daemon, screen brightness or BOOX refresh settings.

[Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) requires a supported browser and a secure context; use the device's trusted HTTPS address. Browser/power policies can revoke it, and leaving or locking the phone releases it. Fullscreen alone does not prevent timeout. There is no claim of background browser operation or an override of OS power settings.

The maintained unit suite covers visibility return, release/denial, explicit retry, late acquisition and fullscreen events. Device-layout tests cover control placement, navigation/reload, rotation and browser fullscreen availability on XR/Fold/BOOX; wake-lock behavior uses a browser API fixture. Actual idle-timeout prevention and power-saving behavior require physical-device acceptance.

## Spacing and visual review

`components/ui` owns Button, Badge, Dialog, Slider, Tabs and ToggleGroup.
The latter interactive controls compose Radix primitives following the
[shadcn Dialog](https://ui.shadcn.com/docs/components/radix/dialog),
[Slider](https://ui.shadcn.com/docs/components/radix/slider) and
[Tabs](https://ui.shadcn.com/docs/components/radix/tabs) patterns, with Oxidal
semantic colours and 44 px touch targets. Library and Settings share Tabs;
view/mode choices use ToggleGroup rather than unrelated action buttons.
Dialog content is portalled, traps focus, restores it on close and retains
explicit cancellation. Use dialog-scoped selectors rather than assuming its
DOM remains inside the launching panel. Numeric relative-touch controls retain
their no-jump behavior; discrete engine settings present actual named choices.

Accounts is a top-level Settings section for provider authorization, initially
TONE3000. Network contains Wi-Fi and hotspot setup. Future provider integrations
belong under Accounts; no inactive provider placeholders are shown.

The global tuner starts on opening when a supported running native input exists.
It stops the detector it started and restores the opening monitoring state on
close, with session guards against controlling a replacement rig. Its round
strobe uses amber and green theme tokens; E-paper remains monochrome and
reduced-motion mode stops animation. The detector and ±2-cent indicator are
unchanged. This presentation does not provide a standalone input tuner.

Unconfigured MIDI performs no device I/O. A configured but absent controller is
shown as Disconnected, with saved assignments available through a disclosure.
Only an explicit Learn action listens for a new assignment. Reconnection is
bounded background work outside the render lock; idle-cost and physical MIDI
qualification remain separate from visual checks.

Independent button actions use `.action-row`: wrapping, aligned controls and the theme's `--action-gap` (8px by default). Joined navigation and compact adjustment controls have their own patterns. Settings and offline-authoring forms use `.control-stack` with `--control-gap` (12px); mobile `.form-grid` retains that separation when it becomes one column. Do not add unstyled toolbar classes or remove gaps just to fit a phone.

The maintained device suite checks visible gaps as well as target size, overflow and alignment, and captures every Settings section in both orientations. Review the screenshots: a passing geometry check is not a UX sign-off or proof of physical stage usability.

Secondary setup explanations are collapsed under labelled help disclosures. Native draft tone controls are directly tappable; the full block/device control selector remains available under All controls. Artwork without an image is compact metadata behind a count, while cached images stay visible and served locally. A silent draft is labelled explicitly; these presentation changes do not imply shared structural authoring with the playing worker.

## Mixed composition

Library → New preset can combine saved native tones and installed scalar LV2 effects. A compatible saved tone can become linked amp/cab stages with explicit input and amp-head confirmation; effects can sit between them. The original tone stays unchanged. Failed preparation keeps the draft open, and pending preparation can be cancelled. Rig appears only after confirmed running state. Stage controls use the same touch adjustment surface and separate offline Save. See [mixed engine](mixed-engine.md) for the qualified source/rate limits and remaining live structural authoring work.

## Scenes and ready presets

Scene pads recall routing snapshots inside the playing preset. The routing view
marks every sounding branch and dims inactive branches; selecting a scene
updates both views from the engine's confirmed state. A branch toggle creates an
unsaved mix for the selected scene. **Update scene** publishes that routing mix
as a new preset revision, while **Save** remains the whole-preset action for
shared block controls.

**Ready to switch** is a compact status for other loaded presets, not another
scene selector. Playing is audible, Processing is still rendering a transition
or tail, and Sleeping is loaded without current DSP work.
