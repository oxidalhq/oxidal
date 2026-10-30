import { expect, it } from 'vitest';
import type { Lv2Plugin } from './api';
import { effectGlyph, effectSource, effectType } from './effectCatalog';

const plugin = (name: string, uri: string, extra: Partial<Lv2Plugin> = {}) =>
  ({ name, uri, ports: [], unsupported: null, ...extra }) as Lv2Plugin;

it('sorts effects by LV2 class first, then by name', () => {
  expect(effectType(plugin('Tape thing', 'urn:x', { category: 'Delay' }))).toBe(
    'Delay',
  );
  // A named flanger beats its generic Filter class.
  const flanger = plugin('Retro Flanger', 'http://plugin.org.uk/x', {
    category: 'Filter',
  });
  expect(effectGlyph(flanger)).toBe('flanger');
  expect(effectType(flanger)).toBe('Modulation');
  expect(effectType(plugin('Oxidal Hold (Stereo)', 'urn:oxidal:hold'))).toBe(
    'Reverb & space',
  );
  expect(effectType(plugin('Mystery box', 'urn:x'))).toBe('Other');
});

it('names the source collection, author or site', () => {
  expect(effectSource(plugin('Pitch', 'urn:oxidal:pitch'))).toBe('Oxidal');
  expect(effectSource(plugin('Toob', 'http://two-play.com/plugins/toob'))).toBe(
    'PiPedal',
  );
  expect(effectSource(plugin('Plate', 'http://plugin.org.uk/plate'))).toBe(
    'SWH',
  );
  expect(
    effectSource(plugin('X', 'http://example.org/x', { author: 'Jane' })),
  ).toBe('Jane');
  expect(effectSource(plugin('Y', 'https://www.fx.example/y'))).toBe(
    'fx.example',
  );
});
