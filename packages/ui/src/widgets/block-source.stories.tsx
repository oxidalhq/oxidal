import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { type BlockSource, SourceCard, SourceLine } from './block-source';
import { SOURCES } from './block-source.data';

/**
 * Where each block comes from: a TONE3000 tone and its creator, your own
 * file, an LV2 plugin and its pack, Oxidal's own code, or an effect inside
 * the TONE3000 engine. The line goes on rows and the docked block panel;
 * the card goes in the block's full editor and Library's About.
 */
const meta: Meta = {
  title: 'Widgets/Block source',
  parameters: { layout: 'padded' },
};
export default meta;

const ALL: BlockSource[] = [
  SOURCES.plexi,
  SOURCES.twin,
  SOURCES.gate,
  SOURCES.bloom,
  SOURCES.hold,
];

/** The one-line form, for rows and the docked panel. */
export const Lines: StoryObj = {
  render: () => (
    <ul className="m-0 grid list-none gap-2 p-0">
      {ALL.map((s) => (
        <li key={s.title} className="grid gap-0.5">
          <span className="text-sm font-semibold">{s.title}</span>
          <SourceLine source={s} />
        </li>
      ))}
    </ul>
  ),
};

/** The full card for each kind of source. */
export const Cards: StoryObj = {
  render: () => (
    <div className="grid gap-3 md:grid-cols-2">
      {ALL.map((s) => (
        <SourceCard key={s.title} source={s} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tone = within(canvas.getByRole('region', { name: 'About Plexi 50' }));
    await expect(
      tone.getByRole('link', { name: /View on TONE3000/ }),
    ).toHaveAttribute('href', 'https://www.tone3000.com/tones/12345');
    await expect(
      tone.getByRole('link', { name: /Jane Capture's profile/ }),
    ).toHaveAttribute('target', '_blank');
    await expect(tone.getByText('CC BY 4.0')).toBeVisible();
    const lv2 = within(canvas.getByRole('region', { name: 'About Gate' }));
    await expect(lv2.getByRole('link', { name: /Calf website/ })).toBeVisible();
    const own = within(canvas.getByRole('region', { name: 'About Bloom' }));
    await expect(own.getByRole('link', { name: /Source code/ })).toBeVisible();
  },
};

/** A link that is not plain https is shown as text, never as a link. */
export const UnsafeLink: StoryObj = {
  name: 'Only https links',
  render: () => (
    <SourceCard
      source={{
        ...SOURCES.plexi,
        page: 'javascript:alert(1)',
        creator: { name: 'Someone', profile: 'http://example.com' },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('link')).toBeNull();
  },
};
