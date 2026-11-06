import type { RigDocument } from '../../api';
import type { RigNativeSource, RigPublish } from '../../generated/contract';
import { serialRig, type NativeDraft } from '../../rigDraft';

/**
 * New presets for the Library's one New preset entry (Sprint 07 7.3). Every
 * result has a fresh identity, is marked Mine and is not a draft, so it shows
 * in Library at once and opens in the common Rig editor.
 * @see docs/presets/format.md
 */
export function emptyPreset(name: string, profile: string): RigPublish {
  return serialRig(crypto.randomUUID(), name, [], profile, false);
}

/** A copy of a TONE3000 chain, as a one-block preset of your own. */
export function presetFromTone(
  name: string,
  tone: RigNativeSource,
  profile: string,
): RigPublish {
  const native: NativeDraft = {
    id: `native-${crypto.randomUUID()}`,
    kind: 'native',
    name: tone.preset.name,
    preset: tone.preset,
    source: tone.source,
  };
  return serialRig(crypto.randomUUID(), name, [native], profile, false);
}

/**
 * Save a copy: the same saved revision under a new identity and name. Every
 * resource is copied from the source revision's bundle; the source is unchanged.
 */
export function presetCopy(document: RigDocument, name: string): RigPublish {
  const manifest: RigDocument['manifest'] = JSON.parse(
    JSON.stringify(document.manifest),
  );
  manifest.id = crypto.randomUUID();
  manifest.name = name.trim();
  manifest.extensions['urn:oxidal:authoring'] = {
    ...(manifest.extensions['urn:oxidal:authoring'] ?? {}),
    origin: 'mine',
    draft: false,
  };
  return {
    manifest_json: JSON.stringify(manifest),
    resources: Object.fromEntries(
      manifest.resources.map((r) => [
        r.id,
        { kind: 'bundle', revision: document.revision, resource: r.id },
      ]),
    ),
    source: { kind: 'rig', id: document.revision },
  };
}

/** Names are 1–80 visible characters; identity never depends on them. */
export function presetNameError(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the preset a name.';
  if (trimmed.length > 80) return 'Use 80 characters or fewer.';
  return '';
}
