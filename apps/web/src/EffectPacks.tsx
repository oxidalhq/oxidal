import { useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
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

  return (
    <section className="panel space-y-4" aria-label="Effects">
      <div>
        <h2>Effects</h2>
        <p className="caption mt-1 max-w-2xl">
          Add qualified effect collections to this unit. The usable count comes
          from Oxidal’s audio harness; unsupported plugins stay out of the
          effect chooser.
        </p>
      </div>

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
        <ul className="divide-y divide-border/60" aria-label="Curated packs">
          {state.packs.map((pack) => {
            const awaitingRemove = confirmRemove === pack.id;
            const active = state.job?.pack === pack.id || busy === pack.id;
            return (
              <li
                key={pack.id}
                className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <strong>{pack.name}</strong>
                    <a
                      className="tone-details-link text-xs"
                      href={pack.website}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Website <ArrowSquareOut aria-hidden="true" />
                    </a>
                    <span className="caption">
                      {pack.installed
                        ? `Installed${pack.version ? ` · ${pack.version}` : ''}`
                        : 'Not installed'}
                    </span>
                  </div>
                  <p className="caption mt-1">
                    {pack.usable_plugins} usable effects · about {pack.size_mib}{' '}
                    MiB · {pack.qualification}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {pack.installed ? (
                    <>
                      <Button
                        variant={awaitingRemove ? 'destructive' : 'outline'}
                        disabled={
                          !connected ||
                          !state.available ||
                          !state.storage_writable ||
                          playing ||
                          locked
                        }
                        onClick={() => {
                          if (awaitingRemove) void change(pack.id, 'remove');
                          else setConfirmRemove(pack.id);
                        }}
                      >
                        {active
                          ? 'Working…'
                          : awaitingRemove
                            ? 'Confirm remove'
                            : 'Remove'}
                      </Button>
                      {awaitingRemove && (
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmRemove(null)}
                        >
                          Cancel
                        </Button>
                      )}
                    </>
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
    </section>
  );
}
