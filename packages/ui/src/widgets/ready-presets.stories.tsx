import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { type ReadyPreset, ReadyPresets } from './ready-presets';

/**
 * Loaded presets on the chain bar: the device keeps these in memory so a
 * switch is instant, with no audio restart. The list says which one you
 * hear, which is still finishing a tail and which sleep.
 */
const meta: Meta = {
  title: 'Widgets/Loaded presets',
  parameters: { layout: 'centered' },
};
export default meta;

const START: ReadyPreset[] = [
  { id: 'a', name: 'Bogner Fullstack + Octave', state: 'playing' },
  { id: 'b', name: 'Reference · Stereo effects', state: 'processing' },
  { id: 'c', name: 'Dumble Spread + Hold', state: 'sleeping' },
  {
    id: 'd',
    name: 'Matchless Crunch + Hold',
    state: 'sleeping',
    note: 'Modified',
  },
];

function Demo() {
  const [presets, setPresets] = useState(START);
  return (
    <ReadyPresets
      presets={presets}
      onSwitch={(id) =>
        setPresets((all) =>
          all.map((p) => ({
            ...p,
            state:
              p.id === id
                ? 'playing'
                : p.state === 'playing'
                  ? 'processing'
                  : p.state,
          })),
        )
      }
    />
  );
}

export const OnTheBar: StoryObj = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: /4 loaded/ }));
    const list = within(
      await page.findByRole('dialog', { name: 'Loaded presets' }),
    );
    await expect(
      list.getByRole('button', { name: /Bogner Fullstack \+ Octave/ }),
    ).toBeDisabled();
    await userEvent.click(
      list.getByRole('button', { name: /Dumble Spread \+ Hold/ }),
    );
    await expect(
      list.getByRole('button', { name: /Dumble Spread \+ Hold/ }),
    ).toHaveAttribute('aria-current', 'true');
  },
};
