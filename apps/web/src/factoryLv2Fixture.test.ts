/**
 * The factory LV2 fixture holds harness-usable effects only: every entry is
 * admitted, scalar-only or covered by an exact curated scalar layout.
 *
 * @see docs/lv2.md
 */
import { expect, it } from 'vitest';
import catalog from './fixtures/factory-lv2.json';
import layouts from '../../../crates/oxidal-lv2/scalar-state.json';
import type { Lv2Plugin } from './api';

const plugins = catalog as Lv2Plugin[];
const scalar: Record<string, { controls: string[]; atoms: string[] }> = layouts;
const symbols = (plugin: Lv2Plugin, kind: 'controls' | 'atoms') =>
  plugin.ports
    .filter((p) => (kind === 'atoms' ? p.atom : p.control && p.input))
    .map((p) => p.symbol)
    .sort();

it('admits every fixture effect as scalar-only or by its exact layout', () => {
  expect(new Set(plugins.map((p) => p.uri)).size).toBe(plugins.length);
  for (const plugin of plugins) {
    expect(plugin.unsupported ?? null, plugin.name).toBeNull();
    if (!plugin.ports.some((p) => p.atom)) continue;
    const layout = scalar[plugin.uri];
    expect(layout, plugin.name).toBeDefined();
    expect(symbols(plugin, 'controls'), plugin.name).toEqual(layout!.controls);
    expect(symbols(plugin, 'atoms'), plugin.name).toEqual(layout!.atoms);
  }
  for (const uri of Object.keys(scalar))
    expect(
      plugins.some((p) => p.uri === uri),
      uri,
    ).toBe(true);
});

it('keeps scale points sorted, in range and uniquely valued', () => {
  for (const plugin of plugins)
    for (const port of plugin.ports) {
      const points = port.scale_points ?? [];
      const values = points.map((p) => p.value);
      expect(values, `${plugin.name} ${port.symbol}`).toEqual(
        [...values].sort((a, b) => a - b),
      );
      expect(new Set(values).size).toBe(values.length);
      for (const point of points) {
        expect(point.label.length).toBeGreaterThan(0);
        expect(point.value).toBeGreaterThanOrEqual(port.minimum!);
        expect(point.value).toBeLessThanOrEqual(port.maximum!);
      }
    }
  const vintage = plugins.find((p) => p.name === 'Calf Vintage Delay')!;
  expect(
    vintage.ports
      .find((p) => p.symbol === 'mix_mode')
      ?.scale_points?.map((p) => p.label),
  ).toEqual(['Stereo', 'Ping-Pong', 'L then R', 'R then L']);
});
