import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Title } from '../components/ui/text';
import { SceneEditor } from './scene-editor';
import { FOUR_JOBS, FOUR_SCENES } from './scene-editor.fixtures';

/**
 * Edit what each scene plays: blocks on or off, branches on or off with
 * their level, and copies of a block with other settings.
 */
const meta: Meta = {
  title: 'Widgets/Scene editor',
  parameters: { layout: 'padded' },
};
export default meta;

function Demo() {
  const [route, setRoute] = useState(FOUR_JOBS);
  const [scenes, setScenes] = useState(FOUR_SCENES);
  const [active, setActive] = useState<string | null>('verse');
  return (
    <div className="grid gap-3">
      <Title size="sm">Worship rig · scenes</Title>
      <SceneEditor
        route={route}
        onRoute={setRoute}
        scenes={scenes}
        onScenes={setScenes}
        active={active}
        onSelect={setActive}
      />
    </div>
  );
}

/**
 * Four branches with a job each (Rhythm, Lead, Swells, Wet) and four
 * scenes. Chorus also sets two of the TS9's values ("2 set").
 */
export const FourBranchesFourScenes: StoryObj = {
  name: 'Four branches, four scenes',
  render: () => <Demo />,
};

/** Bring Lead in under Verse, then duplicate the TS9 and use the copy only in Chorus. */
export const DuplicateAPedal: StoryObj = {
  name: 'Duplicate a pedal for one scene',
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    const lead = canvas.getByRole('switch', { name: 'Lead branch in Verse' });
    await expect(lead).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(lead);
    await expect(lead).toHaveAttribute('aria-checked', 'true');
    await expect(
      canvas.getByRole('button', { name: /^0 dB · Lead level in Verse/ }),
    ).toBeVisible();

    await userEvent.click(
      canvas.getByRole('button', { name: 'More for TS9 tight' }),
    );
    await userEvent.click(
      await page.findByRole('menuitem', {
        name: 'Duplicate with its settings',
      }),
    );
    const copy = await canvas.findByRole('switch', {
      name: 'TS9 tight (2) in Chorus',
    });
    await expect(copy).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(copy);
    await expect(copy).toHaveAttribute('aria-checked', 'true');
    await expect(
      canvas.getByRole('switch', { name: 'TS9 tight (2) in Verse' }),
    ).toHaveAttribute('aria-checked', 'false');
  },
};
