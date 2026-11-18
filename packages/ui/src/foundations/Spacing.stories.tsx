import type { Meta, StoryObj } from '@storybook/react-vite';

import { Caption } from '../components/ui/text';

/**
 * Space, radius, layers and motion. One 4 px scale for every gap and inset;
 * named steps for the page and panel insets and the touch target.
 */
const meta: Meta = {
  title: 'Foundations/Space, radius, layers',
  parameters: { layout: 'padded' },
};
export default meta;

const STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;

export const Space: StoryObj = {
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <div className="grid gap-2">
        {STEPS.map((step) => (
          <div
            key={step}
            className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-4"
          >
            <code className="text-xs">gap-{step}</code>
            <div className="flex items-center gap-3">
              <div
                className="h-4 bg-brand"
                style={{ width: `calc(var(--spacing) * ${step})` }}
              />
              <Caption className="text-xs">{step * 4}px</Caption>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-2">
        <h2 className="m-0 text-md font-semibold">Named steps</h2>
        <Caption>
          <code>p-page</code> clamp(12px, 2vw, 24px) for the page inset ·{' '}
          <code>p-panel</code> clamp(12px, 1.5vw, 18px) for panels ·{' '}
          <code>size-touch</code> 44px (48px in Night, Sunlight and E-paper).
        </Caption>
      </div>
      <Caption>
        Rules of thumb: 2 inside a control, 3 between controls, 4 between
        groups, 6 between sections, 8 between page regions.
      </Caption>
    </div>
  ),
};

export const Radius: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-6">
      {[
        ['rounded-lg', '4px — controls, cards, dialogs'],
        ['rounded-pad', '8px — scene pads and chain tiles'],
        ['rounded-full', 'pill — badges and LEDs'],
      ].map(([cls, use]) => (
        <div key={cls} className="grid gap-2">
          <div className={`size-20 border border-border bg-card ${cls}`} />
          <code className="text-xs">{cls}</code>
          <Caption className="max-w-40 text-xs">{use}</Caption>
        </div>
      ))}
    </div>
  ),
};

export const LayersAndElevation: StoryObj = {
  name: 'Layers and elevation',
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <div className="grid gap-1">
        {[
          ['z-strip', '10', 'Sticky resource strip and page headers'],
          ['z-sheet', '20', 'Bottom and side sheets'],
          ['z-popover', '30', 'Popovers, menus, tooltips'],
          ['z-dialog', '40', 'Dialogs and the tuner'],
          ['z-tray', '50', 'The notice tray, above everything'],
        ].map(([cls, value, use]) => (
          <div
            key={cls}
            className="grid grid-cols-[7rem_3rem_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-1"
          >
            <code className="text-xs">{cls}</code>
            <span className="font-mono text-xs">{value}</span>
            <Caption className="text-xs">{use}</Caption>
          </div>
        ))}
      </div>
      <div className="relative h-40 rounded-lg border border-border bg-card p-4">
        <Caption>A card on the page: border only, no shadow.</Caption>
        <div className="absolute right-4 bottom-4 w-56 rounded-lg border border-border bg-raised p-3 shadow-raised">
          <p className="m-0 text-sm font-medium">Raised</p>
          <Caption className="text-xs">
            Sheets, popovers, menus and the tray: <code>bg-raised</code> +{' '}
            <code>shadow-raised</code>. No shadow in Sunlight and E-paper.
          </Caption>
        </div>
      </div>
    </div>
  ),
};

export const Motion: StoryObj = {
  render: () => (
    <div className="grid max-w-xl gap-3">
      <Caption>
        Two durations, one curve: <code>--duration-fast</code> 120 ms for state
        changes (press, toggle, LED), <code>--duration-base</code> 200 ms for
        sheets and popovers entering. Only transform and opacity animate. Under
        reduced motion both are 0 ms.
      </Caption>
      <button
        type="button"
        className="w-fit rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-95"
      >
        Press me
      </button>
    </div>
  ),
};
