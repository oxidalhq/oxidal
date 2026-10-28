import { useState } from 'react';
import { Button } from './components/ui/button';
import {
  midiDevices,
  type MidiDevices,
  type RigAudioState,
  type RigAudioAction,
} from './api';

type Settings = NonNullable<NonNullable<RigAudioState['configured']>['midi']>;
/** Device settings stay outside portable presets. This panel never impersonates
 * a connected controller when only its saved configuration is present. */
export function SceneMidi({
  state,
  disabled,
  onCommand,
}: {
  state: RigAudioState;
  disabled: boolean;
  onCommand: (action: RigAudioAction) => Promise<void>;
}) {
  const [devices, setDevices] = useState<MidiDevices | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scenes = state.control?.scenes?.scenes ?? [];
  const branches = state.control?.branches ?? [];
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
  function open() {
    setDraft(
      state.configured?.midi ?? {
        input: '',
        channel: 1,
        branch_bindings: [],
        bindings: scenes.slice(0, 128).map((scene, program) => ({
          scene: scene.id,
          program,
          controller: null,
        })),
      },
    );
    void scan();
  }
  if (!scenes.length) return null;
  const status = state.control?.midi;
  return (
    <details
      className="w-full max-w-3xl rounded-md border border-border p-3"
      onToggle={(event) => {
        if (event.currentTarget.open) open();
      }}
    >
      <summary className="min-h-11 cursor-pointer content-center font-semibold">
        MIDI scenes
      </summary>
      <div className="space-y-3 pt-3">
        {state.configured?.midi && (
          <p className="caption" role="status">
            {status?.connected ? 'Connected' : 'Waiting for controller'} ·{' '}
            {status?.events ?? 0} messages
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
        <div className="action-row">
          <Button
            disabled={
              disabled ||
              !draft?.input ||
              (!draft.bindings.length && !draft.branch_bindings?.length)
            }
            onClick={() => void onCommand({ kind: 'midi', settings: draft })}
          >
            Apply MIDI
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !state.configured?.midi}
            onClick={() => void onCommand({ kind: 'midi', settings: null })}
          >
            Disable MIDI
          </Button>
        </div>
        {!devices?.inputs.length && !loading && (
          <p className="caption">No MIDI inputs detected.</p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
