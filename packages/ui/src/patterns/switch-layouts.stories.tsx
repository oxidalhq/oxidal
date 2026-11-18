import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { CONTROLLERS } from '../widgets/controllers';
import { SwitchLayouts } from './switch-layouts';
import { LAYOUT_LISTS } from './switch-layouts.data';

/**
 * What each footswitch does in Stomp, Scenes and Presets mode, with tap
 * tempo note values and freeze on any switch.
 */
const meta: Meta = {
  title: 'Patterns/Switch layouts',
  parameters: { layout: 'padded' },
};
export default meta;

/** The original M-Vave Chocolate: four switches reach all three modes. */
export const FourSwitches: StoryObj = {
  name: 'Four switches',
  render: () => <SwitchLayouts profile={CONTROLLERS[0]!} {...LAYOUT_LISTS} />,
};

/** MIDI Captain STD 10: room for scenes, stomps and a bank switch. */
export const TenSwitches: StoryObj = {
  name: 'Ten switches',
  render: () => <SwitchLayouts profile={CONTROLLERS[1]!} {...LAYOUT_LISTS} />,
};

/** Tap on dotted eighths, and hold B to freeze Bloom until pressed again. */
export const TapAndFreeze: StoryObj = {
  name: 'Tap tempo and freeze',
  render: () => <SwitchLayouts profile={CONTROLLERS[0]!} {...LAYOUT_LISTS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('radio', { name: /^D/ }));
    await userEvent.click(
      canvas.getByRole('radio', { name: '♪. dotted eighth' }),
    );
    await expect(
      canvas.getByRole('radio', { name: /^D Tap ♪\./ }),
    ).toBeVisible();

    await userEvent.click(canvas.getByRole('radio', { name: /^B/ }));
    await userEvent.click(
      canvas.getByRole('combobox', { name: 'Hold switch B' }),
    );
    await userEvent.click(
      await page.findByRole('option', { name: 'Freeze Bloom' }),
    );
    await userEvent.click(
      canvas.getByRole('radio', { name: 'Until pressed again' }),
    );
    await expect(
      canvas.getByRole('radio', { name: /^B .*Hold: Freeze Bloom/ }),
    ).toBeVisible();

    await userEvent.click(canvas.getByRole('radio', { name: 'Presets' }));
    await expect(
      canvas.getByRole('radio', { name: /^A Rhythm section/ }),
    ).toBeVisible();
  },
};
