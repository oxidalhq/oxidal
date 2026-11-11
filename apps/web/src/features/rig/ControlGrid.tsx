import { Button } from '../../components/ui/button';
import { LiveEq } from '../../LiveEq';
import { NativeAuthoring } from '../../NativeAuthoring';
import { controlDisplay, controlLabel } from '../../lv2Control';
import { rigAudioCommand } from '../../api';
import type { RigViewProps } from './useMixedRigSession';
import { key, rigBusy } from './mixedRigViewModel';

/**
 * Controls of the selected block, with native authoring and live EQ.
 * @see docs/interface.md
 */
export function ControlGrid({ rig, vm }: RigViewProps) {
  const {
    accept,
    busy,
    command,
    connected,
    current,
    edit,
    generation: generationRef,
    matching,
    open,
    readError,
    sending: sendingRef,
    setEqBusy,
  } = rig;
  const {
    eqBlock,
    eqBlocks,
    measuring,
    modelPending,
    nodes,
    running,
    selected,
    state,
    unavailable,
    visibleControls,
    wholeNative,
  } = vm;
  return (
    <>
      {running && (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Selected effect controls"
        >
          {visibleControls.map((c) => (
            <Button
              key={key(c)}
              className="h-auto min-h-16 flex-col items-start gap-1 p-3 text-left whitespace-normal"
              variant="outline"
              disabled={rigBusy(vm, rig)}
              onClick={() => {
                if (c.toggle && state.control) {
                  void command({
                    kind: 'control',
                    command: {
                      session: state.control.session,
                      expected_revision: state.control.revision,
                      target: c.target,
                      value: c.value === c.minimum ? c.maximum : c.minimum,
                    },
                  });
                } else open(c);
              }}
              aria-pressed={c.toggle ? c.value !== c.minimum : undefined}
              aria-haspopup={c.toggle ? undefined : 'dialog'}
              aria-label={`Adjust ${controlLabel(c.label)}`}
            >
              <span className="break-words">{controlLabel(c.label)}</span>
              <strong className="font-mono">{controlDisplay(c)}</strong>
            </Button>
          ))}
          {!matching ? (
            <p>Reading chain…</p>
          ) : (
            !nodes.length && <p>Input → Output</p>
          )}
        </div>
      )}
      {running &&
        selected &&
        state.control?.authoring?.find((row) => row.node === selected.id) && (
          <NativeAuthoring
            collapseSettings
            key={`${state.control.session}:${selected.id}`}
            status={
              state.control.authoring.find((row) => row.node === selected.id)!
                .status
            }
            selectedBlock={eqBlock?.block_id}
            disabled={unavailable || !!edit}
            busy={busy}
            session={state.control.session}
            revision={state.control.revision}
            author={async (action) => {
              const cursor = current.current?.control;
              if (!cursor) return;
              await command({
                kind: 'authoring',
                command: {
                  session: cursor.session,
                  expected_revision: cursor.revision,
                  node: selected.id,
                  action,
                },
              });
            }}
          />
        )}
      {running && selected && eqBlock && (
        <div className="space-y-2">
          <LiveEq
            key={`${state.control!.session}:${selected.id}:${eqBlock.block_id}`}
            state={{ ...state, eq: eqBlocks }}
            blockId={eqBlock.block_id}
            disabled={
              !connected ||
              busy ||
              !!edit ||
              !!readError ||
              modelPending ||
              !!measuring
            }
            onEditing={(editing) => {
              generationRef.current++;
              sendingRef.current = editing;
              setEqBusy(editing);
            }}
            onChange={accept}
            gesture={
              wholeNative
                ? async (current, edit) => {
                    const next = await rigAudioCommand(current, {
                      kind: 'authoring',
                      command: {
                        session: current.control!.session,
                        expected_revision: current.control!.revision,
                        node: selected.id,
                        action: { kind: 'gesture', edit },
                      },
                    });
                    return {
                      ...next,
                      eq:
                        next.control?.eq?.find((e) => e.node === selected.id)
                          ?.blocks ?? [],
                    };
                  }
                : undefined
            }
            send={async (current, edit) => {
              const next = wholeNative
                ? await rigAudioCommand(current, {
                    kind: 'authoring',
                    command: {
                      session: current.control!.session,
                      expected_revision: current.control!.revision,
                      node: selected.id,
                      action: {
                        kind: 'eq',
                        block_id: eqBlock.block_id,
                        edit,
                      },
                    },
                  })
                : await rigAudioCommand(current, {
                    kind: 'eq',
                    command: {
                      session: current.control!.session,
                      expected_revision: current.control!.revision,
                      node: selected.id,
                      block_id: eqBlock.block_id,
                      edit,
                    },
                  });
              return {
                ...next,
                eq:
                  next.control?.eq?.find((e) => e.node === selected.id)
                    ?.blocks ?? [],
              };
            }}
          />
        </div>
      )}
    </>
  );
}
