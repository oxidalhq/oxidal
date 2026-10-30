import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScenePads } from './ScenePads';

afterEach(cleanup);
const scenes = [
  { id: 'a', name: 'Clean' },
  { id: 'b', name: 'Crunch' },
  { id: 'c', name: 'Lead' },
];

it('selects scenes by pad and by number key, never the one already sounding', () => {
  const onSelect = vi.fn();
  render(
    <ScenePads
      scenes={scenes}
      active="a"
      fading={false}
      disabled={false}
      onSelect={onSelect}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Scene 1: Clean' }),
  ).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Scene 3: Lead' }));
  expect(onSelect).toHaveBeenLastCalledWith('c');
  fireEvent.keyDown(window, { key: '2' });
  expect(onSelect).toHaveBeenLastCalledWith('b');
  onSelect.mockClear();
  fireEvent.keyDown(window, { key: '1' });
  fireEvent.keyDown(window, { key: '7' });
  fireEvent.keyDown(window, { key: '2', ctrlKey: true });
  expect(onSelect).not.toHaveBeenCalled();
});

it('ignores number keys while typing or while disabled', () => {
  const onSelect = vi.fn();
  const view = render(
    <>
      <input aria-label="Name" />
      <ScenePads
        scenes={scenes}
        active="a"
        fading
        disabled={false}
        onSelect={onSelect}
      />
    </>,
  );
  fireEvent.keyDown(screen.getByLabelText('Name'), { key: '2' });
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByText('fading…')).toBeVisible();
  view.rerender(
    <ScenePads
      scenes={scenes}
      active="a"
      fading={false}
      disabled
      onSelect={onSelect}
    />,
  );
  fireEvent.keyDown(window, { key: '2' });
  expect(onSelect).not.toHaveBeenCalled();
});
