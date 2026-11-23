import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { downloadVoice } from '../../api';
import type { Route } from '../../rigRoute';
import { RigChainSurfaceChooser } from './RigChainSurfaceChooser';
import type { RigViewProps } from './useMixedRigSession';

vi.mock('../../api', () => ({ downloadVoice: vi.fn() }));
vi.mock('../../SlotChooser', () => ({
  SlotChooser: ({ onModel }: { onModel: (kind: string) => void }) => (
    <button onClick={() => onModel('nam')}>Add NAM</button>
  ),
}));
let selectTone: (tone: number, model: number, name: string) => Promise<string>;
vi.mock('../../ModelPicker', () => ({
  ModelPicker: ({ onTone }: { onTone: typeof selectTone }) => {
    selectTone = onTone;
    return <p>Choose TONE3000</p>;
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('downloads the chosen capture and inserts its saved source at the requested point', async () => {
  const source = {
    preset: { sha256: 'a'.repeat(64), name: 'Capture', size_bytes: 123 },
    source: { kind: 'owned', preset: 'copy' },
  };
  vi.mocked(downloadVoice).mockResolvedValue({
    capture: { tone_id: 10, model_id: 20, source },
    downloaded: true,
  } as never);
  const state = {
    session: 'session',
    configured: { revision: 'r', stream: { input: { sample_rate: 48000 } } },
  };
  const editChain = vi.fn();
  const current = { current: state };
  render(
    <RigChainSurfaceChooser
      {...({
        rig: {
          canvasChoice: { kind: 'add', at: { split: null, path: 0, index: 0 } },
          editChain,
          setCanvasChoice: vi.fn(),
          current,
        },
        vm: { state, fullRoute: [] },
      } as unknown as RigViewProps)}
    />,
  );
  fireEvent.click(screen.getByText('Add NAM'));
  await selectTone(10, 20, 'Capture');
  expect(downloadVoice).toHaveBeenCalledWith(10, 20, 'Capture');
  await waitFor(() => expect(editChain).toHaveBeenCalledOnce());
  const change = editChain.mock.calls[0]![0] as (route: Route) => Route;
  expect(change([])[0]).toMatchObject({
    kind: 'native',
    preset: source.preset,
    source: source.source,
  });
});

it('refuses to insert into a different rig after the download', async () => {
  const state = {
    session: 'before',
    configured: { revision: 'r', stream: { input: { sample_rate: 48000 } } },
  };
  const editChain = vi.fn();
  vi.mocked(downloadVoice).mockResolvedValue({} as never);
  render(
    <RigChainSurfaceChooser
      {...({
        rig: {
          canvasChoice: { kind: 'add', at: { split: null, path: 0, index: 0 } },
          editChain,
          setCanvasChoice: vi.fn(),
          current: { current: { ...state, session: 'after' } },
        },
        vm: { state, fullRoute: [] },
      } as unknown as RigViewProps)}
    />,
  );
  fireEvent.click(screen.getByText('Add NAM'));
  await expect(selectTone(10, 20, 'Capture')).rejects.toThrow(
    'The playing rig changed',
  );
  expect(editChain).not.toHaveBeenCalled();
});
