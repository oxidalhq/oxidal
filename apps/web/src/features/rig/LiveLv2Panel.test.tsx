import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { blockSettings, installedLv2, type Lv2Plugin } from '../../api';
import catalog from '../../fixtures/factory-lv2.json';
import { LiveLv2Panel } from './LiveLv2Panel';
import type { RigViewProps } from './useMixedRigSession';

vi.mock('../../api', () => ({
  installedLv2: vi.fn(),
  blockSettings: vi.fn(),
  effectPacks: vi.fn().mockResolvedValue({ packs: [] }),
}));
afterEach(cleanup);

it('sends one checked batch to the running node and reports a refused recall without changing the controls', async () => {
  const plugin = (catalog as Lv2Plugin[]).find(
    (p) => p.uri === 'urn:oxidal:plugin:moment#stereo',
  )!;
  vi.mocked(installedLv2).mockResolvedValue([plugin]);
  const ports = plugin.ports.filter((p) => p.input && p.control);
  const controls = Object.fromEntries(ports.map((p) => [p.symbol, p.default!]));
  const saved = { ...controls, length: 7, mix: 0 };
  vi.mocked(blockSettings).mockResolvedValue({
    revision: 1,
    entries: [
      {
        plugin: plugin.uri,
        id: 'a'.repeat(32),
        name: 'Dry break',
        controls: saved,
      },
    ],
  });
  const command = vi
    .fn()
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const state = {
    phase: 'running',
    control: { session: 'test-session', revision: 18 },
  };
  const props = {
    vm: {
      state,
      selected: { id: 'fx' },
      selectedPluginUri: plugin.uri,
      selectedView: { label: 'Moment' },
      visibleControls: ports.map((p) => ({
        target: { kind: 'lv2', node: 'fx', symbol: p.symbol },
        label: p.name ?? p.symbol,
        value: p.default,
        minimum: p.minimum,
        maximum: p.maximum,
        integer: p.integer,
        toggle: p.toggled,
        display: String(p.default),
      })),
    },
    rig: { connected: true, command },
  } as unknown as RigViewProps;
  render(<LiveLv2Panel {...props} />);
  fireEvent.click(
    await screen.findByText('Named settings', { selector: 'summary' }),
  );
  const select = screen.getByLabelText('Saved settings for Moment');
  await waitFor(() => expect(select).toHaveTextContent('Dry break'));
  fireEvent.change(select, { target: { value: 'a'.repeat(32) } });
  const apply = screen.getByRole('button', { name: 'Apply to playing block' });
  fireEvent.click(apply);
  await screen.findByText(/device did not confirm/i);
  expect(command).toHaveBeenCalledExactlyOnceWith(
    {
      kind: 'apply_block_settings',
      command: { session: 'test-session', expected_revision: 18, node: 'fx' },
      plugin: plugin.uri,
      controls: saved,
    },
    true,
    state,
  );
  expect(screen.queryByRole('button', { name: 'Undo recall' })).toBeNull();
  fireEvent.click(apply);
  await screen.findByText('Settings applied to the playing block.');
  expect(command).toHaveBeenCalledTimes(2);
});
