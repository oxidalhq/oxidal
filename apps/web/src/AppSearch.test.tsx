import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { AppSearch } from './AppSearch';
import { setCommands, setPresetChooser } from './commandStore';
import type { PresetChoice } from './presetChoices';

const preset: PresetChoice = {
  kind: 'scenes',
  revision: 'rev-1',
  name: 'Harmonic Tremolo',
  scenes: ['Clean', 'Tremolo'],
  topology: 'scenes',
  nativeInstances: 1,
  lv2Instances: 2,
  origin: 'mine',
  inSetList: true,
};
vi.mock('./presetChoices', async (original) => ({
  ...(await original<typeof import('./presetChoices')>()),
  loadPresetChoices: async () => ({ items: [preset], error: '' }),
}));

afterEach(() => {
  cleanup();
  setCommands('rig-scenes', null);
  setPresetChooser(null);
});

function open() {
  const onNavigate = vi.fn();
  const onTuner = vi.fn();
  render(
    <AppSearch
      open
      onOpenChange={() => undefined}
      onNavigate={onNavigate}
      onTuner={onTuner}
    />,
  );
  return { onNavigate, onTuner };
}

it('always offers the screens and the tuner', async () => {
  const user = userEvent.setup();
  const { onNavigate, onTuner } = open();
  await user.click(screen.getByRole('option', { name: /Library/ }));
  expect(onNavigate).toHaveBeenCalledWith('library');
  cleanup();
  const again = open();
  await user.click(screen.getByRole('option', { name: /Tuner/ }));
  expect(again.onTuner).toHaveBeenCalled();
  expect(onTuner).not.toHaveBeenCalled();
});

it('lists the scenes a screen registers and runs them', async () => {
  const user = userEvent.setup();
  const run = vi.fn();
  act(() =>
    setCommands('rig-scenes', [
      { id: 'scene:2', group: 'Scenes', label: 'Scene 2: Tremolo', run },
    ]),
  );
  open();
  expect(screen.getByRole('group', { name: 'Scenes' })).toBeVisible();
  await user.click(screen.getByRole('option', { name: /Scene 2: Tremolo/ }));
  expect(run).toHaveBeenCalledOnce();
});

it('lists presets and the set list only when a screen can play them, and plays through it', async () => {
  const user = userEvent.setup();
  open();
  expect(screen.queryByRole('group', { name: 'Presets' })).toBeNull();
  cleanup();
  const choose = vi.fn();
  act(() => setPresetChooser(choose));
  open();
  expect(await screen.findByRole('group', { name: 'Set list' })).toBeVisible();
  await user.click(
    (await screen.findAllByRole('option', { name: /Harmonic Tremolo/ }))[0]!,
  );
  expect(choose).toHaveBeenCalledWith(preset);
});
