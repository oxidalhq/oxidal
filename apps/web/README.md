# Oxidal web control

React/TypeScript/Vite, a shadcn-style Radix button primitive, Phosphor icons, and a CSS-token instrument theme. State comes from the native Rust service, not a browser-only mock. Audio is unavailable in this build.

From the repository root, `pnpm dev` starts both service and Vite. Open http://127.0.0.1:5173. `pnpm --dir apps/web check` runs formatting, ESLint, Knip, component/unit tests, type checking, and the production build. `pnpm test:e2e` starts isolated local servers and runs desktop/mobile Chromium tests including accessibility scans. Stop an existing dev server before e2e; its daemon must not share test state.

`src/generated/` is generated from Rust wire types. Use `pnpm contract:generate`; `pnpm contract:check` detects drift. Ajv validates incoming snapshots/capabilities at runtime. The generated TypeScript file is excluded from unused-export analysis because the schema intentionally includes contracts used by other clients; application source is still checked. Knip follows CSS so Tailwind imports are analyzed.

Perform controls, routing, mapping, learn and feedback are functional control-plane features. Edit offers owned numeric previews with exact commit, cancel/rollback and idle expiry; reconnect retains the draft without replaying it. The MIDI panel is explicitly a simulator. Library imports native preset originals through the real API and offers byte-exact downloads; an explicitly enabled native worker adds offline editing, staged processing controls and owned-copy save/reload. Live playback remains unavailable. There is no physical MIDI port, provider login, model download catalog, or live audio connection yet. Persisted mappings reload when opening Settings; audio/model selection and real hardware settings must not be simulated as working.

Target-phone usability and deployment qualification remain pending. Automated axe checks complement keyboard/screenshot checks; they do not establish complete accessibility conformance.

## Theme

Edit `src/theme.css` to change the look without editing TSX. The default
**Multistomp** theme takes visual cues from the original
[Zoom MS-70CDR](https://zoomcorp.com/en/gb/multi-effects/multistomp-pedals/ms-70cdr/):
blue enclosure accents, a monochrome LCD-style chain, and clear numeric readouts.
Oxidal keeps its own layout, labels and behavior. The semantic colour pairs follow
[shadcn CSS-variable theming](https://ui.shadcn.com/docs/theming).

- **App and shadcn colours:** `--background`, `--foreground`, `--card`,
  `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`,
  `--input`, `--ring` and their foreground counterparts. Values are complete CSS
  colours, not bare HSL channels. The `@theme inline` bridge exposes standard
  utilities such as `bg-primary` and `text-primary-foreground` to components.
- **Instrument surfaces:** `--enclosure*` controls the header; `--lcd*` controls
  the chain display. These surfaces locally remap the same semantic tokens,
  including button, border and focus colours, so components remain reusable.
- **Shape and density:** `--radius`, `--panel-radius`, `--display-radius`,
  `--page-space`, `--panel-space`, `--control-gap`, `--content-width` and
  `--touch-target`. Keep primary touch targets at least 44px.
- **Typography:** `--font-sans`, `--font-mono`, `--title-size` and
  `--readout-size`. Defaults use local system fonts, with no font download.
- **Depth:** `--panel-shadow` and `--lcd-shadow`; set both to `none` for a flatter
  presentation. Status and selections also have text/pressed-state cues.

For example, change `--primary` and `--ring` together to retune the control
accent; change `--lcd`, `--lcd-card`, `--lcd-foreground`, `--lcd-muted` and
`--lcd-border` together for a different screen palette. Avoid putting fixed
colour utilities into TSX. Structural responsive rules live in `src/styles.css`.

Vite updates CSS while `pnpm dev` runs. For the built preview, run
`pnpm --dir apps/web build` and refresh. After theme changes, run the web checks
and `pnpm test:e2e`: the existing accessibility test saves desktop/mobile rig and
settings screenshots in `.local/previews/`. Inspect them alongside the automated
contrast/keyboard checks; physical phone and e-paper qualification is separate.
