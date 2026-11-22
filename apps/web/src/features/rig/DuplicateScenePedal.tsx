import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { FormField } from '@oxidal/design-system/components/form-layout';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  presetVersions,
  protectState,
  publishRig,
  type RigAudioState,
  rigAudioState,
  type RigDocument,
  type VersionView,
} from '../../api';
import { errorRecovery, friendlyError } from '../../lib/friendlyError';
import { readScenes } from '../../sceneFormat';
import { duplicateScenePedal } from '../../scenePedalCopy';

type Cursor = { session: string; revision: number; preset: string };

export function DuplicateScenePedal({
  document,
  cursor,
  source,
  node,
  name,
  onClose,
  onReadback,
  onSaved,
}: {
  document: RigDocument;
  cursor: Cursor;
  source: string;
  node: string;
  name: string;
  onClose: () => void;
  onReadback: (state: RigAudioState) => void;
  onSaved: (message: string) => void;
}) {
  const [opening] = useState(() => ({ document, cursor }));
  const [view, setView] = useState<VersionView>();
  const [versionId, setVersionId] = useState('');
  const [target, setTarget] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const receipt = useRef<{ key: string; id: string } | null>(null);
  const scenes =
    readScenes<{ scenes: { id: string; name: string }[] }>(
      opening.document.manifest,
    )?.scenes ?? [];
  const versionChoices =
    view?.preset.versions.filter(
      (version) => version.content === opening.document.revision,
    ) ?? [];
  const changed =
    cursor.session !== opening.cursor.session ||
    cursor.revision !== opening.cursor.revision ||
    cursor.preset !== opening.cursor.preset ||
    document.revision !== opening.document.revision;
  useEffect(() => {
    let active = true;
    void presetVersions('rig', opening.document.revision)
      .then((next) => {
        if (!active) return;
        setView(next);
        const current = next.preset.versions.filter(
          (version) => version.content === opening.document.revision,
        );
        setVersionId(
          current.find((v) => v.id === next.preset.default_version)?.id ??
            current[0]?.id ??
            '',
        );
        if (!current.length)
          setError('This saved version changed. Reopen the scene editor.');
      })
      .catch((cause) => {
        if (active) setError(friendlyError(cause, 'read saved versions'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [opening.document.revision]);

  async function save() {
    const version = versionChoices.find((entry) => entry.id === versionId);
    if (!view || !version || !target || pending.current || changed || stale)
      return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const [live, protection] = await Promise.all([
        rigAudioState(),
        protectState(),
      ]);
      if (protection.on)
        throw new Error('Turn Protect off to duplicate an effect.');
      if (
        live.phase !== 'running' ||
        live.configured?.revision !== opening.cursor.preset ||
        live.control?.session !== opening.cursor.session ||
        live.control?.revision !== opening.cursor.revision ||
        live.control.modified
      ) {
        onReadback(live);
        setStale(true);
        return;
      }

      const key = JSON.stringify([version.id, target]);
      if (receipt.current?.key !== key)
        receipt.current = { key, id: crypto.randomUUID() };
      await publishRig(
        duplicateScenePedal(opening.document, node, source, target, {
          first: view.preset.logical_id.slice('rig:'.length),
          version: version.id,
          expected_content: opening.document.revision,
          expected_revision: view.catalog_revision,
          request_id: receipt.current.id,
        }),
      );
      const destination = scenes.find((scene) => scene.id === target)?.name;
      onSaved(
        `Duplicate saved in ${version.name}, on in ${destination}. Open the saved version to hear it.`,
      );
    } catch (cause) {
      if (errorRecovery(cause) === 'refresh') setStale(true);
      else setError(friendlyError(cause, 'save the duplicated effect'));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <AdjustmentDialog
      title={`Duplicate ${name}`}
      onCancel={() => {
        if (!pending.current) onClose();
      }}
    >
      <p>
        Copies the saved settings from{' '}
        {scenes.find((scene) => scene.id === source)?.name}. The duplicate is
        bypassed in every other scene.
      </p>
      {(changed || stale) && (
        <p role="alert">
          The playing rig or saved version changed. Reopen the scene editor.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <FormField>
        Destination scene
        <select
          value={target}
          disabled={saving || changed || stale}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">Choose a scene</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField>
        Saved version
        <select
          value={versionId}
          disabled={loading || saving || changed || stale}
          onChange={(event) => setVersionId(event.target.value)}
        >
          {!versionChoices.length && <option value="">Unavailable</option>}
          {versionChoices.map((version) => (
            <option key={version.id} value={version.id}>
              {version.name}
            </option>
          ))}
        </select>
      </FormField>
      <div className="mt-2 flex flex-wrap gap-2 [&>button]:min-h-[48px] [&>button]:min-w-[48px]">
        <Button variant="outline" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={
            loading || saving || changed || stale || !target || !versionId
          }
          onClick={() => void save()}
        >
          Duplicate and save
        </Button>
      </div>
    </AdjustmentDialog>
  );
}
