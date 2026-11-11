import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MediaAsset } from '../../api';
import { ReampDialog } from './DiReamps';

afterEach(cleanup);

const di = (channels: number): MediaAsset => ({
  id: '01JD2W8T3N8M4K6V0P7Q9R1S2T',
  title: 'DI take 3',
  kind: 'di',
  schema: 1,
  created_at: '2026-11-11T10:00:00.000Z',
  playback: { trim_db: 0 },
  source: null,
  provenance: { kind: 'record_di' },
  renders: [
    {
      channels,
      file: 'play-48000.f32',
      frames: 48000 * 134,
      rate: 48000,
      sha256: 'y',
    },
  ],
});

it('input processing has no default, and a stereo DI needs a channel', () => {
  const onStart = vi.fn(async () => {});
  render(<ReampDialog asset={di(2)} onClose={() => {}} onStart={onStart} />);
  const start = screen.getByRole('button', { name: 'Start reamp' });
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByLabelText('None (already level-matched)'));
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Right'));
  expect(start).toBeEnabled();
  fireEvent.click(start);
  expect(onStart).toHaveBeenCalledWith({
    source: '01JD2W8T3N8M4K6V0P7Q9R1S2T',
    channel: 1,
    processing: 'none',
    tailSeconds: 2,
    monitoring: false,
  });
});

it('a mono DI only asks for input processing', () => {
  render(
    <ReampDialog asset={di(1)} onClose={() => {}} onStart={async () => {}} />,
  );
  expect(screen.queryByText('Channel')).toBeNull();
  const start = screen.getByRole('button', { name: 'Start reamp' });
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Current input trim and gate'));
  expect(start).toBeEnabled();
  expect(
    screen.getByText(/Runs through the preset and scene playing now/),
  ).toBeTruthy();
});
