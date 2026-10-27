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
        settings: { revision, stream, recall: null },
      });
      if (alive.current) onOpenRig();
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
      <h2>Rigs</h2>
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
          <Button
            variant="outline"
            disabled={!connected || busy}
            aria-label={`Play ${p.name}`}
            onClick={() => void play(p.revision)}
          >
            Play
          </Button>
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
