import { expect, it } from 'vitest';
import { replaceNativeFiles } from './nativeResourceEdit';
import type { RigDocument } from './api';

const document = {
  revision: 'r'.repeat(64),
  manifest: {
    id: 'scene-preset',
    name: 'Scenes',
    resources: [
      {
        id: 'a',
        path: 'tone3000/a.t3kpreset',
        kind: 'tone3000-preset',
        sha256: 'a'.repeat(64),
        bytes: 10,
      },
      {
        id: 'b',
        path: 'tone3000/b.t3kpreset',
        kind: 'tone3000-preset',
        sha256: 'b'.repeat(64),
        bytes: 20,
      },
    ],
    tone3000: {
      instances: [
        { id: 'clean', preset: 'a', profile: 'p' },
        { id: 'lead', preset: 'b', profile: 'p' },
      ],
    },
    extensions: { 'urn:oxidal:scenes:1': { branches: [{ id: 'clean' }] } },
  },
} as unknown as RigDocument;

it('points one block at edited bytes and keeps everything else from the saved version', () => {
  const sha = 'c'.repeat(64);
  const publish = replaceNativeFiles(
    document,
    {
      lead: {
        preset: { sha256: sha, size_bytes: 30, name: 'Lead (edited)' } as never,
        source: { kind: 'owned', preset: 'owned-1' },
      },
    },
    'scene-preset',
    'Scenes',
  );
  const manifest = JSON.parse(publish.manifest_json);
  expect(manifest.tone3000.instances).toEqual([
    { id: 'clean', preset: 'a', profile: 'p' },
    { id: 'lead', preset: 'preset-2', profile: 'p' },
  ]);
  // The file no block uses any more is dropped; the scenes stay untouched.
  expect(manifest.resources.map((r: { id: string }) => r.id)).toEqual([
    'a',
    'preset-2',
  ]);
  expect(manifest.extensions).toEqual(document.manifest.extensions);
  expect(publish.resources).toEqual({
    a: { kind: 'bundle', revision: document.revision, resource: 'a' },
    'preset-2': { kind: 'owned', preset: 'owned-1' },
  });
  expect(() =>
    replaceNativeFiles(document, { gone: {} as never }, 'x', 'y'),
  ).toThrow(/no longer here/);
});
