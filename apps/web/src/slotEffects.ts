import type { Lv2Plugin } from './api';
import type { RigNativeSource, RigPublish } from './generated/contract';
import {
  lv2Effect,
  parallelRig,
  serialRig,
  type NativeDraft,
} from './rigDraft';

/** Where an effect goes around a TONE3000 chain, which it cannot enter. */
export type Placement = 'before' | 'after' | 'split';

/** "Oxidal Hold (Stereo)" → "Hold": short enough for a preset name. */
export function effectShortName(plugin: Lv2Plugin) {
  return plugin.name
    .replace(/\s*\((mono|stereo)\)\s*$/i, '')
    .replace(/^Oxidal\s+/, '')
    .trim();
}

/**
 * A finished preset with effects built from a TONE3000 preset: the effect
 * before or after its whole chain, or on a lane beside it (split). The
 * original preset is untouched; the new one appears in the library.
 * @see docs/interface.md
 */
export function presetWithEffect({
  tone,
  name,
  plugin,
  placement,
  profile,
}: {
  tone: RigNativeSource;
  name: string;
  plugin: Lv2Plugin;
  placement: Placement;
  profile: string;
}): { name: string; publish: RigPublish } {
  const native: NativeDraft = {
    id: `native-${crypto.randomUUID()}`,
    kind: 'native',
    name,
    preset: tone.preset,
    source: tone.source,
  };
  const effect = lv2Effect(plugin);
  const title = `${name} + ${effectShortName(plugin)}`.slice(0, 80);
  const id = crypto.randomUUID();
  const publish =
    placement === 'split'
      ? parallelRig(id, title, [], [[native], [effect]], profile, false)
      : serialRig(
          id,
          title,
          placement === 'before' ? [effect, native] : [native, effect],
          profile,
          false,
        );
  return { name: title, publish };
}

/** The library source of the TONE3000 preset that is playing. */
export function playingTone(
  sources: RigNativeSource[],
  presetId: string,
  owned: boolean,
) {
  return sources.find((s) =>
    owned
      ? s.source.kind === 'owned' && s.source.preset === presetId
      : s.source.kind === 'original' && s.preset.sha256 === presetId,
  );
}
