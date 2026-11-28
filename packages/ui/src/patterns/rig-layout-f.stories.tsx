import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  ComposeSongSample,
  PerformSongSample,
  SongPracticeSample,
  TryPresetsSample,
} from './rig-song';

/**
 * A song is a list of sections, each linked to a preset and a scene, with the chord sheet as the page you play from. Practice, try presets without committing, perform, and compose. Design samples with fixed example data; nothing is saved.
 */
const meta: Meta = {
  title: 'Rig layouts/Layout F - Song workspace',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

/** Chain in the middle, sections and chord sheet below, controls in a bottom sheet. Tap a section to switch its rig. */
export const Practice: Story = { render: () => <SongPracticeSample /> };

/** Try other presets on a section. Nothing is saved until you keep it; Revert goes back. */
export const TryPresets: Story = { render: () => <TryPresetsSample /> };

/** Big chord sheet, big scene pads, next section ready, Back and Next section buttons. */
export const Perform: Story = { render: () => <PerformSongSample /> };

/** Type the sheet, see it rendered, link a rig to each section. */
export const Compose: Story = { render: () => <ComposeSongSample /> };
