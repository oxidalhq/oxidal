import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption, Eyebrow, Title } from '../components/ui/text';

/**
 * The same composition in each display mode, side by side, so a token change
 * is judged in all four at once. The toolbar switches the whole page; this
 * story pins each mode with `data-display` on a wrapper.
 */
const meta: Meta = {
  title: 'Foundations/Display modes',
  parameters: { layout: 'fullscreen' },
};
export default meta;

const MODES = [
  ['default', 'Default (paper)'],
  ['stage', 'Night'],
  ['sunlight', 'Sunlight'],
  ['epaper', 'E-paper'],
] as const;

function Sample() {
  return (
    <div className="grid gap-4 bg-background p-6 text-foreground">
      <div className="flex items-center justify-between rounded-lg bg-enclosure px-4 py-3 text-enclosure-foreground">
        <span className="font-semibold">oxidal</span>
        <span className="text-sm opacity-80">Rig · Library · Settings</span>
      </div>
      <div className="grid gap-1">
        <Eyebrow>Playing</Eyebrow>
        <Title>Rhythm section</Title>
        <Caption>Scene 2 · Crunch</Caption>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-brand bg-brand px-3 py-2 text-sm font-semibold text-brand-foreground"
        >
          Save
        </button>
        <button
          type="button"
          className="rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-semibold"
        >
          Open
        </button>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-danger-ink"
        >
          Delete…
        </button>
      </div>
      <div className="relative rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-led-amp" />
          <span className="text-sm font-medium">Amp · Plexi 50</span>
          <span className="ml-auto rounded-full border border-border px-2 text-2xs">
            unsaved
          </span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-wire/40">
          <div className="h-1.5 w-2/3 rounded-full bg-foreground" />
        </div>
        <div className="absolute right-3 -bottom-6 rounded-lg border border-border bg-raised px-3 py-2 text-xs shadow-raised">
          Raised popover
        </div>
      </div>
    </div>
  );
}

export const SideBySide: StoryObj = {
  render: () => (
    <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2 xl:grid-cols-4">
      {MODES.map(([mode, label]) => (
        <div key={mode} data-display={mode} className="grid gap-0">
          <div className="bg-background px-6 pt-4 text-foreground">
            <Caption className="text-xs">{label}</Caption>
          </div>
          <Sample />
          <div className="h-8 bg-background" />
        </div>
      ))}
    </div>
  ),
};
