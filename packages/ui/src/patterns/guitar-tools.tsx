import { CheckCircle, Warning } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';
import { SettingGroup } from './settings-page';

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
  plain = false,
}: {
  checks: SoundCheckItem[];
  onAction?: (check: SoundCheckItem) => void;
  /** The same list serves "Before you play" in Settings. */
  title?: string;
  caption?: string;
  /**
   * A settings group instead of a card: on a Settings page, where every
   * section is a group of rows and the page already carries the title.
   */
  plain?: boolean;
}) {
  const list = (
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
  );
  if (plain)
    return (
      <SettingGroup title={caption}>
        <div className="grid border-b border-border">{list}</div>
      </SettingGroup>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <Caption as="span" className="text-xs">
          {caption}
        </Caption>
      </CardHeader>
      {list}
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
  disabled = false,
}: {
  preset: string;
  state: LevelMatchState;
  onStart: () => void;
  onKeep: () => void;
  onUndo: () => void;
  disabled?: boolean;
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
          <Button
            className="justify-self-start"
            disabled={disabled}
            onClick={onStart}
          >
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
            <Button disabled={disabled} onClick={onKeep}>
              Keep
            </Button>
            <Button variant="outline" onClick={onUndo}>
              Undo
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
