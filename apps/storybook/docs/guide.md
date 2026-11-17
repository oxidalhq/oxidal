# Oxidal design guide

The rules for building Oxidal's interface. Storybook shows the same pages
under **Guide**, next to the live components. When a rule and a component
disagree, the rule wins and the component gets fixed.

## 1. Principles

1. **Readout first.** Every screen is an instrument readout: strong type,
   aligned values, thin rules, generous touch targets, few controls in view.
2. **Paper, ink, one oxide.** Oxide marks what is live or committed (playing,
   unsaved, Save). Category colour appears only as block LEDs. Selection
   inverts ink and paper. The design works in black and white first.
3. **One of each.** One button, one chip, one meter, one dialog, one sheet,
   one caption. A second variant needs a rule here first.
4. **Container ladder.** Inline → popover → dropdown → sheet → dialog → page.
   Use the smallest container that holds the task.
5. **Phone is the first viewport.** Design at 393 px, then widen. No
   horizontal scrolling except the chain strip and the set list.
6. **Type does the hierarchy.** Small caps for labels, the display face for
   the name of the thing, mono for values, sans for everything read.
7. **Say the state.** Playing, cued, stale, disconnected, unsaved, protected
   are words and badges; colour and shape only reinforce them.
8. **No decoration.** Graphs show data; motion only confirms an action and
   stops under reduced motion.

## 1a. Who it is for

Oxidal's players are old and young, technical and not, and working
musicians who need the thing to work at a gig. Many come from Fractal,
Quad Cortex, HeadRush or Kemper. So:

- Words over symbols: every icon-only control has a name; every state is a
  word; loading says what is loading, never a bare spinner.
- Their vocabulary where it is shared: Preset, Scene, Block, Chain, Cab, IR,
  Capture, Set list, Tap tempo, Tuner. Say "Rig" for the whole thing and
  "Model" for a NAM capture; never invent a word where one exists.
- Big enough on stage: the preset name and tuner in the display size;
  44 px targets, 48 px in the stage modes.
- Nothing hidden that a Kemper or Fractal player expects to find: the full
  editor is always one tap behind the quick one.

## 2. The voice of the type

| Voice   | Use                                                             | How                                                  |
| ------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| Label   | Eyebrows, section and table heads, block categories, chips, nav | `small-caps` utility or `<Eyebrow>`; never uppercase |
| Name    | The preset, song, rig or page on screen                         | `<Title>`: display face, semibold, tight tracking    |
| Value   | Anything measured: levels, times, buffers, tempo, tuner         | `<Readout>`: mono, tabular numbers                   |
| Body    | Sentences                                                       | sans, `text-base`                                    |
| Caption | Secondary line under a title or control                         | `<Caption>`: `text-sm` muted ink                     |

Sizes come from the scale only (`text-2xs` … `text-display`). On stage the
name goes to `text-3xl` or `text-display`; in dense lists captions drop to
`text-xs`; nothing else changes size per screen.

## 3. Container ladder

| Need                                              | Container     | Example                               |
| ------------------------------------------------- | ------------- | ------------------------------------- |
| Change a value in place                           | Inline        | Fader under the selected block        |
| A short choice or a small form, context must stay | Popover       | Add block, sort, pick a scene colour  |
| A list of actions on one thing                    | Dropdown menu | Rename, Duplicate, Delete… on a track |
| Edit many controls while the screen stays visible | Sheet         | Block controls, the player, stems     |
| A decision that must be answered before going on  | Dialog        | Confirm delete, audio buffer change   |
| A workspace of its own                            | Page          | Library, Settings, the rig editor     |

Phones get bottom sheets; laptops get side sheets. Dialogs never stack on
dialogs. A sheet may open a popover or a confirm dialog, nothing more.

## 4. Writing

- Plain words, the specific thing: "Audio stopped unexpectedly", not "Error".
- Buttons are verbs: Save, Open, Split, Cue. "Delete…" with an ellipsis when a
  confirm follows. Never "OK".
- Captions explain the consequence, not the mechanism: "Stops the track that
  is playing", not "Transport will be reset".
- States are words: Playing, Cued, Stale, Disconnected, Unsaved, Protected.
- Numbers keep their unit and sign: −12.0 dB, 48 × 3 · 6 ms, 120 BPM.
- Titles are sentence case. Small caps carry labels, so no uppercase strings.

## 5. Display modes

| Mode     | Surfaces                  | Shadows | Touch target | Notes                                     |
| -------- | ------------------------- | ------- | ------------ | ----------------------------------------- |
| Default  | Paper, ink, oxide         | Raised  | 44 px        | The design is made here first             |
| Night    | Dark paper, lighter oxide | Raised  | 48 px        | No pure white; faceplate darkest          |
| Sunlight | White and black only      | None    | 48 px        | Secondary ink is black; borders are black |
| E-paper  | Black and white, no greys | None    | 48 px        | No animation; LEDs are black              |

Only colour tokens change per mode. If a component needs a per-mode rule, it
is a token that is missing.

## 6. Structure of the repository

```
src/styles/theme.css      tokens (colour per mode; type, space, radius, layers, motion in @theme)
src/styles/index.css      Tailwind, base text and focus
src/lib/cn.ts             class merging
src/components/ui/        primitives: <name>.tsx + .stories.tsx + .test.tsx
src/widgets/              instrument widgets (meter, chain block, scene pad …)
src/patterns/             page patterns (app shell, settings page, rig surface …)
src/screens/              every product screen rebuilt with demo data (not exported)
src/guide/                these pages as MDX for Storybook
docs/guide.md             this file; docs/migration.md maps product files to replacements
scripts/sync.mjs          copies styles, ui, widgets and patterns into the product
```

A component is one file with its variants in `cva`, its own stories for
every state and a test for behaviour. Widgets compose primitives; patterns
compose widgets; screens compose patterns. Nothing imports upward.

### Ready for the app

Everything in `components/ui`, `widgets` and `patterns` is imported by the
app as `@oxidal/design-system/<folder>/<name>`, so it must work with real
data:

- **Data comes in as props, changes go out as callbacks.** A component never
  holds example presets, networks or readings, and never pretends to be the
  device with timers. State that only the screen cares about (an open
  dialog, a selected tab, a half-typed name) may stay inside.
- **Examples live beside the component**: `<name>.data.ts` or
  `<name>.fixtures.ts` for example data, `<name>.demo.tsx` for a stand-in
  device (download progress, a 15-second confirmation). Only stories and
  `src/screens/` use them; the package does not export them.
- **Screens are reference compositions.** They show how the parts fit with
  demo data; the app builds its own screens from the same parts.
- `src/package.test.ts` checks that every module is exported and that none
  imports example data or a demo.

## 7. Component table

The table of every component — what to use it for, what not, and the
product files it replaces — is the Storybook page **Guide › Components**
(`src/guide/Components.mdx`), kept next to the live stories so it cannot
drift. In short:

- Actions: Button. States that stay: Toggle. One of a few: SegmentedControl.
  Settings: Switch. Some of many: Checkbox. One of many: Select; by typing:
  Combobox. Numbers: NumberField; positions: Slider and faders.
- Structure: Tabs, Card, List and ListRow, Separator, ScrollArea,
  Collapsible. Labels: Badge and Led, the text styles.
- Containers: Tooltip, Popover, DropdownMenu, Dialog and useConfirm, Sheet.
- States: Skeleton, Loading, EmptyState, Progress, StepProgress, and the
  NoticeTray with useNotice and notify. Screens that take a while show their
  own skeleton (RigSkeleton, LibrarySkeleton, SettingsSkeleton,
  PlayerSkeleton) inside LoadingScreen, which adds a line after two seconds
  saying what is still loading and how far.
- Credits: CreditBadge and Credits for About, PoweredByTone3000 beside every
  catalogue tone.

`pnpm a11y` runs axe over every story of the built Storybook and is part of
`pnpm check`.
