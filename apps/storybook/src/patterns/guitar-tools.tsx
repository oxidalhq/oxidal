import { CheckCircle, Warning } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';

export type SoundCheckItem = {
  ok: boolean;
  title: string;
  /** What to do, or why it is fine. */
  fix: string;
  /** The one action that fixes it, if any. */
  action?: string;
};

/** Sound check: what to fix next, most useful first, each with one action. */
export function SoundCheck({
  checks,
  onAction,
  title = 'Sound check',
  caption = 'Most useful first',
}: {
  checks: SoundCheckItem[];
  onAction?: (check: SoundCheckItem) => void;
  /** The same list serves "Before you play" in Settings. */
  title?: string;
  caption?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Caption as="span" className="text-xs">
          {caption}
        </Caption>
      </CardHeader>
      <ul aria-label={title} className="m-0 grid list-none gap-0 p-0">
        {checks.map((c) => (
          <li
            key={c.title}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border py-2 first:border-t-0"
          >
            {c.ok ? (
              <CheckCircle aria-label="Fine" className="size-5" />
            ) : (
              <Warning aria-label="Fix" className="size-5 text-brand" />
            )}
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{c.title}</span>
              <Caption as="span" className="text-xs">
                {c.fix}
              </Caption>
            </span>
            {c.action ? (
              <Button size="sm" variant="outline" onClick={() => onAction?.(c)}>
                {c.action}
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Level match this preset: play normally for eight seconds; the preset's own
 * Output level is then set so it sits at the shared reference loudness.
 * Saved with the preset when you save.
 */
export type LevelMatchState =
  | { step: 'ready'; kept?: boolean }
  | { step: 'listening'; progress: number }
  | {
      step: 'measured';
      before: string;
      target: string;
      /** The Output level Oxidal set, such as "−4.2 dB". */
      level: string;
    };

export function LevelMatch({
  preset,
  state,
  onStart,
  onKeep,
  onUndo,
}: {
  preset: string;
  state: LevelMatchState;
  onStart: () => void;
  onKeep: () => void;
  onUndo: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Level match</CardTitle>
        <Caption as="span" className="text-xs">
          {preset}
        </Caption>
      </CardHeader>
      {state.step === 'ready' && (
        <div className="grid gap-2">
          <Caption>
            Play the way you normally do for eight seconds. Oxidal sets this
            preset's Output level to the shared loudness.
          </Caption>
          <Button className="justify-self-start" onClick={onStart}>
            Start listening
          </Button>
          {state.kept !== undefined && (
            <Caption role="status">
              {state.kept
                ? 'Output level kept. Save the preset to keep it for good.'
                : 'Back to how it was.'}
            </Caption>
          )}
        </div>
      )}
      {state.step === 'listening' && (
        <div role="status" className="grid gap-1.5">
          <span className="text-sm">Listening… keep playing.</span>
          <Progress value={state.progress} label="Listening" />
        </div>
      )}
      {state.step === 'measured' && (
        <div className="grid gap-2">
          <dl className="m-0 grid grid-cols-3 gap-2 text-sm">
            {[
              ['Before', state.before],
              ['Target', state.target],
              ['Output level', state.level],
            ].map(([k, v]) => (
              <div
                key={k}
                className="grid gap-0.5 rounded-lg border border-border px-3 py-2"
              >
                <dt className="small-caps text-xs text-muted-foreground">
                  {k}
                </dt>
                <dd className="m-0 font-mono tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <Button onClick={onKeep}>Keep</Button>
            <Button variant="outline" onClick={onUndo}>
              Undo
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export type PresetLoudness = {
  name: string;
  /** Loudness in LUFS, now. */
  lufs: number;
};

/**
 * Even out all: every preset and scene to the same loudness so switching
 * never jumps. Corrections are bounded (±6 dB); only new or changed presets
 * are measured again.
 */
export function EvenOut({
  presets,
  target = -18,
  progress,
  evened,
  scenes,
  onStart,
}: {
  presets: PresetLoudness[];
  /** The shared loudness in LUFS. */
  target?: number;
  /** 0 to 100 while measuring. */
  progress?: number;
  /** True once presets have been evened out. */
  evened: boolean;
  /** How many scenes are measured with the presets. */
  scenes: number;
  onStart: () => void;
}) {
  const measuring = progress !== undefined;
  const values = presets.map((p) => p.lufs);
  const spread = (Math.max(...values) - Math.min(...values)).toFixed(1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Even out all</CardTitle>
        <Caption as="span" className="text-xs">
          Loudest to quietest: {spread} dB
        </Caption>
      </CardHeader>
      <ul
        aria-label="Preset loudness"
        className="m-0 grid list-none gap-1.5 p-0"
      >
        {presets.map(({ name, lufs: v }) => {
          return (
            <li
              key={name}
              className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-2 text-sm"
            >
              <span className="truncate">{name}</span>
              <span
                aria-hidden="true"
                className="relative h-2 rounded-full bg-wire/30"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-300"
                  style={{ width: `${((v + 30) / 20) * 100}%` }}
                />
                <span
                  className="absolute inset-y-[-3px] w-0.5 bg-brand"
                  style={{ left: `${((target + 30) / 20) * 100}%` }}
                />
              </span>
              <span className="font-mono text-xs tabular-nums">
                {v.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ul>
      {measuring && <Progress value={progress} label="Measuring presets" />}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={measuring} onClick={onStart}>
          {evened ? 'Even out again' : 'Even out all'}
        </Button>
        <Caption as="span" role="status" className="text-xs">
          {measuring
            ? `Measuring ${presets.length} presets and ${scenes} scenes…`
            : evened
              ? 'Done. Corrections stay within ±6 dB; the oxide line is the target.'
              : `The oxide line is the shared loudness, ${target} LUFS.`}
        </Caption>
      </div>
    </Card>
  );
}
