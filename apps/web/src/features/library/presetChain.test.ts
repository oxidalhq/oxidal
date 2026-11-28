import { describe, expect, it } from 'vitest';

import type { Lv2Plugin } from '../../api';
import { presetChain } from './presetChain';

describe('presetChain', () => {
  it('names effects from the catalog and captures as Capture, in order', () => {
    const plugins = new Map([
      [
        'urn:oxidal:echo',
        { uri: 'urn:oxidal:echo', name: 'Echo' } as Lv2Plugin,
      ],
    ]);
    expect(
      presetChain(
        [
          { kind: 'tone3000', bypassed: false },
          { kind: 'lv2', plugin_uri: 'urn:oxidal:echo', bypassed: false },
          {
            kind: 'lv2',
            plugin_uri: 'https://example.com/lv2/Big%20Hall',
            bypassed: true,
          },
        ],
        plugins,
      ),
    ).toEqual([
      { kind: 'amp', label: 'Capture' },
      { kind: 'time', label: 'Echo' },
      expect.objectContaining({ label: 'Big Hall' }),
    ]);
  });

  it('draws nothing for a preset without blocks', () => {
    expect(presetChain(undefined, new Map())).toBeUndefined();
    expect(presetChain([], new Map())).toBeUndefined();
  });
});
