import type { Meta, StoryObj } from '@storybook/react-vite';
import { Library } from './library';
import { Rig } from './rig';
import { Screen } from './shell';
import { Perform } from './perform';

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
