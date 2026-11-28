import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Eyebrow } from '../components/ui/text';
import {
  EvenOutDemo,
  LevelMatchDemo,
  SoundCheckDemo,
} from './guitar-tools.demo';

/**
 * Levels: the page the main menu opens for loudness. Sound check says what to
 * fix next, Level match sets one preset, Even out all sets every preset and
 * scene to one loudness. It is its own page, not buttons at the bottom of the
 * Rig.
 * @see docs/interface.md
 */
const meta: Meta = {
  title: 'Patterns/Levels page',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function LevelsPage() {
  return (
    <main className="mx-auto grid max-w-3xl gap-6 p-6">
      <header className="grid gap-1">
        <Eyebrow>Levels</Eyebrow>
        <h1 className="m-0 text-xl font-semibold">Keep every sound even</h1>
      </header>
      <section aria-label="Sound check" className="grid gap-2">
        <SoundCheckDemo />
      </section>
      <section aria-label="Level match" className="grid gap-2">
        <LevelMatchDemo />
      </section>
      <div className="grid gap-2">
        <EvenOutDemo />
      </div>
    </main>
  );
}

export const Default: StoryObj = {
  render: () => <LevelsPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Even out 8 new or changed' }),
    );
    await expect(
      await canvas.findByText(
        /8 presets and scenes evened out to -20\.0 LUFS/,
        {},
        { timeout: 4000 },
      ),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Show each sound (8)' }),
    );
    await expect(
      canvas.getByRole('table', { name: 'Measured levels' }),
    ).toBeVisible();
  },
};
