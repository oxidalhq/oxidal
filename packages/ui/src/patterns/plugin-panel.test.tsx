import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { type PluginControl, PluginPanel } from './plugin-panel';

afterEach(cleanup);

it('keeps separate declared groups with the same visible label', () => {
  const controls: PluginControl[] = ['low', 'high'].map((symbol) => ({
    symbol,
    name: `${symbol} cut`,
    group: 'Filter',
    groupId: symbol,
    kind: 'range',
    min: 0,
    max: 100,
    value: 20,
  }));
  render(
    <PluginPanel
      plugin={{ name: 'Equalizer' }}
      controls={controls}
      mainCount={0}
      on
      onControl={() => {}}
    />,
  );
  const groups = screen.getAllByRole('button', { name: /^Filter/ });
  expect(groups).toHaveLength(2);
  groups.forEach((group) => fireEvent.click(group));
  expect(screen.getByRole('slider', { name: 'low cut' })).toBeVisible();
  expect(screen.getByRole('slider', { name: 'high cut' })).toBeVisible();
});

it('delegates factory restore as one action and uses the glyph after artwork failure', () => {
  const restore = vi.fn();
  const change = vi.fn();
  render(
    <PluginPanel
      plugin={{
        name: 'Effect',
        artwork: '/api/v1/plugins/lv2/artwork?uri=urn%3Aeffect',
      }}
      controls={[
        {
          symbol: 'mix',
          kind: 'range',
          min: 0,
          max: 1,
          value: 0.8,
          default: 0.5,
        },
      ]}
      on
      onControl={change}
      onRestoreDefaults={restore}
    />,
  );
  fireEvent.error(document.querySelector('img')!);
  expect(document.querySelector('img')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Restore factory defaults' }),
  );
  expect(restore).toHaveBeenCalledTimes(1);
  expect(change).not.toHaveBeenCalled();
});
