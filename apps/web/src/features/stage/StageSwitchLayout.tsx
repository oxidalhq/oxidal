import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  ActionRow,
  FormField,
  FormGrid,
} from '@oxidal/design-system/components/form-layout';
import type { SwitchOverrides } from '@oxidal/design-system/widgets/footswitches';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  type MidiMap,
  midiMap,
  presetSwitchLayout,
  pressPresetSwitch,
  releasePresetSwitches,
} from '../../api';
import { useProtect } from '../../components/media/sessionMedia';
import type {
  Status2,
  SwitchInput,
  SwitchLayoutState,
  SwitchLayoutUpdate,
  SwitchPress,
} from '../../generated/contract';
import { friendlyError } from '../../lib/friendlyError';
import { useLearnGate } from '../../midiLearn';
import { observedSwitchInputs, sameSwitchInput } from './switchInputs';

type Assignment = SwitchLayoutState['layout']['switches'][number];
type Action = Assignment['action'];
type Gesture = Assignment['gesture'];
type Profile = Assignment['profile'];
type FreezeTarget = {
  node: string;
  symbol: string;
  label: string;
  on: boolean;
};
export type StageSwitchPreset = {
  kind: 'owned' | 'original' | 'rig' | 'graph';
  id: string;
  session: string;
  targets: FreezeTarget[];
  midi?: Status2;
};
const notes = {
  quarter: 'Quarter',
  dotted_eighth: 'Dotted eighth',
  eighth: 'Eighth',
  triplet: 'Eighth triplet',
} as const;

function Editor({
  state,
  profile,
  names,
  targets,
  midi,
  protectedMode,
  save,
  reload,
  close,
}: {
  state: SwitchLayoutState;
  profile: Profile;
  names: string[];
  midi?: Status2;
  targets: FreezeTarget[];
  protectedMode: boolean;
  save: (state: SwitchLayoutUpdate) => Promise<void>;
  reload: () => Promise<void>;
  close: () => void;
}) {
  const [position, setPosition] = useState(1);
  const [gesture, setGesture] = useState<Gesture>('tap');
  const [edited, setEdited] = useState<Action | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const same = (a: Assignment) =>
    a.position === position && a.profile === profile && a.gesture === gesture;
  const current = state.layout.switches.find(same);
  const action = edited === undefined ? current?.action : edited;
  const target =
    action?.kind === 'freeze'
      ? targets.find(
          (t) => t.node === action.node && t.symbol === action.symbol,
        )
      : undefined;
  const [listening, setListening] = useState(false);
  useLearnGate(listening && !protectedMode, (e) => {
    setListening(false);
    setError(friendlyError(e, 'listen for a MIDI switch'));
  });
  const [map, setMap] = useState<MidiMap | null>(null);
  useEffect(() => {
    let live = true;
    void midiMap().then(
      (m) => {
        if (live) setMap(m);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  const [inputEdit, setInputEdit] = useState<SwitchInput | null | undefined>(
    undefined,
  );
  const input = inputEdit === undefined ? current?.input : inputEdit;
  const observed = observedSwitchInputs(midi, map);
  const choices =
    input && !observed.some((i) => sameSwitchInput(i, input))
      ? [input, ...observed]
      : observed;
  const inputIndex = input
    ? choices.findIndex((i) => sameSwitchInput(i, input))
    : -1;
  const dirty = edited !== undefined || !sameSwitchInput(input, current?.input);
  const chooseTarget = (t: FreezeTarget, mode: 'toggle' | 'gate') =>
    setEdited({ kind: 'freeze', node: t.node, symbol: t.symbol, mode });
  async function submit() {
    if (busy || protectedMode || !dirty) return;
    setBusy(true);
    setError('');
    try {
      const switches = state.layout.switches.filter((a) => !same(a));
      if (action)
        switches.push({
          ...current,
          profile,
          position,
          gesture,
          action,
          input,
        });
      await save({
        expected_revision: state.revision,
        layout: { ...state.layout, switches },
      });
      close();
    } catch (e) {
      setError(friendlyError(e, 'save the switch layout'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog
      title="Edit preset switches"
      onCancel={() => {
        if (!busy) close();
      }}
    >
      <fieldset disabled={busy || protectedMode}>
        <FormGrid>
          <FormField>
            Switch
            <select
              value={position}
              onChange={(e) => {
                setPosition(Number(e.target.value));
                setEdited(undefined);
                setInputEdit(undefined);
              }}
            >
              {names.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField>
            Gesture
            <select
              value={gesture}
              onChange={(e) => {
                setGesture(e.target.value as Gesture);
                setEdited(undefined);
                setInputEdit(undefined);
              }}
            >
              <option value="tap">Tap</option>
              <option value="hold">Hold</option>
            </select>
          </FormField>
          <FormField>
            Action
            <select
              value={action?.kind ?? 'default'}
              onChange={(e) => {
                if (e.target.value === 'default') setEdited(null);
                else if (e.target.value === 'tap_tempo')
                  setEdited({ kind: 'tap_tempo', note: 'quarter' });
                else if (targets[0]) chooseTarget(targets[0], 'toggle');
              }}
            >
              <option value="default">Profile default</option>
              <option value="tap_tempo">Tap tempo</option>
              {(targets.length > 0 || action?.kind === 'freeze') && (
                <option value="freeze">Freeze</option>
              )}
            </select>
          </FormField>
          {action?.kind === 'tap_tempo' && (
            <FormField>
              Tap note
              <select
                value={action.note}
                onChange={(e) =>
                  setEdited({
                    ...action,
                    note: e.target.value as keyof typeof notes,
                  })
                }
              >
                {Object.entries(notes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {action?.kind === 'freeze' && (
            <>
              <FormField>
                Freeze block
                <select
                  value={target?.node ?? ''}
                  onChange={(e) => {
                    const next = targets.find((t) => t.node === e.target.value);
                    if (next) chooseTarget(next, action.mode);
                  }}
                >
                  {!target && (
                    <option value="" disabled>
                      Block unavailable
                    </option>
                  )}
                  {targets.map((t) => (
                    <option key={t.node} value={t.node}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField>
                Freeze behavior
                <select
                  value={action.mode}
                  onChange={(e) =>
                    setEdited({
                      ...action,
                      mode: e.target.value as 'gate' | 'toggle',
                    })
                  }
                >
                  <option value="toggle">Toggle</option>
                  {gesture === 'hold' && (
                    <option value="gate">While held</option>
                  )}
                </select>
              </FormField>
            </>
          )}
          {action && (
            <FormField>
              Physical MIDI input
              <select
                value={inputIndex}
                onChange={(e) =>
                  setInputEdit(choices[Number(e.target.value)] ?? null)
                }
              >
                <option value={-1}>On-screen only</option>
                {choices.map((choice, index) => (
                  <option key={JSON.stringify(choice)} value={index}>
                    {choice.port} · Channel {choice.channel} · CC{' '}
                    {choice.controller}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </FormGrid>
        {action &&
          map?.input &&
          midi &&
          (midi.connected || midi.sources?.some((s) => s.connected)) && (
            <ActionRow>
              <Button
                variant="outline"
                onClick={() => setListening(!listening)}
              >
                {listening ? 'Stop listening' : 'Listen for MIDI switch'}
              </Button>
              {listening && (
                <span role="status">
                  {midi.learning
                    ? 'Press the controller switch, then select its MIDI input.'
                    : 'Starting MIDI listening…'}
                </span>
              )}
            </ActionRow>
          )}
      </fieldset>
      {protectedMode && <p>Turn Protect off to edit preset switches.</p>}
      {current?.input && (
        <p>
          {edited === null
            ? 'Restoring the profile default removes this switch’s MIDI assignment.'
            : 'This switch has a MIDI input assigned.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <ActionRow>
        <Button
          disabled={
            busy ||
            protectedMode ||
            !dirty ||
            (action?.kind === 'freeze' && !target)
          }
          onClick={() => void submit()}
        >
          Save switch
        </Button>
        {error && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await reload();
                setEdited(undefined);
                setInputEdit(undefined);
                setError('');
              } catch (e) {
                setError(friendlyError(e, 'reload the switch layout'));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reload saved layout
          </Button>
        )}
      </ActionRow>
    </AdjustmentDialog>
  );
}

export function StageSwitchLayout({
  preset,
  profile,
  names,
  children,
}: {
  preset?: StageSwitchPreset;
  profile: Profile;
  names: string[];
  children: (overrides: SwitchOverrides, loading: boolean) => React.ReactNode;
}) {
  const path = preset
    ? '/api/v1/presets/switch-layout/' +
      preset.kind +
      '/' +
      encodeURIComponent(preset.id)
    : null;
  const [state, setState] = useState<SwitchLayoutState | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const protectedMode = useProtect(!!preset);
  const [performer] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join(''),
  );
  const [releaseNotice, setReleaseNotice] = useState('');
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    if (!path || editing) return;
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const next = await presetSwitchLayout(path);
        if (live)
          setState((current) =>
            current?.revision === next.revision ? current : next,
          );
      } catch (e) {
        if (live) setError(friendlyError(e, 'read the switch layout'));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [path, editing]);
  const overrides: SwitchOverrides = {};
  for (const a of state?.layout.switches ?? []) {
    if (!path || !preset || !state || a.profile !== profile) continue;
    const action = a.action;
    const target =
      action.kind === 'freeze'
        ? preset.targets.find(
            (t) => t.node === action.node && t.symbol === action.symbol,
          )
        : undefined;
    const send = (pressed: boolean) => {
      setReleaseNotice('');
      const body: SwitchPress = {
        performer,
        session: preset.session,
        revision: state.revision,
        profile,
        gesture: a.gesture,
        position: a.position,
        pressed,
      };
      queue.current = queue.current
        .then(() => pressPresetSwitch(path, body))
        .then(
          () => {},
          (e) => setError(friendlyError(e, 'use the preset switch')),
        );
    };
    (overrides[a.position] ??= {})[a.gesture] = {
      label:
        action.kind === 'tap_tempo'
          ? 'Tap · ' + notes[action.note]
          : 'Freeze · ' + (target?.label ?? 'Block unavailable'),
      pressed: target?.on,
      run: () => send(true),
      release:
        action.kind === 'freeze' && action.mode === 'gate'
          ? () => send(false)
          : undefined,
    };
  }
  return (
    <>
      {children(overrides, !!preset && !state)}
      {preset && path && (
        <>
          <Button
            variant="outline"
            disabled={protectedMode || !state}
            onClick={() => setEditing(true)}
          >
            Edit preset switches
          </Button>
          {(error ||
            state?.layout.switches.some(
              (a) => a.action.kind === 'freeze' && a.action.mode === 'gate',
            )) && (
            <Button
              variant="outline"
              onClick={() => {
                const session = preset.session;
                queue.current = queue.current
                  .then(() => releasePresetSwitches(path, session))
                  .then(
                    () => {
                      setReleaseNotice('Held switches released.');
                      setError('');
                    },
                    (e) => setError(friendlyError(e, 'release held switches')),
                  );
              }}
            >
              Release held switches
            </Button>
          )}
          {releaseNotice && <p role="status">{releaseNotice}</p>}
          {error && (
            <p role="alert">
              {error}{' '}
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    setState(await presetSwitchLayout(path));
                    setError('');
                  } catch (e) {
                    setError(friendlyError(e, 'reload the switch layout'));
                  }
                }}
              >
                Reload switches
              </Button>
            </p>
          )}
          {editing && state && (
            <Editor
              state={state}
              profile={profile}
              names={names}
              targets={preset.targets}
              midi={preset.midi}
              protectedMode={protectedMode}
              close={() => setEditing(false)}
              save={async (update) =>
                setState(await presetSwitchLayout(path, update))
              }
              reload={async () => setState(await presetSwitchLayout(path))}
            />
          )}
        </>
      )}
    </>
  );
}
