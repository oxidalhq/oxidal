import { useEffect, useState } from 'react';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import {
  publishRig,
  rigDocument,
  rigLibrary,
  type RigDocument,
  type RigPage,
} from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import {
  LAST_SCENE,
  MAX_SCENES,
  copySceneTo,
  deleteScene,
  duplicateScene,
  moveScene,
  renameScene,
  sceneCopyPlan,
  type SceneCopyPlan,
} from '../../sceneEdit';
import type { RigViewProps } from './useMixedRigSession';
import { rigBusy } from './mixedRigViewModel';

type Step =
  | { kind: 'menu' }
  | { kind: 'rename'; value: string }
  | { kind: 'delete' }
  | { kind: 'last' }
  | { kind: 'copy' };

/**
 * The scene menu (⋯ or hold a pad, or Scene ⋯ for the playing scene):
 * Rename, Duplicate scene, Copy to preset…, Move left, Move right, Delete….
 * Each change saves the preset through the scene save path; MIDI bindings
 * name the scene, so they follow it when it moves (S-13). The last scene
 * cannot be deleted (S-12). Copy to preset… shows what is skipped before
 * anything is copied (S-11).
 * @see docs/interface.md
 */
export function SceneMenu({
  rig,
  vm,
  sceneId,
  onClose,
  onDone,
}: RigViewProps & {
  sceneId: string;
  onClose: () => void;
  /** A plain-language result for the scene status line. */
  onDone: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'menu' });
  const scenes = vm.state.control?.scenes?.scenes ?? [];
  const index = scenes.findIndex((s) => s.id === sceneId);
  const scene = scenes[index];
  if (!scene) return null;
  const pending = vm.draftCount > 0 || vm.sceneMixChanged;
  const blocked = rigBusy(vm, rig) || pending;
  /** Saves the preset with one scene change, then reports it. */
  const save = (make: Parameters<typeof rig.rebuild>[0], message: string) => {
    onClose();
    const before = rig.current.current?.configured?.revision;
    void Promise.resolve(rig.rebuild(make)).then(() => {
      // Only a saved change is reported; a failure shows its own error.
      if (rig.current.current?.configured?.revision !== before) onDone(message);
    });
  };
  if (step.kind === 'rename')
    return (
      <AdjustmentDialog title="Rename scene" onCancel={onClose}>
        <form
          className="control-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const label = step.value.trim();
            if (!label) return;
            save(
              ({ opened, live, name }) =>
                renameScene(opened, sceneId, label, live, name),
              `Renamed scene ${index + 1} to ${label}.`,
            );
          }}
        >
          <label className="field">
            <span>Scene name</span>
            <input
              className="h-11 w-full rounded-md border border-input bg-card px-3"
              value={step.value}
              maxLength={128}
              autoFocus
              onChange={(event) =>
                setStep({ kind: 'rename', value: event.target.value })
              }
            />
          </label>
          <div className="action-row">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!step.value.trim()}>
              Rename
            </Button>
          </div>
        </form>
      </AdjustmentDialog>
    );
  if (step.kind === 'last')
    return (
      <AdjustmentDialog title="Cannot delete" onCancel={onClose}>
        <p role="alert">{LAST_SCENE}</p>
        <div className="action-row">
          <Button onClick={onClose}>OK</Button>
        </div>
      </AdjustmentDialog>
    );
  if (step.kind === 'delete')
    return (
      <AdjustmentDialog
        title={`Delete scene "${scene.name}"?`}
        onCancel={onClose}
      >
        <p>Its MIDI binding is removed too.</p>
        <div className="action-row">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              save(
                ({ opened, live, name }) =>
                  deleteScene(
                    opened,
                    sceneId,
                    rig.current.current?.control?.scene ?? undefined,
                    live,
                    name,
                  ),
                `Scene ${scene.name} deleted.`,
              )
            }
          >
            Delete
          </Button>
        </div>
      </AdjustmentDialog>
    );
  if (step.kind === 'copy')
    return (
      <CopyToPreset
        source={rig.matching}
        sceneId={sceneId}
        sceneName={scene.name}
        onClose={onClose}
        onDone={onDone}
      />
    );
  const items: [string, () => void, boolean?][] = [
    ['Rename', () => setStep({ kind: 'rename', value: scene.name })],
    [
      'Duplicate scene',
      () =>
        save(
          ({ opened, live, name }) =>
            duplicateScene(opened, sceneId, live, name).publish,
          `Duplicated as scene ${index + 2}.`,
        ),
      scenes.length >= MAX_SCENES,
    ],
    ['Copy to preset…', () => setStep({ kind: 'copy' }), !rig.matching],
    [
      'Move left',
      () =>
        save(
          ({ opened, live, name }) =>
            moveScene(opened, sceneId, -1, live, name),
          'Moved. MIDI bindings follow the scene, not its position.',
        ),
      index === 0,
    ],
    [
      'Move right',
      () =>
        save(
          ({ opened, live, name }) => moveScene(opened, sceneId, 1, live, name),
          'Moved. MIDI bindings follow the scene, not its position.',
        ),
      index === scenes.length - 1,
    ],
    [
      'Delete…',
      () => setStep({ kind: scenes.length <= 1 ? 'last' : 'delete' }),
    ],
  ];
  return (
    <AdjustmentDialog
      title={`Scene ${index + 1}: ${scene.name}`}
      onCancel={onClose}
    >
      <div className="menu-list" role="menu" aria-label={`Scene ${scene.name}`}>
        {items.map(([label, run, off]) => (
          <button
            key={label}
            type="button"
            role="menuitem"
            disabled={!!off || (blocked && label !== 'Copy to preset…')}
            onClick={run}
          >
            {label}
          </button>
        ))}
      </div>
      {pending && (
        <p className="caption">
          Save or discard your scene updates first to change the scenes.
        </p>
      )}
      <p className="caption">
        MIDI bindings follow the scene, not its position.
      </p>
    </AdjustmentDialog>
  );
}

/** Copy to preset…: choose a preset in Mine, see what differs, then copy. */
function CopyToPreset({
  source,
  sceneId,
  sceneName,
  onClose,
  onDone,
}: {
  source: RigDocument | null;
  sceneId: string;
  sceneName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [targets, setTargets] = useState<RigPage['presets'] | null>(null);
  const [chosen, setChosen] = useState('');
  const [target, setTarget] = useState<RigDocument | null>(null);
  const [plan, setPlan] = useState<SceneCopyPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const found: RigPage['presets'] = [];
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await rigLibrary(after);
        found.push(...result.presets);
        if (!result.next) break;
        after = result.next;
      }
      return found;
    })()
      .then((presets) => {
        if (!alive) return;
        setTargets(
          presets.filter(
            (p) =>
              p.origin === 'mine' &&
              (p.scenes?.length ?? 0) > 0 &&
              p.revision !== source?.revision,
          ),
        );
      })
      .catch((cause: unknown) => {
        if (alive) setError(friendlyError(cause, 'read your presets'));
      });
    return () => {
      alive = false;
    };
  }, [source?.revision]);
  useEffect(() => {
    if (!chosen || !source) return;
    let alive = true;
    void rigDocument(chosen)
      .then((document) => {
        if (!alive) return;
        setTarget(document);
        setPlan(sceneCopyPlan(source, sceneId, document));
      })
      .catch((cause: unknown) => {
        if (alive) setError(friendlyError(cause, 'read that preset'));
      });
    return () => {
      alive = false;
    };
  }, [chosen, source, sceneId]);
  async function copy() {
    if (!source || !target) return;
    setBusy(true);
    setError('');
    try {
      await publishRig(copySceneTo(source, sceneId, target));
      const count =
        (
          target.manifest.extensions['urn:oxidal:scenes:1'] as
            { scenes?: unknown[] } | undefined
        )?.scenes?.length ?? 0;
      onClose();
      onDone(
        `"${sceneName}" copied to ${target.manifest.name} as scene ${count + 1}.`,
      );
    } catch (cause) {
      setError(friendlyError(cause, 'copy this scene'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog title="Copy to preset" onCancel={onClose}>
      <div className="control-stack">
        <label className="field">
          <span>Copy &apos;{sceneName}&apos; to</span>
          <select
            className="h-11 w-full rounded-md border border-input bg-card px-3"
            value={chosen}
            disabled={!targets?.length}
            onChange={(event) => {
              setPlan(null);
              setTarget(null);
              setError('');
              setChosen(event.target.value);
            }}
          >
            <option value="">Choose a preset…</option>
            {(targets ?? []).map((p) => (
              <option key={p.revision} value={p.revision}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {targets && !targets.length && (
          <p className="caption">
            No other preset in Mine has scenes to copy into.
          </p>
        )}
        {plan && (
          <ul className="scene-copy-plan" aria-label="What copies">
            {plan.refused ? (
              <li role="alert">{plan.refused}</li>
            ) : plan.exact ? (
              <li>✓ Same blocks: settings copy exactly.</li>
            ) : (
              <>
                {plan.skipped.map((line) => (
                  <li key={line}>⚠ {line}</li>
                ))}
                {plan.kept.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </>
            )}
          </ul>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="action-row">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!plan || !!plan.refused || busy}
            onClick={() => void copy()}
          >
            Copy
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}
