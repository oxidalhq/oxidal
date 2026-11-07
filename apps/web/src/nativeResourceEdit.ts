import type { RigDocument } from './api';
import type { RigPublish } from './generated/contract';
import type { NativeDraft } from './rigDraft';

/**
 * Saves a preset with some TONE3000 blocks pointing at edited preset files
 * (7.3), leaving its graph, scenes and every other byte as they are. Used for
 * presets whose scenes are separate TONE3000 chains, which the routing editor
 * cannot rebuild. Unchanged files are copied from the saved version; a file no
 * block uses any more is dropped.
 * @see docs/presets/format.md
 */
export function replaceNativeFiles(
  document: RigDocument,
  edits: Record<string, Pick<NativeDraft, 'preset' | 'source'>>,
  id: string,
  name: string,
): RigPublish {
  const manifest = structuredClone(document.manifest);
  manifest.id = id;
  manifest.name = name;
  const resources: RigPublish['resources'] = Object.fromEntries(
    manifest.resources.map((r) => [
      r.id,
      { kind: 'bundle', revision: document.revision, resource: r.id },
    ]),
  );
  for (const [instanceId, edit] of Object.entries(edits)) {
    const instance = manifest.tone3000.instances.find(
      (i) => i.id === instanceId,
    );
    if (!instance) throw new Error('A TONE3000 block is no longer here.');
    let resource = manifest.resources.find(
      (r) => r.kind === 'tone3000-preset' && r.sha256 === edit.preset.sha256,
    );
    if (!resource) {
      let n = manifest.resources.length;
      while (manifest.resources.some((r) => r.id === `preset-${n}`)) n += 1;
      resource = {
        id: `preset-${n}`,
        path: `tone3000/${edit.preset.sha256}.t3kpreset`,
        kind: 'tone3000-preset',
        sha256: edit.preset.sha256,
        bytes: edit.preset.size_bytes,
      };
      manifest.resources.push(resource);
      resources[resource.id] = edit.source;
    }
    instance.preset = resource.id;
  }
  const used = new Set(manifest.tone3000.instances.map((i) => i.preset));
  manifest.resources = manifest.resources.filter(
    (r) => r.kind !== 'tone3000-preset' || used.has(r.id),
  );
  for (const key of Object.keys(resources))
    if (!manifest.resources.some((r) => r.id === key)) delete resources[key];
  return { manifest_json: JSON.stringify(manifest), resources };
}
