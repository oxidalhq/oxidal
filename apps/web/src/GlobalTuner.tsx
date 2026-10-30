import { useEffect, useRef, useState } from 'react';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  type AudioState,
} from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
type Tools = NonNullable<NonNullable<AudioState['authoring']>['tools']>;
type Owner =
  | { kind: 'native'; session: string }
  | { kind: 'mixed'; session: string; node: string };

/** Global access, with session-bound commands to the actual native tuner. */
export function GlobalTuner({
  onClose,
  slow = false,
}: {
  onClose: () => void;
  slow?: boolean;
}) {
  const [tools, setTools] = useState<Tools | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<'native' | 'mixed'>('native');
  const [busy, setBusy] = useState(false);
  const owner = useRef<Owner | null>(null);
  const started = useRef(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const native = await playbackState();
        if (!active) return;
        if (native.phase === 'running' && native.authoring?.tools) {
          if (
            owner.current &&
            (owner.current.kind !== 'native' ||
              owner.current.session !== native.session)
          )
            throw new Error(
              'The playing preset changed. Close and reopen the tuner.',
            );
          owner.current = { kind: 'native', session: native.session };
          setSource('native');
          setTools(native.authoring.tools);
          setReady(true);
        } else {
          const mixed = await rigAudioState();
          if (!active) return;
          const rows =
            mixed.control?.authoring?.filter((row) => row.status.tools) ?? [];
          const row =
            owner.current?.kind === 'mixed'
              ? rows.find(
                  (row) =>
                    row.node === (owner.current as { node: string }).node,
                )
              : rows[0];
          if (mixed.phase !== 'running' || !mixed.control || !row?.status.tools)
            throw new Error(
              'Play a preset with a TONE3000 chain to use its tuner. A standalone input tuner is not available yet.',
            );
          if (
            owner.current &&
            (owner.current.kind !== 'mixed' ||
              owner.current.session !== mixed.control.session)
          )
            throw new Error(
              'The playing preset changed. Close and reopen the tuner.',
            );
          owner.current = {
            kind: 'mixed',
            session: mixed.control.session,
            node: row.node,
          };
          setSource('mixed');
          setTools(row.status.tools);
          setReady(true);
        }
        setError('');
      } catch (cause) {
        if (active) {
          setError(String(cause));
          setReady(false);
          setTools(null);
        }
      } finally {
        if (active) timer = setTimeout(() => void poll(), slow ? 1000 : 200);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [slow]);
  async function command(enabled: boolean) {
    const target = owner.current;
    if (!target) throw new Error('No tuner source available.');
    const action = {
      kind: 'utility' as const,
      command: { kind: 'tuner' as const, enabled },
    };
    if (target.kind === 'native') {
      const state = await playbackState();
      if (state.session !== target.session || state.phase !== 'running')
        throw new Error('The playing preset changed.');
      const next = await playbackCommand(state, { kind: 'authoring', action });
      setTools(next.authoring?.tools ?? null);
    } else {
      const state = await rigAudioState();
      if (
        state.phase !== 'running' ||
        state.control?.session !== target.session
      )
        throw new Error('The playing preset changed.');
      const next = await rigAudioCommand(state, {
        kind: 'authoring',
        command: {
          session: state.control.session,
          expected_revision: state.control.revision,
          node: target.node,
          action,
        },
      });
      setTools(
        next.control?.authoring?.find((row) => row.node === target.node)?.status
          .tools ?? null,
      );
    }
  }
  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const enabled = !tools?.tuner_enabled;
      await command(enabled);
      started.current = enabled;
      setError('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      if (started.current) await command(false);
      onClose();
    } catch (cause) {
      setError(`${String(cause)} Close again to leave this view.`);
      started.current = false;
    } finally {
      setBusy(false);
    }
  }
  const reading = tools?.tuner_enabled ? tools.tuner : null;
  const pitch =
    reading && reading.frequency > 0 && reading.confidence >= 0.7
      ? 69 + 12 * Math.log2(reading.frequency / 440)
      : null;
  const nearest = pitch === null ? null : Math.round(pitch);
  const cents =
    pitch === null ? null : Math.round((pitch - Math.round(pitch)) * 100);
  const note =
    nearest === null
      ? '—'
      : `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
  return (
    <AdjustmentDialog title="Tuner" onCancel={() => void close()}>
      <div className="space-y-4">
        <div className="tuner-note" aria-label="Detected note">
          {note}
        </div>
        <div
          role="meter"
          aria-label="Tuning cents"
          aria-valuemin={-50}
          aria-valuemax={50}
          aria-valuenow={cents ?? undefined}
          aria-valuetext={
            cents === null ? 'No reliable pitch' : `${cents} cents`
          }
          className="tuner-meter"
        >
          <span className="tuner-center" />
          {cents !== null && (
            <span className="tuner-needle" style={{ left: `${cents + 50}%` }} />
          )}
        </div>
        <p className="text-center font-mono">
          {cents === null
            ? tools?.tuner_enabled
              ? 'Play a note'
              : 'Ready to tune'
            : `${cents > 0 ? '+' : ''}${cents} cents · ${reading!.frequency.toFixed(1)} Hz`}
        </p>
        <Button
          variant="outline"
          disabled={!ready || busy}
          onClick={() => void toggle()}
          aria-pressed={!!tools?.tuner_enabled}
        >
          {tools?.tuner_enabled ? 'Stop tuner' : 'Start tuner'}
        </Button>
        <p className="caption">
          A440 · audio stays audible.{' '}
          {source === 'mixed'
            ? 'Reads the first available TONE3000 stage.'
            : 'Reads the current TONE3000 input.'}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
    </AdjustmentDialog>
  );
}
