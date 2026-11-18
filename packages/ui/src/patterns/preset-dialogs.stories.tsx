import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../components/ui/button';
import { Caption } from '../components/ui/text';
import { RouteView } from '../widgets/route-view';
import {
  DeletePresetDialog,
  NewPresetDialog,
  OfflineBanner,
  PresetDetails,
} from './preset-dialogs';
import { BROWN_CRUNCH } from './preset-dialogs.data';
import { SERIAL_ROUTE } from './rig.fixtures';

/**
 * Library presets: make a new one, open its details, edit it without
 * playing, and delete it with its set lists named first.
 */
const meta: Meta = {
  title: 'Patterns/Presets',
  parameters: { layout: 'padded' },
};
export default meta;

function Flow() {
  const [dialog, setDialog] = useState<'new' | 'details' | 'delete' | null>(
    null,
  );
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog('new')}>New preset…</Button>
        <Button variant="outline" onClick={() => setDialog('details')}>
          Brown Crunch details
        </Button>
      </div>
      <Caption role="status">{note || 'Nothing yet.'}</Caption>
      {offline && (
        <>
          <OfflineBanner
            name="Brown Crunch"
            onSave={() => (setOffline(false), setNote('Saved Brown Crunch'))}
            onClose={() => setOffline(false)}
          />
          <RouteView
            route={SERIAL_ROUTE}
            onChange={() => {}}
            onSelect={() => {}}
            selected={null}
          />
        </>
      )}
      <NewPresetDialog
        playing="Rhythm section"
        open={dialog === 'new'}
        onOpenChange={(o) => setDialog(o ? 'new' : null)}
        onCreate={(name, from) => setNote(`Created ${name} from ${from}`)}
      />
      <PresetDetails
        preset={BROWN_CRUNCH}
        onDuplicate={() => setNote('Duplicated')}
        onExport={() => setNote('Exported')}
        open={dialog === 'details'}
        onOpenChange={(o) => setDialog(o ? 'details' : null)}
        onDelete={() => setDialog('delete')}
        onEditOffline={() => (setDialog(null), setOffline(true))}
      />
      <DeletePresetDialog
        name={BROWN_CRUNCH.name}
        usedIn={BROWN_CRUNCH.usedIn}
        open={dialog === 'delete'}
        onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        onDelete={() => (setDialog(null), setNote('Deleted Brown Crunch'))}
      />
    </div>
  );
}

export const NewDetailsDelete: StoryObj = {
  name: 'New, details, edit without playing, delete',
  render: () => <Flow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'New preset…' }));
    await userEvent.type(
      await page.findByRole('textbox', { name: 'Name' }),
      'Friday opener',
    );
    await userEvent.click(
      page.getByRole('radio', { name: /^An Oxidal sound/ }),
    );
    await userEvent.click(page.getByRole('button', { name: 'Create preset' }));
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Created Friday opener from oxidal',
    );
    await userEvent.click(
      canvas.getByRole('button', { name: 'Brown Crunch details' }),
    );
    await userEvent.click(
      await page.findByRole('button', { name: 'Edit without playing' }),
    );
    await expect(
      await canvas.findByText('Editing Brown Crunch without playing'),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
    await userEvent.click(
      canvas.getByRole('button', { name: 'Brown Crunch details' }),
    );
    await userEvent.click(await page.findByRole('button', { name: 'Delete…' }));
    const remove = await page.findByRole('button', { name: 'Delete preset' });
    await expect(remove).toBeDisabled();
    await userEvent.click(page.getByRole('checkbox'));
    await userEvent.click(remove);
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Deleted Brown Crunch',
    );
  },
};
