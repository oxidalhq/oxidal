import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  StompAssignmentDialog,
  StompSwitch,
} from '@oxidal/design-system/widgets/stomp-group';

import { setStompGroups } from '../../sceneEdit';
import { rigStompGroups, type StompGroup } from '../../sceneFormat';
import { rigBusy } from './mixedRigViewModel';
import type { RigViewProps } from './useMixedRigSession';

export function StompControls({
  rig,
  vm,
  stage = false,
}: RigViewProps & { stage?: boolean }) {
  const [editing, setEditing] = useState<{
    revision: string;
    id: string | null;
  } | null>(null);
  const { matching } = rig;
  const { state } = vm;
  const control = state.control;
  if (!control?.scenes?.scenes.length || !matching) return null;
  const groups = rigStompGroups(matching.manifest);
  const blocks = (matching.manifest.oxidal?.graph.nodes ?? [])
    .filter((n) => n.kind === 'lv2' || n.kind === 'tone3000')
    .map((n) => ({ id: n.id, name: vm.describeNode(n).block.label }));
  const waiting = rigBusy(vm, rig);
  const locked =
    waiting ||
    vm.draftCount > 0 ||
    vm.sceneMixChanged ||
    rig.sceneSharing.conflict;
  const selected = groups.find((g) => g.id === editing?.id);
  function apply(groups: StompGroup[]) {
    if (
      !editing ||
      locked ||
      !matching ||
      editing.revision !== matching.revision
    )
      return;
    const revision = editing.revision;
    setEditing(null);
    void rig.rebuild(
      ({ opened, name, live }) => {
        if (opened.revision !== revision)
          throw new Error('The preset changed. Open the assignment again.');
        return setStompGroups(opened, groups, live, name);
      },
      { discoverPlugins: false },
    );
  }
  const scenes = control.scenes.scenes;
  const index = scenes.findIndex(
    (s) => s.id === (control.stomp_scene ?? control.scene),
  );
  const next =
    index >= 0 && scenes.length > 1
      ? scenes[(index + 1) % scenes.length]
      : undefined;
  if (stage && !groups.length) return null;
  return (
    <div
      className="flex min-w-0 flex-wrap items-start gap-2"
      role="group"
      aria-label="Stomp switches"
    >
      {groups.length > 0 &&
        index >= 0 &&
        control.stomp_scene &&
        control.scene !== control.stomp_scene && (
          <span className="basis-full text-sm text-muted-foreground">
            Last recalled scene · {scenes[index]!.name}
          </span>
        )}
      {groups.map((group) => {
        const status = control.stomp_groups?.find((g) => g.id === group.id);
        const values = group.nodes.map(
          (id) => next?.bypass?.find((b) => b.node === id)?.value,
        );
        const preview =
          next && values.every((v) => v !== undefined)
            ? next.name +
              ' recall · ' +
              (values.every(Boolean)
                ? 'Off'
                : values.every((v) => !v)
                  ? 'On'
                  : 'Mixed')
            : undefined;
        return (
          <div key={group.id} className="grid min-w-0 gap-1">
            {status ? (
              <StompSwitch
                name={group.name}
                enabled={status.enabled}
                partial={status.partial}
                next={preview}
                disabled={waiting}
                onPress={() =>
                  void rig.command({
                    kind: 'stomp_group',
                    command: {
                      session: control.session,
                      expected_revision: control.revision,
                      group: group.id,
                    },
                  })
                }
              />
            ) : (
              <span>{group.name} · unavailable</span>
            )}
            {!stage && (
              <Button
                variant="ghost"
                disabled={locked}
                onClick={() =>
                  setEditing({ revision: matching.revision, id: group.id })
                }
              >
                Edit {group.name} switch
              </Button>
            )}
          </div>
        );
      })}
      {!stage && !!blocks.length && groups.length < 16 && (
        <Button
          variant="outline"
          disabled={locked}
          onClick={() => setEditing({ revision: matching.revision, id: null })}
        >
          Assign a stomp switch
        </Button>
      )}
      {editing && (
        <StompAssignmentDialog
          initial={selected}
          blocks={blocks}
          disabled={locked || editing.revision !== matching.revision}
          onClose={() => setEditing(null)}
          onRemove={
            selected
              ? () => apply(groups.filter((g) => g.id !== selected.id))
              : undefined
          }
          onSave={(name, nodes) => {
            const replacement = {
              id: selected?.id ?? 'switch-' + crypto.randomUUID(),
              name,
              nodes,
            };
            apply(
              selected
                ? groups.map((g) => (g.id === selected.id ? replacement : g))
                : [...groups, replacement],
            );
          }}
        />
      )}
    </div>
  );
}
