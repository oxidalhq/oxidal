import type { Meta, StoryObj } from '@storybook/react-vite';

import { type GlyphKey, glyphs } from '../lib/block-glyphs';
import { BlockGlyph } from '../widgets/block-glyph';

/**
 * Oxidal's block glyphs: objects for captured gear (amp head, combo, cab,
 * IR, pedal, rack), signal shapes for processing (drive, dynamics, EQ,
 * modulation, time, pitch) and tools. A capture keeps its gear object; an
 * effect is matched by its name; anything unknown is the generic plugin.
 */
const meta: Meta = {
  title: 'Foundations/Block glyphs',
  parameters: { layout: 'padded' },
};
export default meta;

export const All: StoryObj = {
  render: () => (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 p-0">
      {(Object.keys(glyphs) as GlyphKey[]).map((key) => (
        <li
          key={key}
          className="grid justify-items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-3 text-center"
        >
          <BlockGlyph glyph={key} className="size-8" />
          <span className="text-xs">{glyphs[key].label}</span>
          <code className="text-2xs text-muted-foreground">{key}</code>
        </li>
      ))}
    </ul>
  ),
};
