import { expect, it } from 'vitest';
import type { RigDocument } from '../../api';
import type { RigNativeSource } from '../../generated/contract';
import { readLanes } from '../../rigEdit';
import {
  emptyPreset,
  presetCopy,
  presetFromTone,
  presetNameError,
} from './newPreset';

const parse = (json: string) => JSON.parse(json) as RigDocument['manifest'];

it('creates an empty input-to-output preset that the editor can open', () => {
  const built = emptyPreset('  Blank  ', 'prof');
  const manifest = parse(built.manifest_json);
  expect(manifest.name).toBe('Blank');
  expect(manifest.tone3000.instances).toEqual([]);
  expect(manifest.oxidal?.lv2).toEqual([]);
  expect(manifest.extensions['urn:oxidal:authoring']).toMatchObject({
    origin: 'mine',
    draft: false,
  });
  expect(manifest.oxidal?.graph.nodes.map((n) => n.kind)).toEqual([
    'input',
    'output',
  ]);
  // The common editor reads it as one empty chain, ready for a first block.
  expect(readLanes({ manifest, revision: 'r'.repeat(64) }, [], {})).toEqual([
    [],
  ]);
  // Each new preset is a new identity, never matched by name.
  expect(parse(emptyPreset('Blank', 'prof').manifest_json).id).not.toBe(
    manifest.id,
  );
});

it('copies a saved revision under a new identity and keeps its resources', () => {
  const source = emptyPreset('Original', 'prof');
  const document: RigDocument = {
    manifest: {
      ...parse(source.manifest_json),
      resources: [
        {
          id: 'preset-0',
          path: `tone3000/${'a'.repeat(64)}.t3kpreset`,
          kind: 'tone3000-preset',
          sha256: 'a'.repeat(64),
          bytes: 9,
        },
      ],
    },
    revision: 'b'.repeat(64),
  };
  const copy = presetCopy(document, 'Copy');
  const manifest = parse(copy.manifest_json);
  expect(manifest.id).not.toBe(document.manifest.id);
  expect(manifest.name).toBe('Copy');
  expect(copy.source).toEqual({ kind: 'rig', id: 'b'.repeat(64) });
  expect(copy.resources).toEqual({
    'preset-0': {
      kind: 'bundle',
      revision: 'b'.repeat(64),
      resource: 'preset-0',
    },
  });
  // The source document is not modified.
  expect(document.manifest.name).toBe('Original');
});

it('builds a one-block preset from a TONE3000 chain', () => {
  const tone = {
    preset: { sha256: 'c'.repeat(64), size_bytes: 5, name: 'Bogner' },
    source: { kind: 'original', sha256: 'c'.repeat(64) },
  } as unknown as RigNativeSource;
  const manifest = parse(
    presetFromTone('My Bogner', tone, 'prof').manifest_json,
  );
  expect(manifest.tone3000.instances).toHaveLength(1);
  expect(manifest.name).toBe('My Bogner');
});

it('requires a short visible name', () => {
  expect(presetNameError('  ')).toMatch(/name/);
  expect(presetNameError('x'.repeat(81))).toMatch(/80/);
  expect(presetNameError('Lead')).toBe('');
});
