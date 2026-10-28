import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import {
  rigLibrary,
  rigAudioState,
  rigAudioCommand,
  playbackState,
  graphAudioState,
  type RigPage,
} from './api';

/** Verified library revisions share the same audio configuration and device owner. */
export function SavedRigs({
  connected,
  onOpenRig,
}: {
  connected: boolean;
  onOpenRig: () => void;
}) {
  const [items, setItems] = useState<RigPage['presets']>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem('oxidal.prepared-rigs') ?? '[]',
      );
      return Array.isArray(saved)
        ? saved.filter(
            (v): v is string =>
              typeof v === 'string' && /^[a-f0-9]{64}$/.test(v),
          )
        : [];
    } catch {
      return [];
    }
  });
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem('oxidal.prepared-rigs', JSON.stringify(prepared));
    } catch {
      /* browser storage unavailable */
    }
  }, [prepared]);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    void rigLibrary()
      .then((page) => {
        if (alive.current) {
          setItems(page.presets);
          setNext(page.next ?? null);
        }
      })
      .catch((cause: unknown) => {
        if (alive.current) setError(String(cause));
      });
    return () => {
      alive.current = false;
    };
  }, []);
  async function play(revision: string) {
    setBusy(true);
    setError('');
    try {
      const [rig, native, graph] = await Promise.all([
        rigAudioState(),
        playbackState(),
        graphAudioState(),
      ]);
      if (rig.phase === 'running' && rig.control && rig.configured) {
        if (rig.configured.revision === revision) {
          onOpenRig();
          return;
        }
        const ready = rig.control.prepared?.find(
          (p) => p.revision === revision && !p.error,
        );
        if (ready) {
          await rigAudioCommand(rig, {
            kind: 'switch',
            command: {
              session: rig.control.session,
              expected_revision: rig.control.revision,
              revision,
              fade_frames: Math.max(
                2,
                Math.round(rig.configured.stream.input.sample_rate / 100),
              ),
            },
          });
          if (alive.current) onOpenRig();
          return;
        }
      }
      if ([rig, native, graph].some((s) => s.device_owned))
        throw new Error('Stop the current audio before opening another rig.');
      const stream =
        rig.configured?.stream ??
        native.configured?.stream ??
        graph.configured?.stream;
      if (!stream)
        throw new Error(
          'Choose the input, output and buffer in Settings → Audio first.',
        );
      await rigAudioCommand(rig, {
        kind: 'start',
        settings: {
          revision,
          stream,
          recall: null,
          prepared: [...new Set(prepared)]
            .filter((id) => id !== revision)
            .map((id) => ({ revision: id, recall: null })),
        },
      });
      if (alive.current) {
        if (prepared.length) {
          const complete = [...new Set([...prepared, revision])];
          setPrepared(complete);
          try {
            localStorage.setItem(
              'oxidal.prepared-rigs',
              JSON.stringify(complete),
            );
          } catch {
            /* storage unavailable */
          }
        }
        onOpenRig();
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function more() {
    if (!next) return;
    setBusy(true);
    setError('');
    try {
      const page = await rigLibrary(next);
      if (alive.current) {
        setItems((old) => [
          ...old,
          ...page.presets.filter(
            (p) => !old.some((o) => o.revision === p.revision),
          ),
        ]);
        setNext(page.next ?? null);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!items.length && !error) return null;
  return (
    <section className="space-y-3" aria-label="Saved rigs">
      <div className="section-heading">
        <h2>Rigs</h2>
        <Button
          variant={choosing ? 'secondary' : 'outline'}
          aria-pressed={choosing}
          disabled={busy}
          onClick={() => setChoosing((v) => !v)}
        >
          Prepare set{prepared.length ? ` · ${prepared.length}` : ''}
        </Button>
      </div>
      {choosing && (
        <p className="caption">
          Ready rigs use extra DSP and memory while audio runs.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {items.map((p) => (
        <div
          key={p.revision}
          className="section-heading border-b border-border pb-2"
        >
          <div className="min-w-0">
            <h3 className="break-words">{p.name}</h3>
            <p className="caption">
              {p.native_instances} native · {p.lv2_instances} LV2
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {choosing && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 px-2">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  aria-label={`Keep ${p.name} ready`}
                  checked={prepared.includes(p.revision)}
                  disabled={busy}
                  onChange={(event) =>
                    setPrepared((old) =>
                      event.target.checked
                        ? [...new Set([...old, p.revision])]
                        : old.filter((id) => id !== p.revision),
                    )
                  }
                />
                Ready
              </label>
            )}
            <Button
              variant="outline"
              disabled={!connected || busy}
              aria-label={`Play ${p.name}`}
              onClick={() => void play(p.revision)}
            >
              Play
            </Button>
          </div>
        </div>
      ))}
      {next && (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          Load more
        </Button>
      )}
    </section>
  );
}
