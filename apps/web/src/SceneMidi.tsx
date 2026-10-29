import { useState } from 'react';
import { PlugsConnected, ArrowCounterClockwise } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import {
  midiDevices,
  type MidiDevices,
  type RigAudioState,
  type RigAudioAction,
} from './api';

type Settings = NonNullable<NonNullable<RigAudioState['configured']>['midi']>;
type MidiView = Pick<
  NonNullable<RigAudioState['control']>,
  'controls' | 'scenes' | 'branches' | 'midi'
>;
export function SceneMidi({
  state,
  disabled,
  onCommand,
}: {
  state: RigAudioState;
  disabled: boolean;
  onCommand: (action: RigAudioAction) => Promise<void>;
}) {
  return (
    <MidiControls
      control={state.control ?? null}
      configured={state.configured?.midi ?? null}
      disabled={disabled}
      onApply={(settings) => onCommand({ kind: 'midi', settings })}
    />
  );
}
/** Shared real owner readback; device settings stay outside portable presets. */
export function MidiControls({
  control,
  configured,
  disabled,
  onApply,
}: {
  control: MidiView | null;
  configured: Settings | null;
  disabled: boolean;
  onApply: (settings: Settings | null) => Promise<void>;
}) {
  const [devices, setDevices] = useState<MidiDevices | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [learning, setLearning] = useState<{
    index: number;
    after: number;
  } | null>(null);
  const status = control?.midi;
  const savedInput = configured?.input;
  // Consume a fresh external snapshot once; clearing the token prevents later
  // telemetry from changing the draft before the musician applies it.
  const message = status?.last;
  if (
    learning &&
    !disabled &&
    draft &&
    status?.connected &&
    savedInput === draft.input &&
    status.events > learning.after &&
    message?.kind === 'control' &&
    (draft.channel === 0 || message.channel === draft.channel)
  ) {
    setDraft({
      ...draft,
      parameter_bindings: (draft.parameter_bindings ?? []).map((b, index) =>
        index === learning.index ? { ...b, controller: message.controller } : b,
      ),
    });
    setLearning(null);
  }

  const scenes = control?.scenes?.scenes ?? [];
  const branches = control?.branches ?? [];
  async function scan() {
    setLoading(true);
    setError('');
    try {
      setDevices(await midiDevices());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }
  function resetDraft() {
    setLearning(null);
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
  function open() {
    resetDraft();
    void scan();
  }
  const controls = control?.controls ?? [];
  if (!control) return null;
  return (
    <details
      className="w-full max-w-3xl rounded-md border border-border p-3"
      onToggle={(event) => {
        setLearning(null);
        if (event.currentTarget.open) open();
      }}
    >
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        <span className="inline-flex flex-wrap items-center gap-2">
          <PlugsConnected size={18} aria-hidden="true" />
          <span>MIDI controls</span>
          <span className="text-xs font-normal text-muted-foreground">
            {configured
              ? status?.connected
                ? 'Connected'
                : 'Waiting'
              : 'Not configured'}
          </span>
        </span>
      </summary>
      <div className="space-y-3 pt-3">
        {configured && (
          <p className="caption" role="status">
            {status?.connected ? 'Connected' : 'Waiting for controller'} ·{' '}
            {status?.events ?? 0} messages
          </p>
        )}
        {configured && status?.last && (
          <output className="midi-message" aria-label="Last MIDI message">
            Channel {status.last.channel} ·{' '}
            {status.last.kind === 'program'
              ? `Program ${status.last.program + 1}`
              : `CC ${status.last.controller} · ${status.last.value}`}
          </output>
        )}
        {!scenes.length && (
          <p className="caption">
            Map CC messages to controls below. Program changes select scenes in
            a scene rig.
          </p>
        )}
        {status?.error && (
          <p role="status" className="caption">
            {status.error}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="field min-w-0 flex-1">
            MIDI input
            <select
              aria-label="MIDI input"
              value={draft?.input ?? ''}
              disabled={disabled || loading}
              onChange={(e) =>
                setDraft((old) => old && { ...old, input: e.target.value })
              }
            >
              <option value="">Choose controller</option>
              {draft?.input &&
                !devices?.inputs.some((p) => p.id === draft.input) && (
                  <option value={draft.input}>
                    {draft.input} · unavailable
                  </option>
                )}
              {devices?.inputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={disabled || loading}
            onClick={() => void scan()}
          >
            {loading ? 'Scanning…' : 'Scan MIDI'}
          </Button>
        </div>
        <label className="field">
          MIDI channel
          <select
            aria-label="MIDI channel"
            disabled={disabled}
            value={draft?.channel ?? 1}
            onChange={(e) =>
              setDraft(
                (old) => old && { ...old, channel: Number(e.target.value) },
              )
            }
          >
            <option value={0}>All channels</option>
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        {draft?.bindings.map((binding, index) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2"
            key={binding.scene}
          >
            <label className="field min-w-0">
              {scenes.find((s) => s.id === binding.scene)?.name ??
                binding.scene}
              <select
                aria-label={`MIDI trigger ${index + 1}`}
                value={binding.controller == null ? 'program' : 'control'}
                disabled={disabled}
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
                                  e.target.value === 'program' ? index : null,
                                controller:
                                  e.target.value === 'control' ? index : null,
                              }
                            : b,
                        ),
                      },
                  )
                }
              >
                <option value="program">Program</option>
                <option value="control">CC press</option>
              </select>
            </label>
            <label className="field min-w-0">
              {binding.controller == null ? 'Program (1–128)' : 'CC (0–127)'}
              <input
                type="number"
                aria-label={`MIDI number ${index + 1}`}
                min={binding.controller == null ? 1 : 0}
                max={binding.controller == null ? 128 : 127}
                disabled={disabled}
                value={binding.controller ?? (binding.program ?? 0) + 1}
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
            </label>
          </div>
        ))}
        {!!branches.length && (
          <fieldset className="space-y-2">
            <legend className="font-semibold">Independent branches</legend>
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
                      branch_bindings: (old.branch_bindings ?? []).map((b) =>
                        b.branch === branch.id ? { ...b, ...patch } : b,
                      ),
                    },
                );
              return (
                <div
                  key={branch.id}
                  className="space-y-2 rounded-md border border-border p-2"
                >
                  <Button
                    variant={binding ? 'secondary' : 'outline'}
                    aria-pressed={!!binding}
                    aria-label={`Map branch ${branch.name}`}
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
                    <div className="grid grid-cols-2 gap-2">
                      <label className="field min-w-0">
                        CC
                        <input
                          type="number"
                          aria-label={`Branch ${branch.name} CC`}
                          min={0}
                          max={127}
                          value={binding.controller}
                          disabled={disabled}
                          onChange={(event) =>
                            change({ controller: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label className="field min-w-0">
                        Behavior
                        <select
                          aria-label={`Branch ${branch.name} behavior`}
                          value={binding.mode}
                          disabled={disabled}
                          onChange={(event) =>
                            change({
                              mode: event.target.value as 'gate' | 'toggle',
                            })
                          }
                        >
                          <option value="toggle">Toggle</option>
                          <option value="gate">CC on/off</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
        )}
        <fieldset className="space-y-2">
          <legend className="font-semibold">Parameters</legend>
          {(draft?.parameter_bindings ?? []).map((binding, index) => {
            const control = controls.find(
              (c) =>
                JSON.stringify(c.target) === JSON.stringify(binding.target),
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
                    parameter_bindings: (old.parameter_bindings ?? []).map(
                      (b, i) => (i === index ? { ...b, ...patch } : b),
                    ),
                  },
              );
            return (
              <div
                key={index}
                className="space-y-2 rounded-md border border-border p-2"
              >
                <label className="field min-w-0">
                  Control
                  <select
                    aria-label={`MIDI parameter ${index + 1}`}
                    value={JSON.stringify(binding.target)}
                    disabled={disabled}
                    onChange={(event) => {
                      const selected = controls.find(
                        (c) => JSON.stringify(c.target) === event.target.value,
                      );
                      if (selected)
                        change({ target: selected.target, mode: 'absolute' });
                    }}
                  >
                    {!control && (
                      <option value={JSON.stringify(binding.target)}>
                        Unavailable control
                      </option>
                    )}
                    {controls.map((c) => (
                      <option
                        key={JSON.stringify(c.target)}
                        value={JSON.stringify(c.target)}
                      >
                        {c.target.node} · {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="field min-w-0">
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
                  </label>
                  <label className="field min-w-0">
                    Behavior
                    <select
                      aria-label={`Parameter behavior ${index + 1}`}
                      value={binding.mode ?? 'absolute'}
                      disabled={disabled}
                      onChange={(e) =>
                        change({
                          mode: e.target.value as NonNullable<
                            typeof binding.mode
                          >,
                        })
                      }
                    >
                      <option value="absolute">Absolute</option>
                      {control?.toggle ? (
                        <option value="toggle">Toggle on press</option>
                      ) : (
                        <>
                          <option value="relative_twos_complement">
                            Encoder: two’s complement
                          </option>
                          <option value="relative_offset64">
                            Encoder: offset 64
                          </option>
                        </>
                      )}
                    </select>
                  </label>
                </div>
                <div className="action-row">
                  <Button
                    variant="outline"
                    disabled={
                      disabled ||
                      !status?.connected ||
                      savedInput !== draft?.input
                    }
                    onClick={() =>
                      setLearning(
                        learning?.index === index
                          ? null
                          : { index, after: status?.events ?? 0 },
                      )
                    }
                  >
                    {learning?.index === index
                      ? 'Cancel learn'
                      : `Learn CC ${index + 1}`}
                  </Button>
                  {learning?.index === index && (
                    <span role="status" className="caption">
                      Move a controller knob
                    </span>
                  )}
                </div>
                {control && (
                  <output className="caption">
                    {control.display || String(control.value)}
                  </output>
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
              !controls.length ||
              (draft.parameter_bindings?.length ?? 0) >= 128
            }
            onClick={() =>
              setDraft((old) => {
                if (!old || !controls[0]) return old;
                const used = new Set([
                  ...old.bindings.map((b) => b.controller),
                  ...(old.branch_bindings ?? []).map((b) => b.controller),
                  ...(old.parameter_bindings ?? []).map((b) => b.controller),
                ]);
                const controller = Array.from(
                  { length: 128 },
                  (_, i) => i,
                ).find((cc) => !used.has(cc));
                if (controller == null) return old;
                return {
                  ...old,
                  parameter_bindings: [
                    ...(old.parameter_bindings ?? []),
                    {
                      target: controls[0].target,
                      controller,
                      mode: 'absolute',
                    },
                  ],
                };
              })
            }
          >
            Add parameter mapping
          </Button>
        </fieldset>
        <div className="action-row">
          <Button
            disabled={
              disabled ||
              !draft?.input ||
              (!draft.bindings.length &&
                !draft.branch_bindings?.length &&
                !draft.parameter_bindings?.length)
            }
            onClick={() => void onApply(draft)}
          >
            Apply MIDI
          </Button>
          <Button variant="outline" disabled={disabled} onClick={resetDraft}>
            <ArrowCounterClockwise size={18} aria-hidden="true" />
            Reset edits
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !configured}
            onClick={() => void onApply(null)}
          >
            Disable MIDI
          </Button>
        </div>
        {devices && !devices.inputs.length && !loading && !error && (
          <p className="caption">No MIDI inputs detected.</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
