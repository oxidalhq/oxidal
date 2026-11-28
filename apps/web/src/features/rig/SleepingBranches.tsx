/**
 * Silent branches on a preset with scene paths, drawn with the design
 * system's control from the Processing card: Keep running or Sleep. Sleep
 * stops the paths the playing scene does not use once their tails fade, so
 * they use no processing, and wakes them with no gap when a scene needs them.
 *
 * A preset made before sleeping existed must be prepared first: the device
 * checks whether its paths can sleep on their own, and preparing saves and
 * plays a revised copy. Choosing Sleep runs that check and asks before it.
 * @see docs/interface.md
 */
import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';
import { SilentBranches } from '@oxidal/design-system/patterns/processing-card';

import { type RigAudioState, type RigSleepPlan, rigSleepPlan } from '../../api';
import { useProtect } from '../../components/media/sessionMedia';

type Control = NonNullable<RigAudioState['control']>;

const frame = 'grid gap-2 rounded-lg border border-border p-3';

/** A prepared preset: the choice switches sleeping on or off at once. */
export function SleepingBranches({
  control,
  disabled,
  onChange,
}: {
  control: Control;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const sleep = control.branch_sleep;
  const protect = useProtect(!!sleep);
  if (!sleep) return null;
  const name = (id: string) =>
    control.branches?.find((b) => b.id === id)?.name ?? id;
  const sceneName = (id: string) =>
    control.scenes?.scenes.find((s) => s.id === id)?.name ?? id;
  const asleep = sleep.branches.filter((b) => b.phase === 'asleep').length;
  const playing = sleep.branches.length - asleep;
  return (
    <section aria-label="Branch processing" className={frame}>
      <SilentBranches
        policy={sleep.enabled ? 'sleep' : 'running'}
        onPolicy={(policy) => onChange(policy === 'sleep')}
        status={
          sleep.enabled
            ? `${playing} playing · ${asleep} asleep`
            : `${sleep.branches.length} running`
        }
        disabled={disabled || protect}
      >
        {sleep.requested_scene &&
          sleep.requested_scene !== sleep.active_scene && (
            <Caption role="status" className="text-xs">
              Waking the paths for {sceneName(sleep.requested_scene)}…
            </Caption>
          )}
        {sleep.enabled && (
          <ul className="m-0 grid gap-0.5 p-0 pl-4 text-sm">
            {sleep.branches.map((b) => (
              <li
                key={b.branch}
                className={
                  b.phase === 'asleep'
                    ? 'text-muted-foreground'
                    : 'font-semibold'
                }
              >
                {name(b.branch)} · {b.phase}
              </li>
            ))}
          </ul>
        )}
        {sleep.message && (
          <Caption role="status" className="text-xs">
            {sleep.message}
          </Caption>
        )}
      </SilentBranches>
    </section>
  );
}

/**
 * A preset not prepared for sleeping: it keeps every path running. Choosing
 * Sleep checks the preset, says what preparing changes, and prepares it
 * only when asked.
 */
export function PrepareSleepingBranches({
  revision,
  disabled,
  prepare,
}: {
  revision: string;
  disabled: boolean;
  prepare: () => void;
}) {
  const [review, setReview] = useState<RigSleepPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const protect = useProtect(!!review?.plan);
  async function check() {
    setLoading(true);
    setError('');
    try {
      setReview(await rigSleepPlan(revision));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not read this preset.',
      );
    } finally {
      setLoading(false);
    }
  }
  const asking = loading || !!review;
  return (
    <section aria-label="Branch processing" className={frame}>
      <SilentBranches
        policy={asking ? 'sleep' : 'running'}
        onPolicy={(policy) => {
          if (policy === 'sleep') void check();
          else {
            setReview(null);
            setError('');
          }
        }}
        disabled={disabled || loading}
      >
        {loading && (
          <Caption role="status" className="text-xs">
            Checking whether this preset&apos;s paths can sleep…
          </Caption>
        )}
        {review &&
          (review.plan ? (
            <div className="grid gap-2 border-t border-border pt-2">
              <Caption className="text-xs">
                {review.plan.branches.length}{' '}
                {review.plan.branches.length === 1 ? 'path' : 'paths'} can sleep
                after their tails fade. This saves and plays a revised copy of
                the preset
                {review.inserted_sends.length
                  ? `, with ${review.inserted_sends.length} ${review.inserted_sends.length === 1 ? 'send' : 'sends'} added so each path stands on its own`
                  : ''}
                .
              </Caption>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={disabled || protect}
                  onClick={prepare}
                >
                  Prepare and sleep
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReview(null)}
                >
                  Keep running
                </Button>
              </div>
            </div>
          ) : (
            <Caption role="status" className="text-xs">
              {review.reason ??
                'These paths cannot sleep on their own, so they keep running.'}
            </Caption>
          ))}
        {error && (
          <Caption role="alert" className="text-xs text-danger-ink">
            {error}
          </Caption>
        )}
      </SilentBranches>
    </section>
  );
}
