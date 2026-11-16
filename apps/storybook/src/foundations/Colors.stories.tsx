import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption } from '@/components/ui/text';

/**
 * Colour tokens in the four display modes (switch them in the toolbar).
 * Paper, ink and one oxide accent; LEDs for block categories; one raised
 * surface. Utilities use the `--color-*` names (bg-card, text-danger-ink).
 */
const meta: Meta = {
  title: 'Foundations/Colours',
  parameters: { layout: 'padded' },
};
export default meta;

const SURFACES = [
  ['background', 'Page'],
  ['card', 'Card / panel'],
  ['surface-raised', 'Raised: sheets, popovers'],
  ['secondary', 'Secondary control'],
  ['muted', 'Muted'],
  ['accent', 'Hover / pressed'],
  ['enclosure', 'Faceplate (header)'],
] as const;

const INKS = [
  ['foreground', 'Ink'],
  ['muted-foreground', 'Secondary ink'],
  ['brand', 'Oxide: live / committed'],
  ['danger-ink', 'Danger ink: destructive labels'],
  ['border', 'Rule'],
  ['wire', 'Wire / meter track'],
  ['ring', 'Focus ring'],
] as const;

const LEDS = [
  ['led-amp', 'Amp'],
  ['led-cab', 'Cabinet'],
  ['led-pedal', 'Pedal'],
  ['led-time', 'Time'],
  ['led-mod', 'Modulation'],
  ['led-lv2', 'LV2'],
] as const;

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div className="grid gap-1">
      <div
        className="h-14 rounded-lg border border-border"
        style={{ background: `var(--${token})` }}
      />
      <strong className="text-sm">{label}</strong>
      <code className="text-xs text-muted-foreground">--{token}</code>
    </div>
  );
}

function Group({
  title,
  items,
}: {
  title: string;
  items: readonly (readonly [string, string])[];
}) {
  return (
    <section className="grid gap-3">
      <h2 className="m-0 text-md font-semibold">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        {items.map(([token, label]) => (
          <Swatch key={token} token={token} label={label} />
        ))}
      </div>
    </section>
  );
}

export const Palette: StoryObj = {
  render: () => (
    <div className="grid max-w-4xl gap-8">
      <Group title="Surfaces" items={SURFACES} />
      <Group title="Ink and lines" items={INKS} />
      <Group title="Block LEDs (never fills)" items={LEDS} />
      <Caption className="max-w-prose">
        Oxide means live or committed state only. Category colour appears only
        as block LEDs. Selection inverts ink and paper. Danger ink is for the
        word and icon of a destructive action, never a fill. Night, Sunlight and
        E-paper override these tokens; nothing else changes.
      </Caption>
    </div>
  ),
};

export const StateColours: StoryObj = {
  name: 'State, in words and colour',
  render: () => (
    <div className="grid max-w-xl gap-3">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-brand bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">
          Playing
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">
          Cued
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
          Stale
        </span>
        <span className="rounded-full border border-foreground bg-foreground px-2 py-0.5 text-xs font-medium text-background">
          Selected
        </span>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1 text-sm font-semibold text-danger-ink"
        >
          Delete…
        </button>
      </div>
      <Caption>
        Every state has a word; colour and shape only reinforce it. In E-paper
        all of these are black and white and still read.
      </Caption>
    </div>
  ),
};
