import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { NativeDefaults } from './NativeDefaults';
import { nativeDefaults, type NativeDefaults as Defaults } from './api';

vi.mock('./api', () => ({ nativeDefaults: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const saved = (osEnabled: number, osFactor: number): Defaults =>
  ({
    revision: 3,
    settings: {
      nam_size: 1,
      multi_core: false,
      parameters: { osEnabled, osFactor },
    },
  }) as unknown as Defaults;

it('offers Off/2×/4×/8× as one choice and saves only after an explicit Save', async () => {
  vi.mocked(nativeDefaults).mockResolvedValue(saved(1, 1));
  render(<NativeDefaults connected />);
  const choice = await screen.findByRole('combobox', { name: 'Oversampling' });
  expect(choice).toHaveTextContent('8×');
  expect(
    screen.getByRole('button', { name: 'Save device defaults' }),
  ).toBeDisabled();
  await userEvent.click(choice);
  await userEvent.click(await screen.findByRole('option', { name: 'Off' }));
  expect(screen.getByText(/Unsaved changes/)).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Discard changes' }),
  );
  expect(screen.queryByText(/Unsaved changes/)).toBeNull();
  await userEvent.click(choice);
  await userEvent.click(await screen.findByRole('option', { name: '4×' }));
  vi.mocked(nativeDefaults).mockResolvedValue(saved(1, 0.5));
  await userEvent.click(
    screen.getByRole('button', { name: 'Save device defaults' }),
  );
  await waitFor(() =>
    expect(nativeDefaults).toHaveBeenLastCalledWith({
      expected_revision: 3,
      settings: expect.objectContaining({
        parameters: { osEnabled: 1, osFactor: 0.5 },
      }),
    }),
  );
});

it('keeps an unlisted saved factor visible instead of rewriting it', async () => {
  vi.mocked(nativeDefaults).mockResolvedValue(saved(1, 0.25));
  render(<NativeDefaults connected />);
  expect(
    await screen.findByRole('combobox', { name: 'Oversampling' }),
  ).toHaveTextContent('Other (0.25)');
  expect(screen.getByText(/factor this screen does not list/)).toBeVisible();
});
