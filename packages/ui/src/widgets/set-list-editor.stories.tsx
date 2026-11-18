import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SetListEditor, type SetListEntry } from './set-list-editor';
import {
  FRIDAY_ENTRIES,
  SET_PRESETS,
  SET_SHEETS,
  SET_TRACKS,
} from './set-list.data';

/**
 * The set list in one place: add presets (several at once), drag them into
 * order, tap a song to choose its version, starting scene, backing track and
 * chord sheet, then Play this set.
 */
const meta: Meta = {
  title: 'Widgets/Set list editor',
  parameters: { layout: 'padded' },
};
export default meta;

function Editor({ initial }: { initial: SetListEntry[] }) {
  const [entries, setEntries] = useState(initial);
  return (
    <SetListEditor
      name="Friday set"
      entries={entries}
      onChange={setEntries}
      presets={SET_PRESETS}
      tracks={SET_TRACKS}
      sheets={SET_SHEETS}
      onPlay={() => {}}
      className="max-w-2xl"
    />
  );
}

export const FridaySet: StoryObj = {
  name: 'A set of four songs',
  render: () => <Editor initial={FRIDAY_ENTRIES} />,
};
export const Empty: StoryObj = {
  name: 'A new, empty set',
  render: () => <Editor initial={[]} />,
};

/** Reorder with the keyboard, set a song's version and scene, add two presets, remove one. */
FridaySet.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  const order = () =>
    [
      ...canvasElement.querySelectorAll('ol[aria-label="Songs in order"] > li'),
    ].map(
      (li) => li.querySelector('.text-md.font-semibold.truncate')?.textContent,
    );
  canvas.getByRole('button', { name: /^Move Lead boost/ }).focus();
  await userEvent.keyboard('{ArrowUp}');
  await expect(order()).toEqual([
    'Rhythm section',
    'Lead boost',
    'Ambient swell',
    'Brown Crunch',
  ]);
  await userEvent.click(
    canvas.getByRole('button', { name: /^Lead boost starts on Rhythm/ }),
  );
  const sheet = await page.findByRole('dialog', { name: '2 · Lead boost' });
  await userEvent.click(
    within(sheet).getByRole('radio', { name: 'Rehearsal room' }),
  );
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Lead' }));
  await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
  await expect(
    await canvas.findByText(/Rehearsal room version · starts on Lead/),
  ).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: 'Add presets' }));
  const add = await page.findByRole('dialog', { name: 'Add to Friday set' });
  await userEvent.click(
    within(add).getByRole('checkbox', { name: /Neon Clean/ }),
  );
  await userEvent.click(
    within(add).getByRole('checkbox', { name: /Cold Cathedral/ }),
  );
  await userEvent.click(
    within(add).getByRole('button', { name: 'Add 2 to the set' }),
  );
  await expect(order()).toEqual([
    'Rhythm section',
    'Lead boost',
    'Ambient swell',
    'Brown Crunch',
    'Neon Clean',
    'Cold Cathedral',
  ]);
  await userEvent.click(
    canvas.getByRole('button', { name: 'Edit Ambient swell' }),
  );
  await userEvent.click(
    await page.findByRole('button', { name: 'Remove from set' }),
  );
  await expect(order()).toEqual([
    'Rhythm section',
    'Lead boost',
    'Brown Crunch',
    'Neon Clean',
    'Cold Cathedral',
  ]);
};
