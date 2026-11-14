import type { RigDocument } from './api';

/**
 * Which version a preset's scenes are saved as. Version 1 mixes paths;
 * version 2 also sets effect settings (`controls`), so an Oxidal that only
 * reads version 1 refuses the preset as unsupported instead of failing to
 * read it. Version 1 manifests that already carry controls, saved before
 * version 2, are read as they are; the next save writes them as version 2.
 * Mirrors `manifest/scenes.rs` in `oxidal-presets`.
 * @see docs/presets/format.md
 */
type Manifest = RigDocument['manifest'];

export const SCENES_V1 = 'urn:oxidal:scenes:1';
export const SCENES_V2 = 'urn:oxidal:scenes:2';
const VERSIONS = [SCENES_V1, SCENES_V2] as const;

type SceneShape = { controls?: unknown[] };
type ScenesShape = { scenes?: SceneShape[] };

/** The key a preset's scenes are stored under, or undefined without scenes. */
export function scenesKey(manifest: Manifest): string | undefined {
  return [...VERSIONS]
    .reverse()
    .find((key) => manifest.extensions[key] !== undefined);
}

/** A preset's scenes, whichever version they are saved as. */
export function readScenes<T = Record<string, unknown>>(
  manifest: Manifest,
): T | undefined {
  const key = scenesKey(manifest);
  return key ? (manifest.extensions[key] as T) : undefined;
}

/** The version a set of scenes must be saved as. */
export function scenesFormat(scenes: unknown): string {
  const list = (scenes as ScenesShape | undefined)?.scenes ?? [];
  return list.some((scene) => scene.controls?.length) ? SCENES_V2 : SCENES_V1;
}

/**
 * Store `scenes` under the version they need, replacing any other version,
 * and keep `requiredExtensions` naming exactly that version. Without scenes,
 * removes both versions.
 */
export function writeScenes(manifest: Manifest, scenes: unknown): void {
  const key = scenes === undefined ? undefined : scenesFormat(scenes);
  for (const version of VERSIONS) {
    if (version === key) continue;
    delete manifest.extensions[version];
  }
  // The version takes the place of the one it replaces, so a manifest whose
  // version does not change is saved byte for byte as before.
  const isVersion = (required: string) =>
    VERSIONS.some((version) => version === required);
  const at = manifest.requiredExtensions.findIndex(isVersion);
  const others = manifest.requiredExtensions.filter((r) => !isVersion(r));
  if (key) {
    manifest.extensions[key] = scenes as Manifest['extensions'][string];
    others.splice(at < 0 ? others.length : at, 0, key);
  }
  manifest.requiredExtensions = others;
}

/**
 * Re-store a manifest's scenes under the version they need, in place. Call
 * just before a manifest is serialized for saving. A manifest without scenes
 * is left as it is.
 */
export function sealScenes<T extends Manifest>(manifest: T): T {
  const scenes = readScenes(manifest);
  if (scenes !== undefined) writeScenes(manifest, scenes);
  return manifest;
}
