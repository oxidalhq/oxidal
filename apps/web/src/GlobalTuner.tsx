import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  monitoring,
  type AudioState,
} from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
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
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const owner = useRef<Owner | null>(null);
  const started = useRef(false);
  const attempted = useRef(false);
  const initialMuted = useRef<boolean | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const monitor =
          initialMuted.current === null
            ? await monitoring().catch(() => null)
            : null;
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
          if (initialMuted.current === null) {
            const outputMuted =
              monitor?.audio?.monitoring?.output_muted ?? false;
            initialMuted.current = outputMuted;
            setMuted(outputMuted);
          }
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
          if (initialMuted.current === null) {
            const outputMuted =
              monitor?.audio?.monitoring?.output_muted ?? false;
            initialMuted.current = outputMuted;
            setMuted(outputMuted);
          }
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
  const autoStart = useEffectEvent(async () => {
    if (tools?.tuner_enabled) return;
    setBusy(true);
    try {
      await command(true);
      started.current = true;
      setError('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  });
  useEffect(() => {
    if (ready && !attempted.current) {
      attempted.current = true;
      void autoStart();
    }
  }, [ready]);
  async function monitor(enabled: boolean) {
    const target = owner.current;
    if (!target) throw new Error('No tuner source available.');
    const action = {
      kind: 'host_utility' as const,
      command: { kind: 'output_mute' as const, enabled },
    };
    if (target.kind === 'native') {
      const state = await playbackState();
      if (state.session !== target.session || state.phase !== 'running')
        throw new Error('The playing preset changed.');
      await playbackCommand(state, action);
    } else {
      const state = await rigAudioState();
      if (
        state.phase !== 'running' ||
        state.control?.session !== target.session
      )
        throw new Error('The playing preset changed.');
      await rigAudioCommand(state, action);
    }
    setMuted(enabled);
  }
  async function setMonitoring(enabled: boolean) {
    if (busy || muted === enabled) return;
    setBusy(true);
    try {
      await monitor(enabled);
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
      if (initialMuted.current !== null && muted !== initialMuted.current) {
        await monitor(initialMuted.current);
      }
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
  const cents = pitch === null ? null : (pitch - Math.round(pitch)) * 100;
  const shownCents = cents === null ? null : Math.round(cents * 10) / 10;
  const inTune = cents !== null && Math.abs(cents) <= 2;
  const strobeStyle = {
    animationDuration:
      cents === null
        ? '1s'
        : `${Math.max(0.18, 1.8 / Math.max(Math.abs(cents), 1)).toFixed(2)}s`,
    animationDirection: cents !== null && cents < 0 ? 'reverse' : 'normal',
    animationPlayState: cents === null || inTune ? 'paused' : 'running',
  } satisfies CSSProperties;
  const note =
    nearest === null
      ? '—'
      : `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((nearest % 12) + 12) % 12]}${Math.floor(nearest / 12) - 1}`;
  const errorMessage = error.startsWith('Error: ') ? error.slice(7) : error;
  return (
    <AdjustmentDialog
      title="Tuner"
      className="tuner-dialog"
      onCancel={() => void close()}
    >
      <div className="tuner-layout">
        <div className="tuner-display" data-in-tune={inTune}>
          <div
            role="meter"
            aria-label="Tuning cents"
            aria-valuemin={-50}
            aria-valuemax={50}
            aria-valuenow={shownCents ?? 0}
            aria-valuetext={
              shownCents === null ? 'No reliable pitch' : `${shownCents} cents`
            }
            className="tuner-strobe"
          >
            <svg viewBox="0 0 240 240" aria-hidden="true">
              <circle
                className="tuner-reference-ring"
                cx="120"
                cy="120"
                r="108"
                pathLength="120"
                strokeDasharray="1 4"
              />
              <g className="tuner-strobe-track" style={strobeStyle}>
                <circle
                  cx="120"
                  cy="120"
                  r="94"
                  pathLength="120"
                  strokeDasharray="6 4"
                />
                <circle
                  cx="120"
                  cy="120"
                  r="82"
                  pathLength="120"
                  strokeDasharray="3 7"
                />
              </g>
              <path
                className="tuner-reference-mark"
                d="M115 4 L125 4 L120 14 Z"
              />
            </svg>
          </div>
          <div className="tuner-center">
            <div className="tuner-note" aria-label="Detected note">
              {note}
            </div>
            <div className="tuner-reading" aria-live="polite">
              <strong>
                {shownCents === null
                  ? tools?.tuner_enabled
                    ? 'Play a note'
                    : busy
                      ? 'Starting…'
                      : 'No input'
                  : `${shownCents > 0 ? '+' : ''}${shownCents.toFixed(1)} cents`}
              </strong>
              <span>
                {reading && shownCents !== null
                  ? `${reading.frequency.toFixed(2)} Hz`
                  : 'A440 reference'}
              </span>
            </div>
            <span className="tuner-lock" aria-hidden={!inTune}>
              {inTune ? 'IN TUNE' : '±2 cent lock'}
            </span>
          </div>
        </div>
        <ToggleGroup
          type="single"
          aria-label="Tuner monitoring"
          value={muted ? 'mute' : 'hear'}
          disabled={!ready || busy}
          onValueChange={(value) => {
            if (value) void setMonitoring(value === 'mute');
          }}
        >
          <ToggleGroupItem value="mute">Mute</ToggleGroupItem>
          <ToggleGroupItem value="hear">Hear sound</ToggleGroupItem>
        </ToggleGroup>
        <p className="caption">
          A440 · Your previous sound monitoring returns when you close the
          tuner.
        </p>
        {error && (
          <Alert variant="warning" role="alert">
            <WarningCircle aria-hidden="true" />
            <AlertTitle>Tuner unavailable</AlertTitle>
            <AlertDescription className="break-words text-current">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </AdjustmentDialog>
  );
}
