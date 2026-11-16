# Oxidal design system

The visual language and React component library for Oxidal, shown and tested
in Storybook. Same stack as `apps/web`: React 19, TypeScript, Vite, Tailwind
CSS 4, Radix primitives, class-variance-authority and Phosphor icons. The
web app imports it as the workspace package `@oxidal/design-system`.

## Commands

```bash
pnpm --dir apps/storybook dev     # Storybook at http://127.0.0.1:6006
pnpm --dir apps/storybook check   # format, lint, tests and a Storybook build
```

`pnpm check` from the repository root runs the same check.

## Layout

- `src/styles/` — tokens (`theme.css`) and the stylesheet Storybook loads.
- `src/foundations/` — stories for colours, type, space, layers and the
  display modes.
- `src/components/ui/` — the component library: `<name>.tsx` with its
  stories and tests beside it.
- `src/widgets/` — instrument widgets (meter, chain block, scene pad …).
- `src/patterns/` — page patterns (app shell, settings page, rig surface …).
- `src/guide/` — the guide pages shown in Storybook.
- `docs/guide.md` — the written guide: which component and container to use
  when, and why.
