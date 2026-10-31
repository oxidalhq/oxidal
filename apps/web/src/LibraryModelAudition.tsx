import { useEffect, useRef, useState } from 'react';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  type AudioState,
  type RigAudioState,
} from './api';
import { assertAuditionOwner } from './rigControls';
import { Button } from './components/ui/button';

type Owner =
  | { kind: 'native'; state: AudioState }
  | { kind: 'mixed'; state: RigAudioState };
type Target = { key: string; target: string; node?: string; label: string };
function targets(owner: Owner): Target[] {
  const nodes =
    owner.kind === 'native'
      ? [{ node: undefined, status: owner.state.authoring }]
      : (owner.state.control?.authoring ?? []);
  return nodes.flatMap(({ node, status }) =>
    (['left', 'right'] as const).flatMap((lane) =>
      (status?.layout[lane] ?? [])
        .filter((b) => !b.insert)
        .map((block) => {
          const parameter = `block:${block.id}:enabled`;
          const control =
            owner.kind === 'native'
              ? owner.state.controls.find((c) => c.target === parameter)
              : owner.state.control?.controls.find(
                  (c) =>
                    c.target.kind === 'native' &&
                    c.target.node === node &&
                    c.target.parameter === parameter,
                );
          const name =
            control?.label.replace(/(?: · (?:left|right))? · enabled$/, '') ||
            block.id;
          return {
            key: `${node ?? ''}/${block.id}`,
            target: block.id,
            node,
            label: `${lane === 'left' ? 'Left' : 'Right'} chain · ${name}`,
          };
        }),
    ),
  );
}

/** Uses the same revision-checked preparation operations as the Rig model picker.
 * @see docs/native-tone3000.md
 */
export function LibraryModelAudition({
  asset,
  onOpenRig,
}: {
  asset: string;
  onOpenRig: () => void;
}) {
  const [owner, setOwner] = useState<Owner | null>(null);
  const [choice, setChoice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void Promise.all([playbackState(), rigAudioState()])
      .then(([native, mixed]) => {
        if (!alive.current) return;
        const current: Owner | null =
          native.phase === 'running'
            ? { kind: 'native', state: native }
            : mixed.phase === 'running'
              ? { kind: 'mixed', state: mixed }
              : null;
        setOwner(current);
        setChoice('');
      })
      .catch((cause: unknown) => {
        if (alive.current) setError(String(cause));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const options = owner ? targets(owner) : [];
  async function audition() {
    const target = options.find((t) => t.key === choice);
    if (!owner || !target || busy || applied) return;
    setBusy(true);
    setError('');
    setMessage('Preparing audition…');
    try {
      let request: number | undefined;
      if (owner.kind === 'native') {
        const current = await playbackState();
        assertAuditionOwner(
          owner.state,
          current,
          undefined,
          current.model_change,
        );
        if (current.phase !== 'running')
          throw new Error(
            'The playing rig changed. Close and reopen this preview.',
          );
        const next = await playbackCommand(current, {
          kind: 'replace_model',
          assignment: { target: target.target, asset },
        });
        request = next.model_change?.request;
      } else {
        const current = await rigAudioState();
        assertAuditionOwner(
          owner.state,
          current,
          undefined,
          current.control?.model_change?.progress,
        );
        if (
          current.phase !== 'running' ||
          !current.control ||
          current.control.session !== owner.state.control?.session
        )
          throw new Error(
            'The playing rig changed. Close and reopen this preview.',
          );
        const next = await rigAudioCommand(current, {
          kind: 'model',
          command: {
            session: current.control.session,
            expected_revision: current.control.revision,
            node: target.node!,
            operation: {
              kind: 'prepare',
              assignment: { target: target.target, asset },
            },
          },
        });
        request = next.control?.model_change?.progress.request;
      }
      if (request == null)
        throw new Error('The rig did not accept this audition.');
      for (let i = 0; i < 150 && alive.current; i++) {
        const current =
          owner.kind === 'native'
            ? await playbackState()
            : await rigAudioState();
        const progress =
          'model_change' in current
            ? current.model_change
            : 'control' in current
              ? current.control?.model_change?.progress
              : null;
        if (
          current.session !== owner.state.session ||
          progress?.request !== request
        )
          throw new Error(
            'The playing rig changed. Open Rig to check its current sound.',
          );
        if (progress.phase === 'applied') {
          if (alive.current) {
            setApplied(true);
            setMessage(
              'Auditioning this model. Closing keeps the change; Undo in Rig restores it.',
            );
          }
          return;
        }
        if (progress.phase === 'failed' || progress.phase === 'cancelled')
          throw new Error(progress.error || 'Audition could not be prepared.');
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (alive.current)
        setMessage('Preparation is still running. Open Rig to check progress.');
    } catch (cause) {
      if (alive.current) {
        setError(String(cause));
        setMessage('');
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="library-audition" aria-label="Audio audition">
      <h3>Audio audition</h3>
      {loading ? (
        <p className="caption">Reading the playing rig…</p>
      ) : options.length ? (
        <>
          <p className="caption">
            Choose a block in the playing rig. Audition changes that block; Undo
            in Rig restores it.
          </p>
          <label className="field">
            Replace block
            <select
              value={choice}
              disabled={busy || applied}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="" disabled>
                Choose a block…
              </option>
              {options.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || applied || !choice}
              onClick={() => void audition()}
            >
              {busy ? 'Preparing…' : 'Audition'}
            </Button>
            <Button variant="ghost" onClick={onOpenRig}>
              Open Rig
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="caption">
            Start a native or mixed rig to audition this model.
          </p>
          <Button variant="outline" onClick={onOpenRig}>
            Open Rig
          </Button>
        </>
      )}
      {message && (
        <p role="status" className="caption">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="caption">
          {error}
        </p>
      )}
    </section>
  );
}
