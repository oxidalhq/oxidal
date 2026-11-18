# Oxidal Storybook

The place to see and test the design system. The components themselves live in
[`packages/ui`](../../packages/ui/README.md) as the workspace package
`@oxidal/design-system`, which this Storybook and `apps/web` both import.

## Commands

```bash
pnpm --dir apps/storybook dev     # Storybook at http://127.0.0.1:6006
pnpm --dir apps/storybook check   # the package's checks, every story, the build and the layout sweep
```

`pnpm check` from the repository root runs the same check.

## Layout

- `.storybook/` — Storybook configuration; it loads the stories from
  `packages/ui/src`.
- `guide/` — the guide pages shown in Storybook.
- `baseline/` — the product's current chain view beside the new one.
- `scripts/layout.mjs` — overflow and colour contrast on every device and
  display mode.
- `docs/guide.md` — the written guide: which component and container to use
  when, and why.
- `docs/migration.md` — how `apps/web` moves onto the package.
