import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { parseSong } from '../lib/song';
import {
  GLASS_ROOM_MARKDOWN,
  HARBOUR_LIGHTS_CHORDPRO,
  LYRICS_ONLY_TEXT,
  NIGHT_DRIVE_TEXT,
} from '../screens/songs.fixtures';
import { SheetViewer } from './sheet-viewer';

/**
 * Lyrics and chord sheets in each format the songbook reads. A− and A+
 * step the size, the play button scrolls, a tap on the words pauses it.
 */
const meta: Meta = {
  title: 'Widgets/Chord sheet',
  parameters: { layout: 'padded' },
};
export default meta;

function Viewer({
  source,
  format,
}: {
  source: string;
  format: 'chordpro' | 'markdown' | 'text';
}) {
  const [size, setSize] = useState(3);
  const [speed, setSpeed] = useState(4);
  return (
    <SheetViewer
      song={parseSong(source, format)}
      size={size}
      onSize={setSize}
      speed={speed}
      onSpeed={setSpeed}
      linked={['Set list · 1 · Rhythm section']}
      className="h-[36rem] max-w-3xl"
    />
  );
}

export const ChordPro: StoryObj = {
  render: () => <Viewer source={HARBOUR_LIGHTS_CHORDPRO} format="chordpro" />,
};
export const TextChordsOverWords: StoryObj = {
  name: 'Text, chords over words',
  render: () => <Viewer source={NIGHT_DRIVE_TEXT} format="text" />,
};
export const Markdown: StoryObj = {
  render: () => <Viewer source={GLASS_ROOM_MARKDOWN} format="markdown" />,
};
export const LyricsOnly: StoryObj = {
  name: 'Lyrics only',
  render: () => <Viewer source={LYRICS_ONLY_TEXT} format="text" />,
};

ChordPro.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Bigger text' }));
  await expect(canvas.getByText('150%')).toBeVisible();
  await userEvent.click(canvas.getByRole('button', { name: 'Chords' }));
  await expect(canvasElement.querySelectorAll('[data-chord]')).toHaveLength(0);
};
