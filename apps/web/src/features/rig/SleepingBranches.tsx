import { Switch } from '@oxidal/design-system/components/switch';

import { useState } from 'react';
import { Button } from '@oxidal/design-system/components/button';
import { rigSleepPlan, type RigSleepPlan, type RigAudioState } from '../../api';
import { useProtect } from '../../components/media/sessionMedia';
type Control = NonNullable<RigAudioState['control']>;
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
  const sceneName = (id: string) =>
    control.scenes?.scenes.find((s) => s.id === id)?.name ?? id;
  return (
    <section
      aria-label="Branch processing"
      className="space-y-2 rounded-lg border border-border p-3"
    >
      <label className="flex items-center justify-between gap-3">
        Sleep silent branches
        <Switch
          aria-label="Sleep silent branches"
          checked={sleep.enabled}
          disabled={disabled || protect}
          onCheckedChange={onChange}
        />
      </label>
      <p>
        {sleep.running_processors} of {sleep.admitted_processors} admitted
        processors running
      </p>
      {sleep.active_scene && <p>Playing {sceneName(sleep.active_scene)}</p>}
      {sleep.requested_scene &&
        sleep.requested_scene !== sleep.active_scene && (
          <p role="status">Preparing {sceneName(sleep.requested_scene)}</p>
        )}
      <ul>
        {sleep.branches.map((branch) => (
          <li key={branch.branch}>
            {control.branches?.find((b) => b.id === branch.branch)?.name ??
              branch.branch}{' '}
            · {branch.phase}
          </li>
        ))}
      </ul>
      {sleep.message && <p role="status">{sleep.message}</p>}
    </section>
  );
}

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
  const protect = useProtect(true);
  async function check() {
    setLoading(true);
    setError('');
    try {
      setReview(await rigSleepPlan(revision));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not read this rig.',
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <section aria-label="Branch processing" className="space-y-2">
      {review ? (
        <>
          {review.plan ? (
            <>
              <p>
                {review.plan.branches.length} branches can sleep after their
                tails fade. Preparing them saves and plays a revised rig.
              </p>
              <ul>
                {review.inserted_sends.map((send) => (
                  <li key={send.node}>
                    Add a send from {send.from.node} to {send.to.node}
                  </li>
                ))}
              </ul>
              <Button disabled={disabled || protect} onClick={prepare}>
                Prepare sleeping branches
              </Button>
            </>
          ) : (
            <p role="status">
              {review.reason ?? 'These branches cannot sleep independently.'}
            </p>
          )}
          <Button onClick={() => setReview(null)}>Close review</Button>
        </>
      ) : (
        <Button disabled={disabled || loading} onClick={() => void check()}>
          Check sleeping branches
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
