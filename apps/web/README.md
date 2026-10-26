# Oxidal web control

React/TypeScript/Vite, a shadcn-style Radix button primitive, Phosphor icons, and a CSS-token instrument theme. State comes from the native Rust service, not a browser-only mock. Audio is unavailable in this build.

From the repository root, `pnpm dev` starts both service and Vite. Open http://127.0.0.1:5173. `pnpm --dir apps/web check` runs formatting, ESLint, Knip, component/unit tests, type checking, and the production build. `pnpm test:e2e` starts isolated local servers and runs desktop/mobile Chromium tests including accessibility scans. Stop an existing dev server before e2e; its daemon must not share test state.

`src/generated/` is generated from Rust wire types. Use `pnpm contract:generate`; `pnpm contract:check` detects drift. Ajv validates incoming snapshots/capabilities at runtime. The generated TypeScript file is excluded from unused-export analysis because the schema intentionally includes contracts used by other clients; application source is still checked. Knip follows CSS so Tailwind imports are analyzed.

Perform controls, routing, mapping, learn and feedback are functional control-plane features. Edit offers owned numeric previews with exact commit, cancel/rollback and idle expiry; reconnect retains the draft without replaying it. The MIDI panel is explicitly a simulator. Library imports native preset originals through the real API and offers byte-exact downloads; an explicitly enabled native worker adds offline editing, staged processing controls and owned-copy save/reload. Live playback remains unavailable. There is no physical MIDI port, provider login, model download catalog, or live audio connection yet. Persisted mappings reload when opening Settings; audio/model selection and real hardware settings must not be simulated as working.

Target-phone usability and deployment qualification remain pending. Automated axe checks complement keyboard/screenshot checks; they do not establish complete accessibility conformance.

## Theme

Edit `src/theme.css` to change the look without editing TSX. The default
**Orchid LCD** theme takes visual cues from the original
[Zoom MS-70CDR](https://zoomcorp.com/en/gb/multi-effects/multistomp-pedals/ms-70cdr/):
a monochrome LCD-style chain and clear numeric readouts. Ink chrome, electric
orchid accents, modern sans-serif headings and compact effect tiles give it an
independent old-and-new character. The instrument layout now uses
[Mira-inspired density](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create):
tighter padding, modest radii and joined chain/control surfaces. This adapts our
existing shadcn-style primitives; it does not install or regenerate a stock Mira
preset. Primary touch targets remain 44px (48px in stage/sunlight/e-paper modes).
Oxidal keeps its own layout, labels and behavior. The semantic colour pairs follow
[shadcn CSS-variable theming](https://ui.shadcn.com/docs/theming).

- **App and shadcn colours:** `--background`, `--foreground`, `--card`,
  `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`,
  `--input`, `--ring` and their foreground counterparts. Values are complete CSS
  colours, not bare HSL channels. The `@theme inline` bridge exposes standard
  utilities such as `bg-primary` and `text-primary-foreground` to components.
- **Signature colour:** `--brand` and `--primary` supply electric orchid with dark
  text (`--primary-foreground`). Deeper `--control-accent`, `--readout-foreground`
  and `--ring` keep sliders, small readouts and focus outlines readable on light
  surfaces. `--lcd-action` and its foreground pair style selected routing controls.
- **Instrument surfaces:** `--enclosure*` controls the header; `--lcd*` controls
  the chain display. These surfaces locally remap the same semantic tokens,
  including button, border and focus colours, so components remain reusable.
- **Shape and density:** `--radius`, `--panel-radius`, `--display-radius`,
  `--page-space`, `--panel-space`, `--control-gap`, `--content-width` and
  `--touch-target`, `--rack-gap` and `--selected-edge`. Keep primary touch targets at least 44px.
- **Typography:** `--font-sans`, `--font-mono`, `--title-size` and
  `--readout-size`. Defaults use local system fonts, with no font download.
- **Depth:** `--panel-shadow`, `--effect-shadow` and `--lcd-shadow`; set these to `none` for a flatter
  presentation. Status and selections also have text/pressed-state cues.

For example, change `--brand` to retune the signature accent (primary buttons,
effect edges and routing selection inherit it), paired with `--brand-foreground`.
Use `--control-accent` for the deeper slider/readout/focus shade; change `--lcd`, `--lcd-card`, `--lcd-foreground`, `--lcd-muted` and
`--lcd-border` together for a different screen palette. Avoid putting fixed
colour utilities into TSX. Structural responsive rules live in `src/styles.css`.

Vite updates CSS while `pnpm dev` runs. For the built preview, run
`pnpm --dir apps/web build` and refresh. After theme changes, run the web checks
and `pnpm test:e2e`: the existing accessibility test saves desktop/mobile rig and
settings screenshots in `.local/previews/`. Inspect them alongside the automated
contrast/keyboard checks; physical phone and e-paper qualification is separate.

## Device layouts

The responsive UI targets the iPhone XR, Galaxy Z Fold4 (cover and unfolded),
and BOOX Note Air3 C in portrait and landscape. Layout follows available CSS
width/height, not device names. Rotation and fold resizing keep an active edit
mounted. Wide landscape views use a compact horizontal chain; narrower views
wrap it into ordered rows with explicit split/merge indicators. Controls stay scrollable when a keyboard reduces available height.
Inputs use 16px text, primary controls have 44px minimum height, and landscape
safe areas keep content clear of cutouts. Zoom remains enabled.

On BOOX, enable **Display mode → E-paper** in the header. This browser-local
preference survives reloads and uses plain black/white surfaces, stronger borders,
larger supporting text and no transitions/shadows. It can be disabled to restore
Orchid. It does not control the device's refresh mode or claim to eliminate
physical e-ink ghosting. Browser storage denial leaves the current selection
usable but prevents persistence.

The existing `pnpm test:e2e` suite includes these representative CSS viewports:

| Profile        | Portrait   | Landscape  | Engine                       |
| -------------- | ---------- | ---------- | ---------------------------- |
| iPhone XR      | 414 × 896  | 896 × 414  | WebKit                       |
| Fold4 cover    | 345 × 883  | 883 × 345  | Chromium                     |
| Fold4 unfolded | 690 × 829  | 829 × 690  | Chromium                     |
| BOOX Air3 C    | 930 × 1240 | 1240 × 930 | Chromium, e-paper preference |

The XR uses a 2× scale. Fold4 uses representative 2.625× Android scaling; BOOX
uses a representative 2× browser scale plus a 768 × 1024 density stress check.
Android display size, browser chrome and zoom can change these CSS dimensions.
BOOX colour-pixel resolution is not assumed to be its browser viewport.
Manufacturer references: [Apple XR display](https://developer.apple.com/videos/play/tech-talks/207/),
[Samsung Fold4 displays](https://news.samsung.com/us/samsung-galaxy-z-flip4-galaxy-z-fold4-unpacked-2022-most-versatile-smartphones/),
[BOOX specifications](https://shop.boox.com/en-au/products/boox-note-air3).
Safe-area treatment follows [WebKit guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).

For only the device matrix, run from the repository root:

```sh
pnpm test:e2e --project=iphone-xr --project=fold4-cover --project=fold4-open --project=boox-air3c
```

Bootstrap/CI installs Chromium and WebKit. Existing installations can run
`pnpm --dir apps/web exec playwright install chromium webkit`. Screenshots land
in `.local/previews/devices/`. Tests cover both orientations across rig, settings
and library, touch height, horizontal overflow, accessibility, rotating/folding
an owned edit, reduced keyboard height, synthetic notch insets and persistent
(easily reversible) e-paper mode. The existing native preset load/edit/save test
also runs on device profiles via `pnpm native:check` when the native worker is
available. The default build explicitly skips native workflows.

Emulation uses current browser engines; it is not the Safari/Chrome build installed
on a physical device. Final checks on the actual phones/tablet still need browser
version, zoom/display settings, on-screen keyboard, notch and e-ink refresh/readability.
Live audio and physical MIDI remain outside this UI qualification.

### Live display modes

The header's **Display mode** selector is available on every view. **Sunlight**
uses white surfaces and strong borders; **Dark stage** uses dark surfaces with
bright values and Orchid accents. Both use 48px primary-control heights.
**E-paper** adds monochrome and removes transitions. Choices persist locally;
there is no automatic theme switch during performance. All modes are CSS tokens
in `theme.css`. Actual sunlight/glare and venue readability still need physical
checks; the app cannot set screen brightness.

### Precise touch adjustment

Open **Edit** on a rig parameter or **Begin native edit** in the preset editor.
The large adjustment surface uses relative motion: touching alone does not move
the value. **Fine** makes the next drag ten times slower. **Restore starting value**
recovers the exact baseline, including values between normal step increments.
Arrow keys, plus/minus and direct numeric entry remain available in both editors.
Pointer cancellation or capture loss restores the start of that drag. Release
keeps a preview; **Commit** saves the exact draft, and **Cancel** restores the
transaction baseline. Navigation cancels an unfinished edit; the server lease
also rolls back abandoned edits.

Rig and native editors share the existing coalescing queue: one request in flight,
one replaceable preview, and an ordered terminal commit/cancel. Native processing
settings remain staged until commit. Native values are shown as normalized range
percentages, not invented dB units; full native descriptor/display mapping is
still pending. These gestures are an independent implementation of the preserved
behaviour, not a copied source UI. Live audio remains unavailable.

### Instrument control surface

The preset/bypass bar, compact signal path and quick controls form one workspace.
Tap a controllable effect to highlight its corresponding parameter and bring it
into view. Confirmed values also appear on chain blocks. Selection changes no
sound or control state, does not create an edit, and leaves an existing draft
mounted. All quick parameters remain visible; keyboard focus also updates the
selection. Use Edit for relative/Fine adjustment, exact entry and cancellation.
The silent-preview status remains explicit, with a direct Audio setup button;
routing explanation is available under Routing details. There are no decorative
meters or implied processing indicators.

## Branding and chain layout

The supplied Balanced wordmark lives in `public/brand/` as font-free SVG masters. The header uses a CSS mask so it follows each display mode, including e-paper. `pnpm brand:render` from the repository root derives the PNG touch icon, wordmark and Linux boot splash using the pinned browser. It never needs the private design folder. The mark is also the browser favicon.

`SignalChain` uses the shared shadcn-style Button and one responsive grid. At narrow widths the input/NAM and effects occupy separate rows; the merge arrow preserves direction. Effect tiles have equal heights and unbroken names. The device E2E matrix checks geometry, accessibility and portrait/landscape editing. `prettier-plugin-tailwindcss` sorts JSX and `cva`/`clsx` utilities automatically against the stylesheet; run the normal formatter.
