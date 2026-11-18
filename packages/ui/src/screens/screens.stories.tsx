import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Library } from './library';
import { Perform } from './perform';
import { Rig } from './rig';
import { Screen } from './shell';

/**
 * Every product screen rebuilt on the system with fixture data, inside the
 * app shell. Switch the viewport to iPhone 16 and the display mode to see
 * each on stage. The coverage table is in Guide › Screens.
 */
const meta: Meta = {
  title: 'Screens/Rig, Stage, Library',
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const RigPlaying: StoryObj = {
  name: 'Rig · playing',
  render: () => (
    <Screen destination="rig">
      <Rig />
    </Screen>
  ),
};

export const RigDetailedStatus: StoryObj = {
  name: 'Rig · detailed status strip',
  render: () => (
    <Screen destination="rig" status="detailed">
      <Rig />
    </Screen>
  ),
};

export const RigNoAudio: StoryObj = {
  name: 'Rig · audio unavailable',
  render: () => (
    <Screen destination="rig" playing={null}>
      <Rig audio={false} />
    </Screen>
  ),
};

export const StagePerform: StoryObj = {
  name: 'Stage · 4-switch controller',
  render: () => (
    <Screen destination="rig">
      <Perform />
    </Screen>
  ),
};

export const StageTenSwitches: StoryObj = {
  name: 'Stage · 10-switch controller',
  render: () => (
    <Screen destination="rig">
      <Perform controller="ten" />
    </Screen>
  ),
};

const libraryStory = (section: string, name: string): StoryObj => ({
  name: `Library · ${name}`,
  render: () => (
    <Screen destination="library">
      <Library section={section} />
    </Screen>
  ),
});

export const LibraryMine = libraryStory('mine', 'Mine');

/** Sort by name, star a preset, then show only favourites (R-6). */
LibraryMine.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole('button', { name: /Recently used/ }));
  await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Name' }));
  const stars = () => canvas.getAllByRole('button', { name: /^Favourite / });
  const names = stars().map((b) => b.getAttribute('aria-label') ?? '');
  await expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  const plain = stars().find((b) => b.getAttribute('aria-pressed') === 'false');
  if (!plain) throw new Error('Expected a preset that is not a favourite');
  const label = plain.getAttribute('aria-label')!;
  await userEvent.click(plain);
  await userEvent.click(canvas.getByRole('button', { name: /Favourites/ }));
  await expect(canvas.getByRole('button', { name: label })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const star of stars())
    await expect(star).toHaveAttribute('aria-pressed', 'true');
};
export const LibraryOxidal = libraryStory('oxidal', 'Oxidal sounds');
export const LibraryTone3000 = libraryStory('tone3000', 'TONE3000');
export const LibrarySetList = libraryStory('setlist', 'Set list');
export const LibrarySongbook = libraryStory('songbook', 'Songbook');
export const LibraryTones = libraryStory('tones', 'Tones and IRs');
export const LibraryBacking = libraryStory('backing', 'Backing tracks');
export const LibraryStems = libraryStory('stems', 'Stems');
export const LibraryDi = libraryStory('di', 'DI and reamps');

export const StageSheet: StoryObj = {
  name: "Stage · with the song's chord sheet",
  render: () => (
    <Screen destination="rig">
      <Perform sheet />
    </Screen>
  ),
};

StagePerform.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: /^B Crunch/ }));
  await expect(await canvas.findByText(/Scene · Crunch/)).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /^D Next/ }));
  await expect(
    await canvas.findByRole('heading', { level: 1, name: 'Ambient swell' }),
  ).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: /Set list:/ }));
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    await page.findByRole('button', { name: /^4 · Brown Crunch/ }),
  );
  await expect(
    await canvas.findByRole('heading', { level: 1, name: 'Brown Crunch' }),
  ).toBeVisible();
};

LibraryMine.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(
    canvas.getByRole('searchbox', { name: 'Search' }),
    'lead',
  );
  await expect(
    canvas.getByRole('button', { name: /^Lead boost/ }),
  ).toBeVisible();
  await expect(
    canvas.queryByRole('button', { name: /^Ambient swell/ }),
  ).toBeNull();
};
