# @oxidal/design-system

The Oxidal design system: tokens, components, instrument widgets and page
patterns, shared by `apps/web` and `apps/storybook`. React 19, TypeScript,
Tailwind CSS 4, Radix primitives, class-variance-authority and Phosphor icons.

```tsx
import { Button } from '@oxidal/design-system/components/button';
import { RigSurface } from '@oxidal/design-system/patterns/rig-surface';
```

Components take their data as props and report changes through callbacks.
Example data and stand-in devices (`*.data.ts`, `*.fixtures.ts`, `*.demo.tsx`)
serve the stories only and are not exported; `src/package.test.ts` guards this.

## Commands

```bash
pnpm --dir packages/ui check   # format, lint, types and unit tests
pnpm --dir apps/storybook dev  # see the stories
```

## Layout

- `src/styles/` — tokens (`theme.css`) and the full stylesheet (`index.css`).
- `src/components/ui/` — primitives: `<name>.tsx` with its stories and tests.
- `src/widgets/` — instrument widgets (meter, chain block, scene pad …).
- `src/patterns/` — page patterns (app shell, settings page, rig surface …).
- `src/screens/` — every product screen rebuilt with example data (not exported).
- `src/foundations/` — stories for colours, type, space and display modes.
- `public/` — brand files and example pictures.
