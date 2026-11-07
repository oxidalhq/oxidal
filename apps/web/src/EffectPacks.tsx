import { Loading } from './components/ui/loading';
import { RecoveryAction } from './components/ui/failure';
import { useFailure } from './lib/useFailure';
import { friendlyError } from './lib/friendlyError';
import { useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { DialogFooter } from './components/ui/dialog';
import {
  changeEffectPack,
  effectPacks,
  graphLibrary,
  rigLibrary,
  type EffectPacks as EffectPacksState,
} from './api';
import { presetsUsingPack, type PresetPlugins } from './lib/effectPackUsage';

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
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
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
  }, [connected]);

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
      setConfirmRemove(null);
    } catch (cause) {
      setError(friendlyError(cause, 'change effect packs'));
      recoverFail(cause, 'change effect packs', () => void change(id, action));
    } finally {
      setBusy(null);
    }
  }

  const playing = audioRunning || Boolean(state?.audio_running);
  const locked = Boolean(state?.job) || busy !== null;
  const removal = state?.packs.find((pack) => pack.id === confirmRemove);
  const usedBy = (id: string) =>
    presets ? presetsUsingPack(id, presets) : null;
  const removalUsers = removal ? usedBy(removal.id) : null;
  const installed = state?.packs.filter((pack) => pack.installed).length ?? 0;

  return (
    <section className="panel effect-packs" aria-label="Effects">
      <h2 className="sr-only">Effects</h2>
      <p className="caption effect-packs-intro">
        Qualified collections available to the effect chooser. Unsupported
        plugins stay hidden.
      </p>

      {playing && (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          Stop audio before installing or removing effects. This protects the
          playing session from package and disk activity.
        </p>
      )}
      {state && !state.storage_writable && (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          Unlock system storage and restart before changing effect packs.
        </p>
      )}
      {state?.job && (
        <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
          {state.job.action === 'install' ? 'Installing' : 'Removing'}{' '}
          {state.packs.find((pack) => pack.id === state.job?.pack)?.name ??
            state.job.pack}
          … You can leave this screen; the device owns the job.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {error && <RecoveryAction failure={recoverFailure} />}
      {state?.message && !state.job && (
        <p className="caption" role="status">
          {state.message}
        </p>
      )}

      {!state && !error && <Loading label="Reading installed effects…" />}
      {state && installed === 0 && (
        <p role="status" className="effect-packs-empty">
          No effect packs installed yet. Install one to add its effects to
          presets. Nothing is installed automatically.
        </p>
      )}
      {state && !state.available && (
        <p role="status" className="caption">
          This device cannot install packages, so effect packs are shown for
          reference only.
        </p>
      )}
      {state && (
        <ul className="effect-pack-list" aria-label="Curated packs">
          {state.packs.map((pack) => {
            const active = state.job?.pack === pack.id || busy === pack.id;
            return (
              <li key={pack.id} className="effect-pack-row">
                <div className="effect-pack-copy">
                  <div className="effect-pack-title">
                    <strong>{pack.name}</strong>
                    <a
                      className="tone-details-link text-xs"
                      href={pack.website}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Website <ArrowSquareOut aria-hidden="true" />
                    </a>
                    <span className="effect-pack-state">
                      {pack.installed
                        ? `Installed${pack.version ? ` · ${pack.version}` : ''}`
                        : 'Not installed'}
                    </span>
                  </div>
                  <p className="caption effect-pack-meta">
                    {pack.usable_plugins} usable effects · about {pack.size_mib}{' '}
                    MiB · {pack.qualification}
                    {pack.installed &&
                      (() => {
                        const users = usedBy(pack.id);
                        if (!users) return null;
                        return users.length
                          ? ` · Used by ${users.length} ${users.length === 1 ? 'preset' : 'presets'}`
                          : ' · Not used by saved presets';
                      })()}
                  </p>
                </div>
                <div className="effect-pack-action">
                  {pack.installed ? (
                    <Button
                      variant="ghost"
                      className="text-destructive"
                      disabled={
                        !connected ||
                        !state.available ||
                        !state.storage_writable ||
                        playing ||
                        locked
                      }
                      onClick={() => {
                        setAcknowledged(false);
                        setConfirmRemove(pack.id);
                      }}
                    >
                      {active ? 'Working…' : 'Remove'}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={
                        !connected ||
                        !state.available ||
                        !state.storage_writable ||
                        playing ||
                        locked
                      }
                      onClick={() => void change(pack.id, 'install')}
                    >
                      {active ? 'Working…' : 'Install'}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {removal && (
        <AdjustmentDialog
          title={`Remove ${removal.name}?`}
          onCancel={() => {
            if (!busy) setConfirmRemove(null);
          }}
        >
          <p>
            This removes the effect collection from the unit. Presets that use
            one of its effects will need the collection installed again before
            they can play completely.
          </p>
          {removalUsers === null ? (
            <p className="caption">
              Oxidal could not check which saved presets use these effects.
            </p>
          ) : removalUsers.length > 0 ? (
            <>
              <p>
                Used by {removalUsers.length}{' '}
                {removalUsers.length === 1 ? 'saved preset' : 'saved presets'}:
              </p>
              <ul aria-label="Presets that use these effects">
                {removalUsers.slice(0, 8).map((name) => (
                  <li key={name}>{name}</li>
                ))}
                {removalUsers.length > 8 && (
                  <li>and {removalUsers.length - 8} more</li>
                )}
              </ul>
            </>
          ) : (
            <p className="caption">No saved preset uses these effects.</p>
          )}
          {removalUsers?.length !== 0 && (
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              I understand these presets will not play completely until I
              install it again
            </label>
          )}
          <p className="caption">
            Local presets and their settings are not deleted.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setConfirmRemove(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                busy !== null || (removalUsers?.length !== 0 && !acknowledged)
              }
              onClick={() => void change(removal.id, 'remove')}
            >
              Remove effects
            </Button>
          </DialogFooter>
        </AdjustmentDialog>
      )}
    </section>
  );
}
