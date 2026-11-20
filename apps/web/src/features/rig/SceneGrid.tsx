import { Button } from '@oxidal/design-system/components/button';
import { NumberField } from '@oxidal/design-system/components/number-field';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '@oxidal/design-system/components/sheet';
import { sceneColour } from '@oxidal/design-system/lib/scene-colours';

import { blockLabel } from '../../sceneEdit';
import {
  canPreviewNativeBypass,
  nativeBypassKey,
} from '../../sceneNativeBypass';
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
  const control = vm.state.control;
  if (!control?.scenes || !rig.matching) return null;
  const manifest = rig.matching.manifest;
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="md:w-[min(64rem,100vw)]"
        onOpenChange={onOpenChange}
      >
        <SheetHeader
          title="Edit scenes"
          description="Blocks and branch levels across scenes. Changes are shared drafts; Save scenes keeps them in this preset."
        />
        <SheetBody>
          {rig.sceneSharing.conflict && (
            <p role="alert" className="mb-3 text-sm">
              Your scene draft is kept here. Close this sheet to review and
              choose which draft to share.
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
                        variant={
                          control.scene === scene.id ? 'default' : 'ghost'
                        }
                        disabled={
                          disabled ||
                          !control.scenes?.scenes.some(
                            (s) => s.id === scene.id,
                          ) ||
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
                            : control.scenes?.scenes.some(
                                  (s) => s.id === scene.id,
                                )
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
                        {label}
                      </th>
                      {scenes.map((scene) => {
                        const bypass =
                          draft?.bypass?.[scene.id]?.find(
                            (b) => b.node === node.id,
                          )?.value ??
                          scene.bypass?.find((b) => b.node === node.id)
                            ?.value ??
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
                      candidate.target.parameter ===
                        `block:${row.block}:enabled`,
                  );
                  const label = `${blockLabel(manifest, row.node)} · ${live?.label ?? row.block}`;
                  const armed =
                    control.native_bypass_armed?.some(
                      (candidate) => nativeBypassKey(candidate) === key,
                    ) ?? false;
                  return (
                    <tr
                      key={`native:${key}`}
                      className="border-b border-border"
                    >
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
                              value === 0
                                ? -60
                                : 20 * Math.log10(Math.abs(value))
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
          <p className="mt-3 text-sm text-muted-foreground">
            Each branch input retains its own level and polarity. Muting sets
            exact silence. Save scenes keeps these changes in the preset. Edited
            capture block states are played after Save prepares them.
          </p>
          <Button
            className="mt-3"
            disabled={disabled || !draft}
            onClick={() => void rig.saveScenes(false)}
          >
            Save scenes
          </Button>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
