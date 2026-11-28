import { useEffect, useState } from 'react';

import { Loading } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';
import { PluginPacks } from '@oxidal/design-system/patterns/engine-settings';
import { SettingNotice } from '@oxidal/design-system/patterns/settings-page';

import {
  changeEffectPack,
  type EffectPacks as EffectPacksState,
  effectPacks,
  graphLibrary,
  rigLibrary,
} from './api';
import { RecoveryAction } from './FailureNotice';
import { type PresetPlugins, presetsUsingPack } from './lib/effectPackUsage';
import { friendlyError } from './lib/friendlyError';
import { useFailure } from './lib/useFailure';

/** Curated packs only: package names and qualification counts come from the device. */
export function EffectPacks({
  connected,
  audioRunning,
}: {
  connected: boolean;
  audioRunning: boolean;
}) {
  const { failure: recoverFailure, fail: recoverFail } = useFailure();
  const [state, setState] = useState<EffectPacksState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Saved presets and the LV2 effects they need, to protect removal (7.17).
  const [presets, setPresets] = useState<PresetPlugins[] | null>(null);

  useEffect(() => {
    let active = true;
    async function read() {
      const found: PresetPlugins[] = [];
      let after: string | undefined;
      for (let page = 0; page < 100; page += 1) {
        const next = await rigLibrary(after);
        found.push(
          ...next.presets.map((p) => ({
            name: p.name,
            plugins: p.lv2_plugins ?? [],
          })),
        );
        if (!next.next) break;
        after = next.next;
      }
      // Older effects-only presets keep their plugin URIs in bindings.
      for (const graph of await graphLibrary().catch(() => [])) {
        found.push({
          name: graph.preset.name,
          plugins: graph.preset.bindings.map((b) => b.uri),
        });
      }
      return found;
    }
    if (connected)
      void read()
        .then((found) => {
          if (active) setPresets(found);
        })
        .catch(() => {
          if (active) setPresets(null);
        });
    return () => {
      active = false;
    };
  }, [connected]);

  useEffect(() => {
    let active = true;
    if (connected)
      void effectPacks()
        .then((next) => {
          if (active) {
            setState(next);
            setError('');
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(friendlyError(cause, 'change effect packs'));
        });
    return () => {
      active = false;
    };
    // Read again when audio starts or stops: the device's own audio flag
    // decides whether Install and Remove are offered.
  }, [connected, audioRunning]);

  useEffect(() => {
    if (!connected || !state?.job) return;
    let active = true;
    const timer = window.setInterval(() => {
      void effectPacks()
        .then((next) => {
          if (active) {
            setState(next);
            setError('');
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(friendlyError(cause, 'change effect packs'));
        });
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [connected, state?.job]);

  async function change(id: string, action: 'install' | 'remove') {
    setBusy(id);
    setError('');
    try {
      setState(await changeEffectPack(id, action));
    } catch (cause) {
      setError(friendlyError(cause, 'change effect packs'));
      recoverFail(cause, 'change effect packs', () => void change(id, action));
    } finally {
      setBusy(null);
    }
  }

  const playing = audioRunning || Boolean(state?.audio_running);
  return (
    <section aria-label="Effects" className="grid min-w-0">
      <h2 className="sr-only">Effects</h2>
      <Caption className="mb-2 text-xs">
        Qualified collections available to the effect chooser. Unsupported
        plugins stay hidden.
      </Caption>

      {state && !state.storage_writable && (
        <SettingNotice tone="warning">
          Unlock system storage and restart before changing effect packs.
        </SettingNotice>
      )}
      {error && <SettingNotice tone="error">{error}</SettingNotice>}
      {error && <RecoveryAction failure={recoverFailure} />}
      {state?.message && !state.job && (
        <SettingNotice>{state.message}</SettingNotice>
      )}

      {!state && !error && <Loading label="Reading installed effects…" />}
      {state && !state.available && (
        <SettingNotice>
          This device cannot install packages, so effect packs are shown for
          reference only.
        </SettingNotice>
      )}
      {state && (
        <PluginPacks
          playing={playing}
          disabled={
            !connected ||
            !state.available ||
            !state.storage_writable ||
            busy !== null
          }
          job={
            state.job
              ? { id: state.job.pack, action: state.job.action }
              : undefined
          }
          packs={state.packs.map((pack) => ({
            id: pack.id,
            name: pack.name,
            installed: pack.installed,
            effects: pack.usable_plugins,
            sizeMib: pack.size_mib,
            qualification: pack.qualification,
            website: pack.website,
            version: pack.version,
            package: pack.package,
            licenceUrl: pack.copyright_available
              ? `/api/v1/packs/${encodeURIComponent(pack.id)}/copyright`
              : undefined,
            usedBy: presets ? presetsUsingPack(pack.id, presets) : null,
          }))}
          onInstall={(pack) => void change(pack.id, 'install')}
          onRemove={(pack) => void change(pack.id, 'remove')}
        />
      )}
    </section>
  );
}
