import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Card } from '../components/ui/card';
import {
  PluginPanel,
  type PluginControl,
  type PluginView,
} from './plugin-panel';
import {
  BARE_CONTROLS,
  BARE_PLUGIN,
  CONTROLS,
  PLUGIN,
} from './plugin-panel.data';

/**
 * How any LV2 plugin is presented: picture, name, maker and purpose at the
 * top, the controls that matter most as large fields, the rest in the
 * plugin's own groups. The second story is the same plugin with only what
 * the device reports today.
 */
const meta: Meta = {
  title: 'Patterns/LV2 plugin panel',
  parameters: { layout: 'padded' },
};
export default meta;

function Demo({
  plugin,
  initial,
}: {
  plugin: PluginView;
  initial: PluginControl[];
}) {
  const [controls, setControls] = useState(initial);
  const [on, setOn] = useState(true);
  return (
    <Card className="mx-auto max-w-2xl">
      <PluginPanel
        plugin={plugin}
        controls={controls}
        on={on}
        onToggle={setOn}
        onControl={(symbol, value) =>
          setControls((all) =>
            all.map((c) => (c.symbol === symbol ? { ...c, value } : c)),
          )
        }
      />
    </Card>
  );
}

export const Described: StoryObj = {
  name: 'A plugin that describes itself well',
  render: () => <Demo plugin={PLUGIN} initial={CONTROLS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('switch', { name: 'Follow the tempo' }),
    );
    await expect(
      canvas.getByText(/1 changed from the plugin's own settings/),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Reset all' }));
    await expect(
      canvas.getByText(/all at the plugin's own settings/),
    ).toBeVisible();
  },
};

/** Symbols and ranges only: every control still shows, labelled from its symbol. */
export const Bare: StoryObj = {
  name: 'With only what the device reports today',
  render: () => <Demo plugin={BARE_PLUGIN} initial={BARE_CONTROLS} />,
};
