import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { NumberField } from '@oxidal/design-system/components/number-field';
import { Switch } from '@oxidal/design-system/components/switch';
import { sceneColour } from '@oxidal/design-system/lib/scene-colours';
import { DockableSheet } from '@oxidal/design-system/patterns/tool-dock';
import { SceneBlockActions } from '@oxidal/design-system/widgets/scene-editor';

import { blockLabel } from '../../sceneEdit';
import {
  canPreviewNativeBypass,
  nativeBypassKey,
} from '../../sceneNativeBypass';
import { scenePedalCopies } from '../../scenePedalCopy';
import { DuplicateScenePedal } from './DuplicateScenePedal';
import { rigBusy } from './mixedRigViewModel';
import type { RigViewProps } from './useMixedRigSession';

/** Scene drafts use exact graph node and merge input identities, never display projections. */
export function SceneGrid({
  rig,
  vm,
  open,
  onOpenChange,
}: RigViewProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copy, setCopy] = useState<{
    node: string;
    name: string;
    source: string;
  }>();
  const [copyNotice, setCopyNotice] = useState('');
  const control = vm.state.control;
  if (!control?.scenes || !rig.matching) return null;
  const manifest = rig.matching.manifest;
  const source = control.stomp_scene ?? control.scene;
  const draft =
    rig.sceneUpdates?.session === control.session ? rig.sceneUpdates : null;
  const scenes = [...control.scenes.scenes, ...(draft?.added ?? [])];
  const nodes =
    manifest.oxidal?.graph.nodes.filter(
      (n) => n.kind === 'lv2' || n.kind === 'tone3000',
    ) ?? [];
  const nativeRows = [
    ...new Map(
      [
        ...(control.native_bypass_defaults ?? []),
        ...scenes.flatMap((scene) => scene.native_bypass ?? []),
      ].map((row) => [nativeBypassKey(row), row]),
    ).values(),
  ];
  const nativeDefaults = new Map(
    control.native_bypass_defaults?.map((row) => [
      nativeBypassKey(row),
      row.value,
    ]),
  );
  const disabled = rigBusy(vm, rig) || rig.sceneSharing.conflict;
  const gains = [
    ...new Map(
      scenes.flatMap((s) =>
        s.gains.map((g) => [`${g.node}:${g.port}`, g] as const),
      ),
    ).values(),
  ];
  const gainOf = (scene: (typeof scenes)[number], node: string, port: number) =>
    (draft?.gains[scene.id] ?? scene.gains).find(
      (g) => g.node === node && g.port === port,
    )?.value ?? 0;
  const setGain = (
    scene: (typeof scenes)[number],
    node: string,
    port: number,
    value: number,
  ) => {
    rig.setSceneUpdates({
      ...(draft ?? { session: control.session, gains: {} }),
      gains: {
        ...draft?.gains,
        [scene.id]: (draft?.gains[scene.id] ?? scene.gains).map((g) =>
          g.node === node && g.port === port ? { ...g, value } : g,
        ),
      },
    });
  };
  if (copy && open)
    return (
      <DuplicateScenePedal
        document={rig.matching}
        cursor={{
          session: control.session,
          revision: control.revision,
          preset: control.source_revision,
        }}
        {...copy}
        onReadback={rig.accept}
        onClose={() => setCopy(undefined)}
        onSaved={(message) => {
          setCopy(undefined);
          setCopyNotice(message);
        }}
      />
    );
  const canCopy = scenePedalCopies(rig.matching);
  return (
    <DockableSheet
      id="scenes"
      title="Edit scenes"
      description="Blocks and branch levels across scenes. Changes are shared drafts; Save scenes keeps them in this preset."
      className="md:w-[min(64rem,100vw)]"
      open={open}
      onOpenChange={onOpenChange}
    >
      {rig.sceneSharing.conflict && (
        <p role="alert" className="mb-3 text-sm">
          Your scene draft is kept here. Close this sheet to review and choose
          which draft to share.
        </p>
      )}
      <div className="max-w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Which blocks and routing inputs play in each scene
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-card p-3 text-left"
              >
                Block or routing input
              </th>
              {scenes.map((scene, i) => (
                <th scope="col" key={scene.id} className="p-1">
                  <Button
                    variant={control.scene === scene.id ? 'default' : 'ghost'}
                    disabled={
                      disabled ||
                      !control.scenes?.scenes.some((s) => s.id === scene.id) ||
                      !canPreviewNativeBypass(
                        draft?.native_bypass?.[scene.id],
                        control.native_bypass_armed,
                      )
                    }
                    title={
                      !canPreviewNativeBypass(
                        draft?.native_bypass?.[scene.id],
                        control.native_bypass_armed,
                      )
                        ? 'Save scenes to prepare new capture blocks'
                        : control.scenes?.scenes.some((s) => s.id === scene.id)
                          ? undefined
                          : 'Save scenes before playing this new scene'
                    }
                    onClick={() => void rig.recallScene(scene.id)}
                    className="min-w-20 border-t-4"
                    style={{ borderTopColor: sceneColour(i) }}
                  >
                    {scene.name}
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const label = vm.describeNode(node).block.label;
              return (
                <tr key={node.id} className="border-b border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium"
                  >
                    <span className="flex items-center gap-1">
                      {label}
                      {source && canCopy.has(node.id) && (
                        <SceneBlockActions
                          label={label}
                          disabled={disabled || !!draft || control.modified}
                          onDuplicate={() =>
                            setCopy({
                              node: node.id,
                              name: label,
                              source,
                            })
                          }
                        />
                      )}
                    </span>
                  </th>
                  {scenes.map((scene) => {
                    const bypass =
                      draft?.bypass?.[scene.id]?.find((b) => b.node === node.id)
                        ?.value ??
                      scene.bypass?.find((b) => b.node === node.id)?.value ??
                      node.bypassed ??
                      false;
                    return (
                      <td key={scene.id} className="p-1 text-center">
                        <Button
                          variant={bypass ? 'ghost' : 'outline'}
                          aria-label={`${label} in ${scene.name}`}
                          aria-pressed={!bypass}
                          disabled={disabled}
                          onClick={() => {
                            const entries = new Map(
                              (
                                draft?.bypass?.[scene.id] ??
                                scene.bypass ??
                                []
                              ).map((b) => [b.node, b.value]),
                            );
                            entries.set(node.id, !bypass);
                            rig.setSceneUpdates({
                              ...(draft ?? {
                                session: control.session,
                                gains: {},
                              }),
                              bypass: {
                                ...draft?.bypass,
                                [scene.id]: [...entries].map(
                                  ([node, value]) => ({ node, value }),
                                ),
                              },
                            });
                          }}
                        >
                          {bypass ? 'Off' : 'On'}
                        </Button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {nativeRows.map((row) => {
              const key = nativeBypassKey(row);
              const live = control.controls.find(
                (candidate) =>
                  candidate.target.kind === 'native' &&
                  candidate.target.node === row.node &&
                  candidate.target.parameter === `block:${row.block}:enabled`,
              );
              const label = `${blockLabel(manifest, row.node)} · ${live?.label ?? row.block}`;
              const armed =
                control.native_bypass_armed?.some(
                  (candidate) => nativeBypassKey(candidate) === key,
                ) ?? false;
              return (
                <tr key={`native:${key}`} className="border-b border-border">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-2 pl-6 text-left font-medium"
                  >
                    {label}
                    {!armed && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        Prepared when scenes are saved
                      </span>
                    )}
                  </th>
                  {scenes.map((scene) => {
                    const value =
                      draft?.native_bypass?.[scene.id]?.find(
                        (candidate) => nativeBypassKey(candidate) === key,
                      )?.value ??
                      scene.native_bypass?.find(
                        (candidate) => nativeBypassKey(candidate) === key,
                      )?.value ??
                      nativeDefaults.get(key);
                    return (
                      <td key={scene.id} className="p-1 text-center">
                        <Button
                          variant={value ? 'ghost' : 'outline'}
                          aria-label={`${label} in ${scene.name}`}
                          aria-pressed={value === false}
                          disabled={disabled || value === undefined}
                          title={
                            value === undefined
                              ? 'Saved capture block state unavailable'
                              : undefined
                          }
                          onClick={() => {
                            const entries = new Map(
                              (
                                draft?.native_bypass?.[scene.id] ??
                                scene.native_bypass ??
                                []
                              ).map((candidate) => [
                                nativeBypassKey(candidate),
                                candidate,
                              ]),
                            );
                            entries.set(key, {
                              node: row.node,
                              block: row.block,
                              value: !value,
                            });
                            rig.setSceneUpdates({
                              ...(draft ?? {
                                session: control.session,
                                gains: {},
                              }),
                              native_bypass: {
                                ...draft?.native_bypass,
                                [scene.id]: [...entries.values()],
                              },
                            });
                          }}
                        >
                          {value === undefined
                            ? 'Unknown'
                            : value
                              ? 'Off'
                              : 'On'}
                        </Button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {control.scenes.branches?.map((branch) => (
              <tr key={branch.id} className="border-b border-border">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium"
                >
                  {branch.name} branch
                </th>
                {scenes.map((scene) => {
                  const today = draft?.gains[scene.id] ?? scene.gains;
                  const matches = (
                    a: { node: string; port: number },
                    b: { node: string; port: number },
                  ) => a.node === b.node && a.port === b.port;
                  const owns = (gain: { node: string; port: number }) =>
                    branch.gains.some((target) => matches(target, gain));
                  const current = today.filter(owns);
                  const complete =
                    branch.gains.length > 0 &&
                    branch.gains.every((gain) =>
                      current.some((target) => matches(target, gain)),
                    );
                  const on = current.some((gain) => gain.value !== 0);
                  const saved = scene.gains.filter(owns);
                  const restore = saved.some((gain) => gain.value !== 0)
                    ? saved
                    : branch.gains;
                  return (
                    <td key={scene.id} className="px-2 py-1 text-center">
                      <Switch
                        aria-label={`${branch.name} branch in ${scene.name}`}
                        checked={on}
                        disabled={disabled || !complete}
                        onCheckedChange={(enabled) => {
                          rig.setSceneUpdates({
                            ...(draft ?? {
                              session: control.session,
                              gains: {},
                            }),
                            gains: {
                              ...draft?.gains,
                              [scene.id]: today.map((gain) =>
                                owns(gain)
                                  ? {
                                      ...gain,
                                      value: enabled
                                        ? (restore.find((target) =>
                                            matches(target, gain),
                                          )?.value ?? 0)
                                        : 0,
                                    }
                                  : gain,
                              ),
                            },
                          });
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {gains.map((gain) => (
              <tr
                key={`${gain.node}:${gain.port}`}
                className="border-b border-border"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium"
                >
                  {blockLabel(manifest, gain.node)} · input {gain.port + 1}
                </th>
                {scenes.map((scene) => {
                  const value = gainOf(scene, gain.node, gain.port);
                  const saved =
                    scene.gains.find(
                      (g) => g.node === gain.node && g.port === gain.port,
                    )?.value ?? 0;
                  return (
                    <td key={scene.id} className="min-w-28 p-1">
                      <NumberField
                        label={`${gain.node} input ${gain.port + 1} in ${scene.name}`}
                        value={
                          value === 0 ? -60 : 20 * Math.log10(Math.abs(value))
                        }
                        min={-60}
                        max={12.04}
                        step={0.5}
                        digits={1}
                        unit=" dB"
                        disabled={disabled}
                        onChange={(db) =>
                          setGain(
                            scene,
                            gain.node,
                            gain.port,
                            db <= -60
                              ? 0
                              : (value < 0 || (value === 0 && saved < 0)
                                  ? -1
                                  : 1) *
                                  10 ** (db / 20),
                          )
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {copyNotice && <p role="status">{copyNotice}</p>}
      <p className="mt-3 text-sm text-muted-foreground">
        Each branch input has its own level and polarity. Switching on restores
        its saved levels or the branch’s default levels. Save scenes keeps these
        changes in the preset. Edited capture block states are played after Save
        prepares them.
      </p>
      <Button
        className="mt-3"
        disabled={disabled || !draft}
        onClick={() => void rig.saveScenes(false)}
      >
        Save scenes
      </Button>
    </DockableSheet>
  );
}
