import { useEffect, useRef, useState } from 'react';

import { Card } from '@oxidal/design-system/components/card';
import { Caption, Title } from '@oxidal/design-system/components/text';

import {
  type AudioState,
  type GraphAudioState,
  graphAudioState,
  type MidiMap,
  playbackCommand,
  playbackState,
  rigAudioCommand,
  type RigAudioState,
  rigAudioState,
} from './api';
import { RecoveryAction } from './FailureNotice';
import { friendlyError } from './lib/friendlyError';
import { useFailure } from './lib/useFailure';
import { MidiMapScreen } from './MidiMapScreen';
import { MidiControls } from './SceneMidi';

/** Settings and Rig configure the same sounding MIDI owner. */
export function MidiSettings({ connected }: { connected: boolean }) {
  const { failure: recoverFailure, fail: recoverFail } = useFailure();
  const [native, setNative] = useState<AudioState | null>(null);
  const [graph, setGraph] = useState<GraphAudioState | null>(null);
  const [mixed, setMixed] = useState<RigAudioState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applyError, setApplyError] = useState('');
  const generation = useRef(0);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      let nextDelay = 3000;
      const opening = generation.current;
      try {
        const [a, b, g] = await Promise.all([
          playbackState(),
          rigAudioState(),
          graphAudioState(),
        ]);
        nextDelay =
          (a.phase === 'running' && a.midi?.connected) ||
          (b.phase === 'running' && b.control?.midi?.connected) ||
          (g?.phase === 'running' &&
            !!g.midi &&
            (g.midi.connected ||
              g.midi.sources?.some((source) => source.connected)))
            ? 750
            : 3000;
        if (active && !sending.current && opening === generation.current) {
          setGraph(g);
          setNative(a);
          setMixed(b);
          setError('');
        }
      } catch (cause) {
        if (active) {
          setError(friendlyError(cause, 'read MIDI settings'));
          recoverFail(cause, 'read MIDI settings', () => void refresh());
        }
      } finally {
        if (active) timer = setTimeout(() => void refresh(), nextDelay);
      }
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [recoverFail]);
  const activeNative = native?.phase === 'running';
  const activeMixed = mixed?.phase === 'running' && mixed.control;
  async function syncPlayingMap(map: MidiMap) {
    const entry = map.entries.find((candidate) => {
      if (
        activeNative &&
        native.configured &&
        !native.configured.draft &&
        native.configured.owned
      ) {
        return (
          candidate.entry.kind === 'owned' &&
          candidate.entry.id === native.configured.preset_id
        );
      }
      return (
        activeMixed &&
        mixed.configured &&
        candidate.entry.kind === 'rig' &&
        candidate.entry.id === mixed.configured.revision
      );
    });
    const settings = map.input
      ? {
          input: map.input,
          channel: map.channel,
          extra_inputs: map.extra_inputs ?? [],
          bindings: entry?.bindings ?? [],
          branch_bindings: entry?.branch_bindings ?? [],
          parameter_bindings: entry?.parameter_bindings ?? [],
        }
      : null;
    sending.current = true;
    generation.current++;
    setBusy(true);
    setApplyError('');
    try {
      if (activeNative) {
        setNative(await playbackCommand(native, { kind: 'midi', settings }));
      } else if (activeMixed) {
        setMixed(await rigAudioCommand(mixed, { kind: 'midi', settings }));
      }
    } catch (cause) {
      setApplyError(friendlyError(cause, 'change MIDI settings'));
      recoverFail(
        cause,
        'change MIDI settings',
        () => void syncPlayingMap(map),
      );
      throw cause;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <Card className="space-y-4" aria-label="MIDI device settings">
      <div className="space-y-1">
        <Title as="h2" size="sm">
          MIDI map
        </Title>
        <Caption>
          Preset recall follows the Mine set-list. Scene and control mappings
          stay with each saved preset.
        </Caption>
      </div>
      {(applyError || error) && <p role="alert">{applyError || error}</p>}
      {(applyError || error) && <RecoveryAction failure={recoverFailure} />}
      <MidiMapScreen
        connected={connected && !busy && !error}
        native={native}
        mixed={mixed}
        graph={graph}
        onMapApplied={syncPlayingMap}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {activeNative ? (
          <MidiControls
            key={`native:${native.session}`}
            configured={native.configured?.midi ?? null}
            preset={
              native.configured &&
              !native.configured.draft &&
              native.configured.owned
                ? { kind: 'owned' as const, id: native.configured.preset_id }
                : undefined
            }
            disabled={!connected || busy || !!error}
            control={{
              midi: native.midi,
              scenes: null,
              branches: [],
              controls: native.controls.map((c) => ({
                target: {
                  kind: 'native',
                  node: 'native',
                  parameter: c.target,
                },
                label: c.label,
                value: c.value,
                minimum: 0,
                maximum: 1,
                integer: c.toggle,
                toggle: c.toggle,
                logarithmic: false,
                display: c.display,
              })),
            }}
            onApply={async (settings) => {
              if (sending.current) return;
              sending.current = true;
              generation.current++;
              setBusy(true);
              setApplyError('');
              try {
                setNative(
                  await playbackCommand(native, { kind: 'midi', settings }),
                );
              } catch (cause) {
                setApplyError(friendlyError(cause, 'change MIDI settings'));
                recoverFail(cause, 'change MIDI settings');
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          />
        ) : activeMixed ? (
          <MidiControls
            key={`mixed:${mixed.session}`}
            configured={mixed.configured?.midi ?? null}
            preset={
              mixed.configured
                ? { kind: 'rig' as const, id: mixed.configured.revision }
                : undefined
            }
            control={mixed.control ?? null}
            disabled={!connected || busy || !!error}
            onApply={async (settings) => {
              if (sending.current) return;
              sending.current = true;
              generation.current++;
              setBusy(true);
              setApplyError('');
              try {
                setMixed(
                  await rigAudioCommand(mixed, { kind: 'midi', settings }),
                );
              } catch (cause) {
                setApplyError(friendlyError(cause, 'change MIDI settings'));
                recoverFail(cause, 'change MIDI settings');
              } finally {
                sending.current = false;
                setBusy(false);
              }
            }}
          />
        ) : (
          <Caption>
            {!native || !mixed
              ? 'Reading the playing preset…'
              : graph?.phase === 'running' && graph.midi
                ? 'This effects rig receives device-wide MIDI controls.'
                : 'Play a preset to add or edit its scene and control mappings.'}
          </Caption>
        )}
        {(activeNative || activeMixed) && (
          <Caption as="span">Edit the playing preset’s assignments</Caption>
        )}
      </div>
    </Card>
  );
}
