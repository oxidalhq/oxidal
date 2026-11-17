import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SoundBrowser, type SoundsStatus } from './sound-browser';
import { SOUNDS } from './sound-browser.data';

/**
 * Library › Oxidal sounds, redrawn: a dense list you can scan and try,
 * with the details beside it. Replaces cards that said "Checking…" and
 * "Details" and little else.
 */
const meta: Meta = {
  title: 'Patterns/Oxidal sounds',
  parameters: { layout: 'padded' },
};
export default meta;

const noop = () => {};
const browser = (status: SoundsStatus, sounds = SOUNDS) => (
  <SoundBrowser
    sounds={sounds}
    status={status}
    onTry={noop}
    onSaveCopy={noop}
    onAddToSetList={noop}
    onGetTone={noop}
    onInstallPack={noop}
    onRetry={noop}
  />
);

export const Browse: StoryObj = {
  name: 'Browse and try',
  render: () => browser({ state: 'ready' }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Power Stack/ }));
    await expect(
      canvas.getAllByRole('button', { name: 'Try Power Stack' })[0],
    ).toBeDisabled();
    await userEvent.click(
      canvas.getByRole('switch', { name: 'Ready to play only' }),
    );
    await expect(
      canvas.queryByRole('button', { name: /^Power Stack/ }),
    ).toBeNull();
    await expect(
      canvas.getAllByRole('button', { name: 'Try Cold Steel' })[0],
    ).toBeEnabled();
  },
};

/** While the device checks, one line says so; rows that are known show it. */
export const Checking: StoryObj = {
  name: 'Checking the device',
  render: () =>
    browser(
      { state: 'checking', checked: 3 },
      SOUNDS.map((s, i) =>
        i > 2 ? { ...s, readiness: { state: 'checking' } } : s,
      ),
    ),
};

/** Unreachable: one notice with Try again; browsing still works. */
export const Offline: StoryObj = {
  name: 'Device not reachable',
  render: () =>
    browser(
      { state: 'offline' },
      SOUNDS.map((s) => ({ ...s, readiness: { state: 'checking' } })),
    ),
};
