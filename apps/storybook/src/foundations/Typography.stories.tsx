import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption } from '../components/ui/text';

/**
 * The type scale. Every text size in Oxidal is one of these; the utilities
 * `text-2xs` … `text-display` and the CSS variables `--text-*` are the same
 * values. Line heights ride with the size.
 */
const meta: Meta = {
  title: 'Foundations/Typography',
  parameters: { layout: 'padded' },
};
export default meta;

const SCALE = [
  ['2xs', '11px', 'Chip and meter labels, LED captions'],
  ['xs', '12px', 'Captions in dense lists, eyebrows'],
  ['sm', '13px', 'Captions, secondary text, buttons'],
  ['base', '14px', 'Body'],
  ['md', '16px', 'Section titles, leads, readouts'],
  ['lg', '18px', 'Dialog and sheet titles'],
  ['xl', '20px', 'Page titles on phones'],
  ['2xl', '24px', 'Page titles, large readouts'],
  ['3xl', '30px', 'Stage preset name on phones'],
  ['display', 'clamp(32px, 6vw, 56px)', 'Stage readouts: preset, tuner, tempo'],
] as const;

export const Scale: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl gap-4">
      {SCALE.map(([step, px, use]) => (
        <div
          key={step}
          className="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-4 border-b border-border pb-3"
        >
          <div className="grid gap-0.5">
            <code className="text-xs">text-{step}</code>
            <Caption className="text-xs">{px}</Caption>
            <Caption className="text-xs">{use}</Caption>
          </div>
          <p
            className="m-0 truncate"
            style={{
              fontSize: `var(--text-${step})`,
              lineHeight: `var(--text-${step}--line-height)`,
            }}
          >
            Rhythm section, Ambient swell, Lead boost
          </p>
        </div>
      ))}
    </div>
  ),
};

export const Weights: StoryObj = {
  render: () => (
    <div className="grid max-w-xl gap-2">
      <p className="m-0 text-md font-normal">400 normal — body and captions</p>
      <p className="m-0 text-md font-medium">500 medium — labels, readouts</p>
      <p className="m-0 text-md font-semibold">
        600 semibold — titles, buttons
      </p>
      <p className="m-0 text-md font-bold">700 bold — the preset name only</p>
    </div>
  ),
};

export const Families: StoryObj = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <p className="m-0 font-sans text-md">
        Sans (system-ui): everything that is read.
      </p>
      <p className="m-0 font-mono text-md">
        Mono (ui-monospace): readouts and values — 48 × 3 · 6 ms · −12.0 dB.
      </p>
      <p className="m-0 font-sans small-caps text-md">
        Small caps: eyebrows, section heads, categories, chips, navigation.
      </p>
      <p className="m-0 font-display text-2xl font-semibold tracking-tight">
        Display (ui-serif, proposed D-6): the name of the thing — preset, song,
        rig.
      </p>
      <Caption>
        System fonts keep the Pi image small and match each device; no web fonts
        are loaded.
      </Caption>
    </div>
  ),
};

export const Hierarchy: StoryObj = {
  name: 'Hierarchy on a page',
  render: () => (
    <article className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <span className="small-caps text-sm font-medium text-muted-foreground">
          Library
        </span>
        <h1 className="m-0 font-display text-2xl font-semibold tracking-tight">
          Backing tracks
        </h1>
        <Caption>12 tracks · 3 with stems · 48 min</Caption>
      </header>
      <section className="grid gap-2">
        <h2 className="m-0 small-caps text-md font-semibold">
          Recently played
        </h2>
        <p className="m-0 text-base">
          Body text at 14 px with a 1.45 line height. Captions sit at 13 px in
          the muted ink; dense lists may drop to 12 px.
        </p>
      </section>
    </article>
  ),
};
