import { ArrowCounterClockwise, PlugsConnected } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import { DialogFooter } from '@oxidal/design-system/components/dialog';
import {
  ActionRow,
  FormField,
} from '@oxidal/design-system/components/form-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from './AdjustmentDialog';
import {
  libraryCatalog,
  type MidiDevices,
  midiDevices,
  midiMap,
  type RigAudioAction,
  type RigAudioState,
} from './api';
import { RecoveryAction } from './FailureNotice';
import { friendlyError } from './lib/friendlyError';
import { useFailure } from './lib/useFailure';
import { midiConflicts } from './midiAssignments';
import { firstAfter, useLearnGate } from './midiLearn';
import {
  consumeMidiAssignmentRequest,
  OPEN_MIDI_EVENT,
} from './midiNavigation';

type Settings = NonNullable<NonNullable<RigAudioState['configured']>['midi']>;
type ExpressionPedal = NonNullable<
  NonNullable<Settings['parameter_bindings']>[number]['expression']
>;
const fullPedalTravel: ExpressionPedal = {
  heel_input: 0,
  toe_input: 127,
  heel_output: 0,
  toe_output: 127,
  curve: 'linear',
};
type MidiView = Pick<
  NonNullable<RigAudioState['control']>,
  'controls' | 'scenes' | 'branches' | 'midi' | 'stomp_groups'
>;
type Learning =
  | { kind: 'scene'; index: number; after: number }
  | { kind: 'branch'; branch: string; after: number }
  | { kind: 'parameter'; index: number; after: number };
type PresetIdentity = { kind: 'owned' | 'rig'; id: string };

export function SceneMidi({
  state,
  disabled,
  onCommand,
  trigger = true,
}: {
  state: RigAudioState;
  disabled: boolean;
  onCommand: (action: RigAudioAction) => Promise<void>;
  trigger?: boolean;
}) {
  return (
    <MidiControls
      trigger={trigger}
      control={state.control ?? null}
      configured={state.configured?.midi ?? null}
      disabled={disabled}
      preset={
        state.configured
          ? { kind: 'rig', id: state.configured.revision }
          : undefined
      }
      onApply={(settings) => onCommand({ kind: 'midi', settings })}
    />
  );
}
/** Shared real owner readback; device settings stay outside portable presets. */
export function MidiControls({
  control,
  configured,
  disabled: ownerDisabled,
  preset,
  onApply,
  trigger = true,
}: {
  control: MidiView | null;
  configured: Settings | null;
  disabled: boolean;
  preset?: PresetIdentity;
  onApply: (settings: Settings | null) => Promise<void>;
  /** False where the screen header already has the one MIDI entry (7.15). */
  trigger?: boolean;
}) {
  const { failure: recoverFailure, fail: recoverFail } = useFailure();
  const [devices, setDevices] = useState<MidiDevices | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showMappings, setShowMappings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const disabled = ownerDisabled || saving;
  const [error, setError] = useState('');
  const [learning, setLearning] = useState<Learning | null>(null);
  const [presetProgram, setPresetProgram] = useState<{
    key: string;
    program: number | null;
  } | null>(null);
  const initialized = useRef(false);
  const status = control?.midi;
  const savedInput = configured?.input;
  const presetKind = preset?.kind;
  const presetId = preset?.id;
  const presetKey = presetKind && presetId ? `${presetKind}:${presetId}` : null;
  const currentPresetProgram =
    presetProgram?.key === presetKey ? presetProgram.program : null;
  // Consume a fresh external snapshot once; clearing the token prevents later
  // telemetry from changing the draft before the musician applies it.
  const message = learning ? firstAfter(status, learning.after) : status?.last;
  useLearnGate(!!learning);
  if (
    learning &&
    !disabled &&
    draft &&
    status?.connected &&
    savedInput === draft.input &&
    status.events > learning.after &&
    message &&
    (draft.channel === 0 || message.channel === draft.channel)
  ) {
    if (learning.kind === 'scene') {
      setDraft({
        ...draft,
        bindings: draft.bindings.map((binding, index) =>
          index !== learning.index
            ? binding
            : message.kind === 'program'
              ? { ...binding, program: message.program, controller: null }
              : {
                  ...binding,
                  program: null,
                  controller: message.controller,
                },
        ),
      });
      setLearning(null);
    } else if (message.kind === 'control') {
      setDraft({
        ...draft,
        branch_bindings:
          learning.kind === 'branch'
            ? (draft.branch_bindings ?? []).map((binding) =>
                binding.branch === learning.branch
                  ? { ...binding, controller: message.controller }
                  : binding,
              )
            : draft.branch_bindings,
        parameter_bindings:
          learning.kind === 'parameter'
            ? (draft.parameter_bindings ?? []).map((binding, index) =>
                index === learning.index
                  ? { ...binding, controller: message.controller }
                  : binding,
              )
            : draft.parameter_bindings,
      });
      setLearning(null);
    }
  }

  const scenes = control?.scenes?.scenes ?? [];
  const branches = control?.branches ?? [];
  async function apply(settings: Settings | null) {
    setLearning(null);
    setError('');
    setSaving(true);
    try {
      await onApply(settings);
      setDialogOpen(false);
      initialized.current = false;
    } catch (cause) {
      setError(friendlyError(cause, 'change scene MIDI assignments'));
      recoverFail(
        cause,
        'change scene MIDI assignments',
        () => void apply(settings),
      );
    } finally {
      setSaving(false);
    }
  }
  async function scan() {
    setLoading(true);
    setError('');
    try {
      setDevices(await midiDevices());
    } catch (cause) {
      setError(friendlyError(cause, 'change scene MIDI assignments'));
      recoverFail(cause, 'change scene MIDI assignments', () => void scan());
    } finally {
      setLoading(false);
    }
  }
  function resetDraft() {
    setLearning(null);
    setShowMappings(!!status?.connected);
    setDraft(
      configured ?? {
        input: '',
        channel: 1,
        branch_bindings: [],
        parameter_bindings: [],
        bindings: scenes.slice(0, 128).map((scene, program) => ({
          scene: scene.id,
          program,
          controller: null,
        })),
      },
    );
  }
  function openEditor() {
    initialized.current = false;
    setDialogOpen(true);
  }
  useEffect(() => {
    const show = () => {
      initialized.current = false;
      setDialogOpen(true);
    };
    window.addEventListener(OPEN_MIDI_EVENT, show);
    if (consumeMidiAssignmentRequest()) show();
    return () => window.removeEventListener(OPEN_MIDI_EVENT, show);
  }, []);
  useEffect(() => {
    if (!dialogOpen || !control || initialized.current) return;
    initialized.current = true;
    setLearning(null);
    setDraft(
      configured ?? {
        input: '',
        channel: 1,
        branch_bindings: [],
        parameter_bindings: [],
        bindings: (control.scenes?.scenes ?? [])
          .slice(0, 128)
          .map((scene, program) => ({
            scene: scene.id,
            program,
            controller: null,
          })),
      },
    );
    setLoading(true);
    setError('');
    void midiDevices()
      .then(setDevices)
      .catch((cause: unknown) =>
        setError(friendlyError(cause, 'change scene MIDI assignments')),
      )
      .finally(() => setLoading(false));
  }, [configured, control, dialogOpen]);
  useEffect(() => {
    if (!dialogOpen || !presetKind || !presetId || !presetKey) return;
    let current = true;
    void Promise.all([midiMap(), libraryCatalog()])
      .then(([map, catalog]) => {
        const setList = catalog.items.filter(
          (item) =>
            !item.archived &&
            item.origin === 'mine' &&
            (item.kind === 'owned' || item.kind === 'rig'),
        );
        const slot = setList.findIndex(
          (item) => item.kind === presetKind && item.id === presetId,
        );
        if (current) {
          setPresetProgram({
            key: presetKey,
            program: map.input && slot >= 0 ? slot : null,
          });
        }
      })
      .catch(() => {
        if (current) setPresetProgram({ key: presetKey, program: null });
      });
    return () => {
      current = false;
    };
  }, [dialogOpen, presetId, presetKey, presetKind]);
  const controls = [
    ...(control?.controls ?? []).flatMap((c) =>
      'node' in c.target
        ? [{ ...c, mappingLabel: `${c.target.node} · ${c.label}` }]
        : [],
    ),
    ...(control?.stomp_groups ?? []).map((group) => ({
      target: { kind: 'stomp_group' as const, group: group.id },
      mappingLabel: `Stomp group · ${group.name}`,
      toggle: true,
      display: group.partial ? 'Mixed' : group.enabled ? 'On' : 'Off',
      value: Number(group.enabled),
    })),
  ];
  const conflicts = midiConflicts(draft);
  if (!control) return null;
  return (
    <>
      {trigger && (
        <Button variant="outline" aria-haspopup="dialog" onClick={openEditor}>
          <PlugsConnected size={18} aria-hidden="true" />
          MIDI controls
          <span className="text-xs font-normal text-muted-foreground">
            {configured
              ? status?.connected
                ? 'Connected'
                : 'Disconnected'
              : 'Not configured'}
          </span>
        </Button>
      )}
      {dialogOpen && (
        <AdjustmentDialog
          title="MIDI assignments"
          className="midi-assignment-dialog"
          onCancel={() => {
            if (saving) return;
            setLearning(null);
            setDialogOpen(false);
            initialized.current = false;
          }}
        >
          <div className="grid gap-5 [&_fieldset]:grid [&_fieldset]:gap-3 [&_legend]:mb-2">
            <div className="flex flex-wrap items-center gap-2" role="status">
              <Badge>
                {configured
                  ? status?.connected
                    ? 'Connected'
                    : 'Disconnected'
                  : 'Not configured'}
              </Badge>
              <Caption as="span">
                {configured
                  ? status?.connected
                    ? `${status.events} messages received`
                    : 'Saved controller is unavailable. Mappings are kept.'
                  : 'MIDI is optional. Connect a controller to set it up.'}
              </Caption>
            </div>
            {configured && status?.connected && status?.last && (
              <output
                className="block border-l-3 border-foreground bg-muted px-3 py-2 font-mono text-sm wrap-anywhere"
                aria-label="Last MIDI message"
              >
                Channel {status.last.channel} ·{' '}
                {status.last.kind === 'program'
                  ? `Program ${status.last.program + 1}`
                  : `CC ${status.last.controller} · ${status.last.value}`}
              </output>
            )}
            {currentPresetProgram != null && (
              <details className="midi-recall">
                <summary>
                  Preset recall · Program {currentPresetProgram + 1}
                </summary>
                <Caption>
                  {currentPresetProgram < 128
                    ? `Program ${currentPresetProgram + 1}`
                    : `Bank ${Math.floor(currentPresetProgram / 128)}, Program ${(currentPresetProgram % 128) + 1}`}{' '}
                  · Mine set-list position
                </Caption>
                <Caption>
                  A Program assigned to a scene below wins inside this preset.
                  CC 0 and 32 are reserved for Bank Select.
                </Caption>
              </details>
            )}
            {!scenes.length && (
              <Caption>
                Map CC messages to controls below. Program changes select scenes
                in a scene rig.
              </Caption>
            )}
            {status?.error && status.connected && (
              <Caption role="status">{status.error}</Caption>
            )}
            <div className="midi-device-row flex flex-wrap items-end gap-2">
              <FormField className="min-w-0 flex-1">
                MIDI input
                <Select
                  aria-label="MIDI input"
                  value={draft?.input ?? '__choose__'}
                  disabled={disabled || loading}
                  onValueChange={(value) =>
                    setDraft(
                      (old) =>
                        old && {
                          ...old,
                          input: value === '__choose__' ? '' : value,
                        },
                    )
                  }
                >
                  <SelectTrigger aria-label="MIDI input">
                    <SelectValue placeholder="Choose controller" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__choose__">
                      Choose controller
                    </SelectItem>
                    {draft?.input &&
                      !devices?.inputs.some((p) => p.id === draft.input) && (
                        <SelectItem value={draft.input}>
                          {draft.input} · unavailable
                        </SelectItem>
                      )}
                    {devices?.inputs.map((port) => (
                      <SelectItem key={port.id} value={port.id}>
                        {port.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <Button
                variant="outline"
                disabled={disabled || loading}
                onClick={() => void scan()}
              >
                {loading ? 'Scanning…' : 'Scan MIDI'}
              </Button>
            </div>
            {devices &&
              !devices.inputs.length &&
              !loading &&
              !error &&
              !configured && (
                <Caption>
                  No MIDI controller connected. You can use every audio feature
                  without one.
                </Caption>
              )}
            {!!draft?.input && (
              <>
                <FormField className="max-w-48">
                  MIDI channel
                  <Select
                    disabled={disabled}
                    value={String(draft?.channel ?? 1)}
                    onValueChange={(value) =>
                      setDraft(
                        (old) => old && { ...old, channel: Number(value) },
                      )
                    }
                  >
                    <SelectTrigger aria-label="MIDI channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">All channels</SelectItem>
                      {Array.from({ length: 16 }, (_, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>
                          {i + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <details
                  className="[&>fieldset+fieldset]:mt-5 [&>summary]:py-2 [&>summary]:font-semibold open:[&>summary]:mb-4"
                  open={showMappings}
                  onToggle={(event) =>
                    setShowMappings(event.currentTarget.open)
                  }
                >
                  <summary>Assignments</summary>
                  {draft?.bindings.map((binding, index) => (
                    <div
                      className="grid gap-3 border-t border-border py-3 first:border-t-0"
                      key={binding.scene}
                    >
                      <strong>
                        {scenes.find((s) => s.id === binding.scene)?.name ??
                          binding.scene}
                      </strong>
                      <div className="grid grid-cols-2 items-end gap-2">
                        <FormField className="min-w-0">
                          Message
                          <Select
                            value={
                              binding.controller == null ? 'program' : 'control'
                            }
                            disabled={disabled}
                            onValueChange={(value) =>
                              setDraft(
                                (old) =>
                                  old && {
                                    ...old,
                                    bindings: old.bindings.map((b, i) =>
                                      i === index
                                        ? {
                                            ...b,
                                            program:
                                              value === 'program'
                                                ? index
                                                : null,
                                            controller:
                                              value === 'control'
                                                ? index
                                                : null,
                                          }
                                        : b,
                                    ),
                                  },
                              )
                            }
                          >
                            <SelectTrigger
                              aria-label={`MIDI trigger ${index + 1}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="program">Program</SelectItem>
                              <SelectItem value="control">CC press</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormField>
                        <FormField className="min-w-0">
                          {binding.controller == null
                            ? 'Program (1–128)'
                            : 'CC (0–127)'}
                          <input
                            type="number"
                            aria-label={`MIDI number ${index + 1}`}
                            min={binding.controller == null ? 1 : 0}
                            max={binding.controller == null ? 128 : 127}
                            disabled={disabled}
                            value={
                              binding.controller ?? (binding.program ?? 0) + 1
                            }
                            onChange={(e) =>
                              setDraft(
                                (old) =>
                                  old && {
                                    ...old,
                                    bindings: old.bindings.map((b, i) =>
                                      i === index
                                        ? {
                                            ...b,
                                            program:
                                              b.controller == null
                                                ? Number(e.target.value) - 1
                                                : null,
                                            controller:
                                              b.controller == null
                                                ? null
                                                : Number(e.target.value),
                                          }
                                        : b,
                                    ),
                                  },
                              )
                            }
                          />
                        </FormField>
                      </div>
                      <ActionRow>
                        <Button
                          variant="outline"
                          disabled={
                            disabled ||
                            !status?.connected ||
                            savedInput !== draft.input
                          }
                          onClick={() =>
                            setLearning(
                              learning?.kind === 'scene' &&
                                learning.index === index
                                ? null
                                : {
                                    kind: 'scene',
                                    index,
                                    after: status?.events ?? 0,
                                  },
                            )
                          }
                        >
                          {learning?.kind === 'scene' &&
                          learning.index === index
                            ? 'Cancel learn'
                            : 'Learn message'}
                        </Button>
                        {learning?.kind === 'scene' &&
                          learning.index === index && (
                            <Caption as="span" role="status">
                              Press a footswitch or send Program Change
                            </Caption>
                          )}
                      </ActionRow>
                    </div>
                  ))}
                  {!!branches.length && (
                    <fieldset className="space-y-2">
                      <legend className="font-semibold">
                        Independent paths
                      </legend>
                      {branches.map((branch, index) => {
                        const binding = draft?.branch_bindings?.find(
                          (b) => b.branch === branch.id,
                        );
                        const change = (
                          patch: Partial<
                            NonNullable<Settings['branch_bindings']>[number]
                          >,
                        ) =>
                          setDraft(
                            (old) =>
                              old && {
                                ...old,
                                branch_bindings: (
                                  old.branch_bindings ?? []
                                ).map((b) =>
                                  b.branch === branch.id
                                    ? { ...b, ...patch }
                                    : b,
                                ),
                              },
                          );
                        return (
                          <div
                            key={branch.id}
                            className="grid gap-3 border-t border-border py-3 first:border-t-0"
                          >
                            <Button
                              variant="ghost"
                              className="w-fit justify-start"
                              aria-pressed={!!binding}
                              aria-label={`Map path ${branch.name}`}
                              disabled={disabled}
                              onClick={() =>
                                setDraft(
                                  (old) =>
                                    old && {
                                      ...old,
                                      branch_bindings: binding
                                        ? (old.branch_bindings ?? []).filter(
                                            (b) => b.branch !== branch.id,
                                          )
                                        : [
                                            ...(old.branch_bindings ?? []),
                                            {
                                              branch: branch.id,
                                              controller: 64 + index,
                                              mode: 'toggle',
                                            },
                                          ],
                                    },
                                )
                              }
                            >
                              {branch.name} · {binding ? 'Mapped' : 'Map CC'}
                            </Button>
                            {binding && (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <FormField className="min-w-0">
                                    CC
                                    <input
                                      type="number"
                                      aria-label={`Path ${branch.name} CC`}
                                      min={0}
                                      max={127}
                                      value={binding.controller}
                                      disabled={disabled}
                                      onChange={(event) =>
                                        change({
                                          controller: Number(
                                            event.target.value,
                                          ),
                                        })
                                      }
                                    />
                                  </FormField>
                                  <FormField className="min-w-0">
                                    Behavior
                                    <Select
                                      value={binding.mode}
                                      disabled={disabled}
                                      onValueChange={(value) =>
                                        change({
                                          mode: value as 'gate' | 'toggle',
                                        })
                                      }
                                    >
                                      <SelectTrigger
                                        aria-label={`Path ${branch.name} behavior`}
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="toggle">
                                          Toggle
                                        </SelectItem>
                                        <SelectItem value="gate">
                                          CC on/off
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormField>
                                </div>
                                <ActionRow>
                                  <Button
                                    variant="outline"
                                    disabled={
                                      disabled ||
                                      !status?.connected ||
                                      savedInput !== draft?.input
                                    }
                                    onClick={() =>
                                      setLearning(
                                        learning?.kind === 'branch' &&
                                          learning.branch === branch.id
                                          ? null
                                          : {
                                              kind: 'branch',
                                              branch: branch.id,
                                              after: status?.events ?? 0,
                                            },
                                      )
                                    }
                                  >
                                    {learning?.kind === 'branch' &&
                                    learning.branch === branch.id
                                      ? 'Cancel learn'
                                      : 'Learn CC'}
                                  </Button>
                                  {learning?.kind === 'branch' &&
                                    learning.branch === branch.id && (
                                      <Caption as="span" role="status">
                                        Press the footswitch for this path
                                      </Caption>
                                    )}
                                </ActionRow>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </fieldset>
                  )}
                  <fieldset className="space-y-2">
                    <legend className="font-semibold">Parameters</legend>
                    {(draft?.parameter_bindings ?? []).map((binding, index) => {
                      const expression = binding.expression;
                      const stomp = binding.target.kind === 'stomp_group';
                      const control = controls.find(
                        (c) =>
                          JSON.stringify(c.target) ===
                          JSON.stringify(binding.target),
                      );
                      const change = (
                        patch: Partial<
                          NonNullable<Settings['parameter_bindings']>[number]
                        >,
                      ) =>
                        setDraft(
                          (old) =>
                            old && {
                              ...old,
                              parameter_bindings: (
                                old.parameter_bindings ?? []
                              ).map((b, i) =>
                                i === index ? { ...b, ...patch } : b,
                              ),
                            },
                        );
                      return (
                        <div
                          key={index}
                          className="space-y-2 rounded-md border border-border p-2"
                        >
                          <FormField className="min-w-0">
                            Control
                            <Select
                              value={JSON.stringify(binding.target)}
                              disabled={disabled}
                              onValueChange={(value) => {
                                const selected = controls.find(
                                  (c) => JSON.stringify(c.target) === value,
                                );
                                if (selected)
                                  change({
                                    target: selected.target,
                                    expression: selected.toggle
                                      ? undefined
                                      : binding.expression,
                                    mode:
                                      selected.target.kind === 'stomp_group'
                                        ? 'toggle'
                                        : 'absolute',
                                  });
                              }}
                            >
                              <SelectTrigger
                                aria-label={`MIDI parameter ${index + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {!control && (
                                  <SelectItem
                                    value={JSON.stringify(binding.target)}
                                  >
                                    Unavailable control
                                  </SelectItem>
                                )}
                                {controls.map((c) => (
                                  <SelectItem
                                    key={JSON.stringify(c.target)}
                                    value={JSON.stringify(c.target)}
                                  >
                                    {c.mappingLabel}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormField>
                          <div className="grid grid-cols-2 gap-2">
                            <FormField className="min-w-0">
                              CC
                              <input
                                aria-label={`Parameter CC ${index + 1}`}
                                type="number"
                                min={0}
                                max={127}
                                value={binding.controller}
                                disabled={disabled}
                                onChange={(e) =>
                                  change({ controller: Number(e.target.value) })
                                }
                              />
                            </FormField>
                            <FormField className="min-w-0">
                              Behavior
                              <Select
                                value={
                                  stomp
                                    ? 'toggle'
                                    : binding.expression
                                      ? 'expression'
                                      : (binding.mode ?? 'absolute')
                                }
                                disabled={disabled || stomp}
                                onValueChange={(value) =>
                                  change({
                                    expression:
                                      value === 'expression'
                                        ? fullPedalTravel
                                        : undefined,
                                    mode: (value === 'expression'
                                      ? 'absolute'
                                      : value) as NonNullable<
                                      typeof binding.mode
                                    >,
                                  })
                                }
                              >
                                <SelectTrigger
                                  aria-label={`Parameter behavior ${index + 1}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {!stomp && (
                                    <SelectItem value="absolute">
                                      Absolute
                                    </SelectItem>
                                  )}
                                  {stomp || control?.toggle ? (
                                    <SelectItem value="toggle">
                                      Toggle on press
                                    </SelectItem>
                                  ) : (
                                    <>
                                      <SelectItem value="expression">
                                        Expression pedal
                                      </SelectItem>
                                      <SelectItem value="relative_twos_complement">
                                        Encoder: two’s complement
                                      </SelectItem>
                                      <SelectItem value="relative_offset64">
                                        Encoder: offset 64
                                      </SelectItem>
                                    </>
                                  )}
                                </SelectContent>
                              </Select>
                            </FormField>
                          </div>
                          {expression && (
                            <fieldset
                              disabled={disabled}
                              className="grid gap-2"
                            >
                              <legend>Expression pedal calibration</legend>
                              <Caption>
                                Move the pedal to each end and enter the CC
                                values shown under Last MIDI message. Set the
                                target positions from 0 to 127.
                              </Caption>
                              {(
                                [
                                  'heel_input',
                                  'toe_input',
                                  'heel_output',
                                  'toe_output',
                                ] as const
                              ).map((field) => (
                                <FormField key={field}>
                                  {
                                    {
                                      heel_input: 'Heel MIDI value',
                                      toe_input: 'Toe MIDI value',
                                      heel_output: 'Heel target position',
                                      toe_output: 'Toe target position',
                                    }[field]
                                  }
                                  <input
                                    type="number"
                                    min={0}
                                    max={127}
                                    value={expression[field]}
                                    onChange={(e) => {
                                      const position =
                                        e.currentTarget.valueAsNumber;
                                      if (
                                        Number.isInteger(position) &&
                                        position >= 0 &&
                                        position <= 127
                                      )
                                        change({
                                          expression: {
                                            ...expression,
                                            [field]: position,
                                          },
                                        });
                                    }}
                                  />
                                </FormField>
                              ))}
                              <FormField>
                                Response curve
                                <select
                                  value={expression.curve}
                                  onChange={(e) =>
                                    change({
                                      expression: {
                                        ...expression,
                                        curve: e.target
                                          .value as ExpressionPedal['curve'],
                                      },
                                    })
                                  }
                                >
                                  <option value="linear">Linear</option>
                                  <option value="slow_start">Slow start</option>
                                  <option value="fast_start">Fast start</option>
                                </select>
                              </FormField>
                              {expression.heel_input ===
                                expression.toe_input && (
                                <p role="alert">
                                  Heel and toe MIDI values must differ.
                                </p>
                              )}
                            </fieldset>
                          )}
                          <ActionRow>
                            <Button
                              variant="outline"
                              disabled={
                                disabled ||
                                !status?.connected ||
                                savedInput !== draft?.input
                              }
                              onClick={() =>
                                setLearning(
                                  learning?.kind === 'parameter' &&
                                    learning.index === index
                                    ? null
                                    : {
                                        kind: 'parameter',
                                        index,
                                        after: status?.events ?? 0,
                                      },
                                )
                              }
                            >
                              {learning?.kind === 'parameter' &&
                              learning.index === index
                                ? 'Cancel learn'
                                : `Learn CC ${index + 1}`}
                            </Button>
                            {learning?.kind === 'parameter' &&
                              learning.index === index && (
                                <Caption as="span" role="status">
                                  {stomp
                                    ? 'Press the stomp footswitch'
                                    : 'Move a controller knob'}
                                </Caption>
                              )}
                          </ActionRow>
                          {control && (
                            <Caption as="output">
                              {control.display || String(control.value)}
                            </Caption>
                          )}
                          <Button
                            variant="outline"
                            disabled={disabled}
                            onClick={() => {
                              setLearning(null);
                              setDraft(
                                (old) =>
                                  old && {
                                    ...old,
                                    parameter_bindings: (
                                      old.parameter_bindings ?? []
                                    ).filter((_, i) => i !== index),
                                  },
                              );
                            }}
                          >
                            Remove mapping {index + 1}
                          </Button>
                        </div>
                      );
                    })}
                    <Button
                      variant="outline"
                      disabled={
                        disabled ||
                        !draft ||
                        !controls.some((c) => !c.toggle) ||
                        (draft.parameter_bindings?.length ?? 0) >= 128 ||
                        !!draft.parameter_bindings?.some(
                          (b) => b.controller === 11 && b.expression,
                        )
                      }
                      onClick={() => {
                        const target = controls.find((c) => !c.toggle)?.target;
                        if (target)
                          setDraft(
                            (old) =>
                              old && {
                                ...old,
                                parameter_bindings: [
                                  ...(old.parameter_bindings ?? []),
                                  {
                                    target,
                                    controller: 11,
                                    mode: 'absolute',
                                    expression: fullPedalTravel,
                                  },
                                ],
                              },
                          );
                      }}
                    >
                      Add expression pedal · CC 11
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        disabled ||
                        !draft ||
                        !controls.length ||
                        (draft.parameter_bindings?.length ?? 0) >= 128
                      }
                      onClick={() =>
                        setDraft((old) => {
                          if (!old || !controls[0]) return old;
                          const used = new Set([
                            ...old.bindings.map((b) => b.controller),
                            ...(old.branch_bindings ?? []).map(
                              (b) => b.controller,
                            ),
                            ...(old.parameter_bindings ?? []).map(
                              (b) => b.controller,
                            ),
                          ]);
                          const controller = Array.from(
                            { length: 128 },
                            (_, i) => i,
                          ).find(
                            (cc) => cc !== 0 && cc !== 32 && !used.has(cc),
                          );
                          if (controller == null) return old;
                          return {
                            ...old,
                            parameter_bindings: [
                              ...(old.parameter_bindings ?? []),
                              {
                                target: controls[0].target,
                                controller,
                                mode:
                                  controls[0].target.kind === 'stomp_group'
                                    ? 'toggle'
                                    : 'absolute',
                              },
                            ],
                          };
                        })
                      }
                    >
                      Add parameter mapping
                    </Button>
                  </fieldset>
                </details>
              </>
            )}
            {!!conflicts.length && (
              <div
                role="alert"
                className="space-y-1 rounded-md border border-border p-2"
              >
                <strong>Resolve duplicate MIDI numbers</strong>
                {conflicts.map((conflict) => (
                  <Caption key={conflict}>{conflict}</Caption>
                ))}
              </div>
            )}
            <DialogFooter>
              {!!draft?.input && (
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={resetDraft}
                >
                  <ArrowCounterClockwise size={18} aria-hidden="true" />
                  Reset edits
                </Button>
              )}
              {configured && (
                <Button
                  variant="ghost"
                  disabled={disabled || !configured}
                  onClick={() => void apply(null)}
                >
                  Disable controller
                </Button>
              )}
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  setLearning(null);
                  setDialogOpen(false);
                  initialized.current = false;
                }}
              >
                {draft?.input ? 'Cancel' : 'Close'}
              </Button>
              {!!draft?.input && (
                <Button
                  disabled={
                    disabled ||
                    !!conflicts.length ||
                    draft?.parameter_bindings?.some(
                      ({ expression }) =>
                        expression &&
                        expression.heel_input === expression.toe_input,
                    ) ||
                    !draft?.input ||
                    !devices?.inputs.some((input) => input.id === draft.input)
                  }
                  onClick={() => void apply(draft)}
                >
                  Apply MIDI
                </Button>
              )}
            </DialogFooter>
            {saving && <p role="status">Saving controller settings…</p>}
            {error && <p role="alert">{error}</p>}
            {error && <RecoveryAction failure={recoverFailure} />}
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
