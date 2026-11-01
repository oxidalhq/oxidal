import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rigAudioState, rigLibrary } from './api';
import { SavedRigs } from './SavedRigs';

vi.mock('./api', () => ({
  rigAudioState: vi.fn(),
  rigLibrary: vi.fn(),
}));

const revisions = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(64));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(rigAudioState).mockResolvedValue({ phase: 'stopped' } as never);
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: revisions.map((revision, index) => ({
      revision,
      name: `Factory ${index + 1}`,
      origin: 'oxidal_example',
      scenes: ['Clean', 'Lead'],
      topology: 'scenes',
      native_instances: 1,
      lv2_instances: 1,
    })),
    next: null,
  } as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

it('offers a bounded custom gapless bank for factory rigs', async () => {
  render(
    <SavedRigs
      connected
      onOpenRig={() => {}}
      origin="oxidal_example"
      title="Oxidal examples"
    />,
  );
  await waitFor(() => expect(screen.getByText('Factory 1')).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: 'Keep ready' }));
  expect(screen.getByText(/Choose up to 4 additional rigs/)).toBeVisible();
  for (let index = 1; index <= 4; index += 1) {
    fireEvent.click(screen.getByLabelText(`Keep Factory ${index} ready`));
  }
  expect(screen.getByLabelText('Keep Factory 5 ready')).toBeDisabled();
  expect(
    JSON.parse(localStorage.getItem('oxidal.prepared-rigs') ?? '[]'),
  ).toEqual(revisions.slice(0, 4));
});
