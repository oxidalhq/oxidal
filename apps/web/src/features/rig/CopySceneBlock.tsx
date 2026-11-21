import { useEffect, useRef, useState } from 'react';

import {
  CopySceneBlockDialog,
  type SceneBlockCopySelection,
} from '@oxidal/design-system/widgets/copy-scene-block';

import {
  installedLv2,
  type Lv2Plugin,
  presetVersions,
  publishRig,
  type RigDocument,
  type VersionView,
} from '../../api';
import { errorRecovery, friendlyError } from '../../lib/friendlyError';
import {
  planSceneBlockCopy,
  publishSceneBlockCopy,
  sceneBlockChoices,
} from '../../sceneBlockCopy';

export function CopySceneBlock({
  document,
  sourceId,
  sourceName,
  rate,
  onClose,
  onDone,
}: {
  document: RigDocument;
  sourceId: string;
  sourceName: string;
  rate: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  // Keep the exact saved version opened for review until the player closes it.
  const [opening] = useState(document);
  const choices = sceneBlockChoices(opening, sourceId);
  const [selection, setSelection] = useState<SceneBlockCopySelection>(() => ({
    sourceBlock: choices.sourceBlocks[0]?.id ?? '',
    destinationScene: '',
    destinationBlock: choices.sourceBlocks[0]?.id ?? '',
    version: '',
  }));
  const [view, setView] = useState<VersionView>();
  const [plugins, setPlugins] = useState<Lv2Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const receipt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      presetVersions('rig', opening.revision),
      installedLv2(rate),
    ])
      .then(([next, catalog]) => {
        if (!active) return;
        setView(next);
        setPlugins(catalog);
        const relevant = next.preset.versions.filter(
          (v) => v.content === opening.revision,
        );
        const first =
          relevant.find((v) => v.id === next.preset.default_version) ??
          relevant[0];
        setSelection((old) => ({ ...old, version: first?.id ?? '' }));
        if (!first)
          setError(
            'This saved version changed. Reopen it from Library to review the current settings.',
          );
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            friendlyError(
              cause,
              'read this preset’s saved versions and effect settings',
            ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [opening.revision, rate]);
  const versions =
    view?.preset.versions.filter((v) => v.content === opening.revision) ?? [];
  const changedRig = opening.revision !== document.revision;
  const preview =
    !loading &&
    selection.sourceBlock &&
    selection.destinationScene &&
    selection.destinationBlock
      ? planSceneBlockCopy(opening, sourceId, selection, plugins)
      : null;
  async function save() {
    const version = versions.find((option) => option.id === selection.version);
    if (
      saving ||
      stale ||
      changedRig ||
      !view ||
      !version ||
      !preview ||
      'refusal' in preview
    )
      return;
    setSaving(true);
    setError('');
    try {
      const key = JSON.stringify([view.catalog_revision, selection]);
      if (receipt.current?.key !== key)
        receipt.current = { key, id: crypto.randomUUID() };
      await publishRig(
        publishSceneBlockCopy(opening, preview, {
          first: view.preset.logical_id.slice('rig:'.length),
          version: version.id,
          expected_content: opening.revision,
          expected_revision: view.catalog_revision,
          request_id: receipt.current.id,
        }),
      );
      const destination = choices.destinationScenes.find(
        (scene) => scene.id === preview.destinationScene,
      );
      onClose();
      onDone(
        `Copied settings to ${destination?.name ?? 'the destination scene'} in ${version.name}.`,
      );
    } catch (cause) {
      if (errorRecovery(cause) === 'refresh') {
        setStale(true);
        setError(
          'The saved version changed. Reopen it from Library to review the current settings.',
        );
      } else {
        setError(friendlyError(cause, 'save the copied block settings'));
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <CopySceneBlockDialog
      sourceScene={sourceName}
      {...choices}
      versions={versions}
      selection={selection}
      preview={preview}
      loading={loading}
      saving={saving}
      disabled={changedRig || stale}
      error={
        changedRig
          ? 'The playing preset changed. Reopen the copy dialog from the current rig.'
          : error
      }
      onChange={setSelection}
      onCancel={onClose}
      onCopy={() => void save()}
    />
  );
}
