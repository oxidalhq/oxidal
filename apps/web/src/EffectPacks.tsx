import { useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import {
  changeEffectPack,
  effectPacks,
  type EffectPacks as EffectPacksState,
} from './api';

/** Curated packs only: package names and qualification counts come from the device. */
export function EffectPacks({
  connected,
  audioRunning,
}: {
  connected: boolean;
  audioRunning: boolean;
}) {
  const [state, setState] = useState<EffectPacksState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState('');

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
          if (active)
            setError(cause instanceof Error ? cause.message : String(cause));
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
          if (active)
            setError(cause instanceof Error ? cause.message : String(cause));
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const playing = audioRunning || Boolean(state?.audio_running);
  const locked = Boolean(state?.job) || busy !== null;
  const removal = state?.packs.find((pack) => pack.id === confirmRemove);

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
      {state?.message && !state.job && (
        <p className="caption" role="status">
          {state.message}
        </p>
      )}

      {!state && !error && <p>Reading installed effects…</p>}
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
                      onClick={() => setConfirmRemove(pack.id)}
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
          <p className="caption">
            Local presets and their settings are not deleted.
          </p>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirmRemove(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => void change(removal.id, 'remove')}
            >
              Remove effects
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </section>
  );
}
