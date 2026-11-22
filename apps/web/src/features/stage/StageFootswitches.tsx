import { useRef, useState } from 'react';

import {
  CONTROLLERS,
  type SwitchAction,
} from '@oxidal/design-system/widgets/controllers';
import { Footswitches } from '@oxidal/design-system/widgets/footswitches';

import { boostMidi, sendTempo } from '../../api';
import { useSessionMedia } from '../../components/media/sessionMedia';
import { friendlyError } from '../../lib/friendlyError';
import { requestTuner } from '../../tunerNavigation';
import { StageSwitchLayout, type StageSwitchPreset } from './StageSwitchLayout';

export type StageSceneControls = {
  active: string | null;
  scenes: { id: string; name: string }[];
  onSelect: (id: string) => void;
};

const unassigned: SwitchAction = { kind: 'none' };

export function StageFootswitches({
  layout,
  preset,
  scenes,
  blocks,
  disabled,
  tempo,
  boost,
  onStep,
  onToggle,
}: {
  layout: 'four' | 'ten';
  preset?: StageSwitchPreset;
  scenes?: StageSceneControls;
  blocks: { id: string; label: string; on: boolean }[];
  disabled: boolean;
  tempo?: { bpm?: number | null };
  boost?: boolean;
  onStep: (direction: 'previous' | 'next') => void;
  onToggle: (id: string) => void;
}) {
  const media = useSessionMedia();
  const [error, setError] = useState('');
  const tapPending = useRef(false);
  const boostPending = useRef(false);
  const play = media.shown === 'playing' || media.shown === 'stalled';
  const canPlay =
    !!media.player?.track &&
    ['ready', 'paused', 'playing', 'stalled', 'ended'].includes(media.shown);
  const profile = CONTROLLERS.find((item) => item.id === layout)!;
  const liveScenes = scenes?.scenes ?? [];
  function mappedBlock(key: string): SwitchAction | undefined {
    const block =
      blocks.find((item) => item.id === key) ?? blocks[key === 'ts9' ? 0 : 1];
    return block ? { kind: 'block', block: block.id } : undefined;
  }
  const mapped = {
    ...profile,
    switches: profile.switches.map((item) => {
      let tap = item.tap;
      let hold = item.hold;
      if (tap.kind === 'scene') {
        const scene = liveScenes['abcd'.indexOf(tap.scene)];
        tap = scene ? { kind: 'scene', scene: scene.id } : unassigned;
      }
      if (tap.kind === 'block') tap = mappedBlock(tap.block) ?? unassigned;
      if (hold?.kind === 'block') hold = mappedBlock(hold.block);
      if (
        (tap.kind === 'boost' && boost == null) ||
        (tap.kind === 'tap' && !tempo) ||
        (tap.kind === 'play' && (!canPlay || media.pending))
      )
        tap = unassigned;
      if (hold?.kind === 'tap' && !tempo) hold = undefined;
      if (hold?.kind === 'boost' && boost == null) hold = undefined;
      if (hold?.kind === 'loop' && (!canPlay || media.pending))
        hold = undefined;
      return { ...item, tap, hold };
    }),
  };
  async function toggleBoost() {
    if (boost == null || boostPending.current) return;
    boostPending.current = true;
    setError('');
    try {
      await boostMidi();
    } catch (cause) {
      setError(friendlyError(cause, 'toggle boost'));
    } finally {
      boostPending.current = false;
    }
  }
  async function tapTempo() {
    if (!tempo || tapPending.current) return;
    tapPending.current = true;
    setError('');
    try {
      await sendTempo({ kind: 'tap' });
    } catch (cause) {
      setError(friendlyError(cause, 'tap tempo'));
    } finally {
      tapPending.current = false;
    }
  }
  return (
    <>
      <StageSwitchLayout
        preset={preset}
        profile={layout}
        names={profile.switches.map((s) => s.name)}
      >
        {(overrides, loading) => (
          <Footswitches
            profile={mapped}
            overrides={overrides}
            state={{
              scene: scenes?.active ?? null,
              scenes: liveScenes,
              blocks: Object.fromEntries(
                blocks.map((block) => [block.id, block]),
              ),
              boost: boost ?? false,
              tuner: false,
              playing: play,
              loop: media.player?.repeat ?? false,
              bpm: tempo?.bpm,
            }}
            disabled={disabled || loading}
            onAction={(action) => {
              switch (action.kind) {
                case 'scene':
                  return scenes?.onSelect(action.scene);
                case 'previous':
                case 'next':
                  return onStep(action.kind);
                case 'block':
                  return onToggle(action.block);
                case 'tuner':
                  return requestTuner();
                case 'boost':
                  return void toggleBoost();
                case 'tap':
                  return void tapTempo();
                case 'loop':
                  if (media.player && canPlay && !media.pending)
                    return void media.send({
                      kind: 'set_repeat',
                      repeat: !media.player.repeat,
                    });
                  return;
                case 'play':
                  return void media.send({ kind: play ? 'pause' : 'play' });
              }
            }}
          />
        )}
      </StageSwitchLayout>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
