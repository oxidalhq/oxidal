import { Play } from '@phosphor-icons/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, Led } from './badge';
import { Caption } from './text';

/**
 * One badge, four tones. Neutral states a fact (category, count); live is
 * what plays or is committed; warning is stale or unsaved; selected is the
 * chosen one. Text is small caps so it reads as a label, never a button.
 */
const meta: Meta<typeof Badge> = {
  title: 'Components/Badge and LED',
  component: Badge,
  parameters: { layout: 'padded' },
};
export default meta;

export const Tones: StoryObj = {
  render: () => (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Amp</Badge>
        <Badge>6 stems</Badge>
        <Badge tone="live">
          <Play weight="fill" /> Playing
        </Badge>
        <Badge tone="live">Cued</Badge>
        <Badge tone="warning">Unsaved</Badge>
        <Badge tone="warning">Stale</Badge>
        <Badge tone="selected">Scene 2</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge size="sm">Amp</Badge>
        <Badge size="sm" tone="live">
          Live
        </Badge>
        <Badge size="sm" tone="warning">
          Protect
        </Badge>
      </div>
      <Caption>
        Replaces media-chip, oxidal-chip, stem-chips and StateChip from the
        current product.
      </Caption>
    </div>
  ),
};

export const Leds: StoryObj = {
  name: 'LEDs',
  render: () => (
    <div className="grid gap-2">
      {(['amp', 'cab', 'pedal', 'time', 'mod', 'lv2'] as const).map((kind) => (
        <div key={kind} className="flex items-center gap-3">
          <Led kind={kind} />
          <Led kind={kind} on={false} />
          <span className="small-caps text-sm">{kind}</span>
        </div>
      ))}
      <Caption>
        Colour is the category, the word is the meaning; off is an outline. In
        E-paper every LED is black.
      </Caption>
    </div>
  ),
};
