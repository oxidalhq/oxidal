import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { unitLevels } from './api';
import { formatLevel, levelToPosition, positionToLevel } from './levelTaper';
vi.unmock('./MasterLevel');
vi.mock('./api', () => ({ unitLevels: vi.fn() }));
const { MasterLevel } = await import('./MasterLevel');

afterEach(() => {
  cleanup();
  vi.mocked(unitLevels).mockReset();
});

it('maps the fader so the playing range gets most of the travel', () => {
  expect(levelToPosition(-60)).toBe(0);
  expect(levelToPosition(-30)).toBe(0.25);
  expect(levelToPosition(12)).toBe(1);
  expect(positionToLevel(levelToPosition(0))).toBe(0);
  expect(positionToLevel(levelToPosition(-6.5))).toBe(-6.5);
  expect(formatLevel(-60)).toBe('Off');
  expect(formatLevel(3)).toBe('+3.0 dB');
  expect(formatLevel(-6)).toBe('−6.0 dB');
});

it('shows the unit level and sends only the newest value while one is in flight', async () => {
  let release: () => void = () => {};
  vi.mocked(unitLevels).mockImplementation(async (update) => {
    if (!update) return { input_trim_db: 0, output_level_db: -6 };
    if (update.output_level_db === -5)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return update;
  });
  render(<MasterLevel />);
  const fader = await screen.findByRole('slider', { name: 'Level' });
  await act(async () => {});
  expect(screen.getByText('−6.0 dB')).toBeVisible();
  fireEvent.keyDown(fader, { key: 'ArrowUp' });
  fireEvent.keyDown(fader, { key: 'ArrowUp' });
  fireEvent.keyDown(fader, { key: 'ArrowUp' });
  expect(screen.getByText('−3.0 dB')).toBeVisible();
  await act(async () => release());
  const sent = vi
    .mocked(unitLevels)
    .mock.calls.map(([update]) => update?.output_level_db)
    .filter((v) => v != null);
  expect(sent).toEqual([-5, -3]);
});

it('hides itself on a daemon without unit levels', async () => {
  vi.mocked(unitLevels).mockResolvedValue(null);
  const view = render(<MasterLevel />);
  await act(async () => {});
  expect(view.container).toBeEmptyDOMElement();
});
