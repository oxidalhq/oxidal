import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { ChangeScope, type ChangeScopeValue } from './change-scope';

/** Where a change goes: the whole preset, or the scene playing now. */
const meta: Meta = {
  title: 'Widgets/Change scope',
  parameters: { layout: 'padded' },
};
export default meta;

function Demo() {
  const [scope, setScope] = React.useState<ChangeScopeValue>('preset');
  return (
    <ChangeScope
      scope={scope}
      sceneName="Chorus"
      sceneColour="var(--scene-2, #2f7d6b)"
      onScope={setScope}
      onEditScenes={() => {}}
    />
  );
}

export const WholePresetOrOneScene: StoryObj = {
  name: 'Whole preset or one scene',
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole('button', { name: /^Changes: whole preset/ }),
    );
    await userEvent.click(
      await page.findByRole('radio', { name: 'This scene' }),
    );
    await expect(
      await canvas.findByRole('button', { name: /^Changes: Chorus only/ }),
    ).toBeVisible();
  },
};
