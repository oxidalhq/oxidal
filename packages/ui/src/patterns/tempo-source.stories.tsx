import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../components/ui/button';
import { type PerformanceTempo, TempoSource } from './tempo-source';

export default {
  title: 'Patterns/Performance tempo',
  parameters: { layout: 'padded' },
} satisfies Meta;
function Performance() {
  const [playing, setPlaying] = useState(true);
  const [scene, setScene] = useState('Verse');
  const [tempo, setTempo] = useState<PerformanceTempo>({
    source: 'song',
    bpm: 96,
  });
  return (
    <>
      <p>
        {playing ? 'Track playing' : 'Track stopped'} · {scene}
      </p>
      <TempoSource
        state={tempo}
        onSelect={(source) =>
          setTempo(
            source === 'song' && !playing
              ? { source, reason: 'No track playing' }
              : { source, bpm: { song: 96, tap: 110, preset: 124 }[source] },
          )
        }
      />
      <Button onClick={() => setScene('Chorus')}>Recall Chorus</Button>
      <Button
        disabled={!playing}
        onClick={() => {
          setPlaying(false);
          if (tempo.source === 'song') setTempo({ source: 'preset', bpm: 124 });
        }}
      >
        Stop track
      </Button>
    </>
  );
}
export const Stage: StoryObj = {
  render: () => <Performance />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Tap tempo' }));
    await userEvent.click(c.getByRole('button', { name: 'Recall Chorus' }));
    await userEvent.click(c.getByRole('button', { name: 'Stop track' }));
    await expect(c.getByText('Track stopped · Chorus')).toBeVisible();
    await expect(c.getByText(/110 BPM/)).toBeVisible();
  },
};
export const Player: StoryObj = {
  render: () => <Performance />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Stop track' }));
    await expect(c.getByText(/124 BPM/)).toBeVisible();
    await expect(c.getByRole('button', { name: 'Preset' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};
