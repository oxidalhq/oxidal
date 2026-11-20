import { expect, it } from 'vitest';

import type { EffectPacks, Lv2Plugin } from './api';
import { lv2Source } from './lv2Source';

const plugin: Lv2Plugin = {
  name: 'Example',
  uri: 'urn:unrelated:example',
  ports: [],
  unsupported: null,
};
const packs: EffectPacks['packs'] = [
  {
    id: 'x42',
    name: 'x42 Plugins',
    website: 'https://x42-plugins.com',
    package: 'x42-plugins',
    installed: true,
    version: '1.0',
    size_mib: 1,
    usable_plugins: 1,
    qualification: 'Tested on ARM64',
    copyright_available: true,
  },
];

it('uses verified ownership even when the plugin URI has no pack name', () => {
  expect(lv2Source({ ...plugin, pack_id: 'x42' }, packs)).toMatchObject({
    kind: 'lv2',
    pack: {
      package: 'x42-plugins',
      version: '1.0',
      copyright: '/api/v1/packs/x42/copyright',
    },
  });
});

it('does not guess a pack or licence from a URI, stale install or unavailable text', () => {
  expect(
    lv2Source({ ...plugin, uri: 'https://x42-plugins.com/example' }, packs),
  ).toBeUndefined();
  expect(
    lv2Source({ ...plugin, pack_id: 'x42' }, [
      { ...packs[0]!, installed: false },
    ]),
  ).toBeUndefined();
  const source = lv2Source({ ...plugin, pack_id: 'x42' }, [
    { ...packs[0]!, copyright_available: undefined },
  ]);
  expect(source?.kind === 'lv2' && source.pack.copyright).toBeUndefined();
  expect(source?.kind === 'lv2' && source.pack.licence).toBeUndefined();
});

it('recognises only exact shipped Oxidal variants and points to their crate', () => {
  for (const layout of ['mono', 'stereo']) {
    expect(
      lv2Source({ ...plugin, uri: `urn:oxidal:plugin:moment#${layout}` }),
    ).toMatchObject({
      kind: 'oxidal',
      crate: 'oxidal-moment',
      licence: 'Apache-2.0',
      repo: 'https://github.com/oxidalhq/oxidal/tree/main/crates/oxidal-moment',
    });
  }
  expect(
    lv2Source({ ...plugin, uri: 'urn:oxidal:plugin:moment#other' }),
  ).toBeUndefined();
});
