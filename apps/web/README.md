# Oxidal web control

React/TypeScript/Vite, a shadcn-style Radix button primitive, Phosphor icons, and a quiet monochrome-first interface. State comes from the native Rust service, not a browser-only mock. Audio is unavailable in this build.

From the repository root, `pnpm dev` starts both service and Vite. Open http://127.0.0.1:5173. `pnpm --dir apps/web check` runs formatting, ESLint, Knip, component/unit tests, type checking, and the production build. `pnpm test:e2e` starts isolated local servers and runs desktop/mobile Chromium tests including accessibility scans. Stop an existing dev server before e2e; its daemon must not share test state.

`src/generated/` is generated from Rust wire types. Use `pnpm contract:generate`; `pnpm contract:check` detects drift. Ajv validates incoming snapshots/capabilities at runtime. The generated TypeScript file is excluded from unused-export analysis because the schema intentionally includes contracts used by other clients; application source is still checked. Knip follows CSS so Tailwind imports are analyzed.

Perform controls, routing, mapping, learn and feedback are functional control-plane features. The MIDI panel is explicitly a simulator. Library imports native preset originals through the real API and offers byte-exact downloads; playback/editing remain explicitly unavailable. There is no physical MIDI port, provider login, model download catalog, or live audio connection yet. Persisted mappings reload when opening Settings; audio/model selection and real hardware settings must not be simulated as working.

Target-phone usability and deployment qualification remain pending. Automated axe checks complement keyboard/screenshot checks; they do not establish complete accessibility conformance.
