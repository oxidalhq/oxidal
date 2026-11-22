import { useRef, useState } from 'react';

import {
  CONTROLLERS,
  type SwitchAction,
} from '@oxidal/design-system/widgets/controllers';
import { Footswitches } from '@oxidal/design-system/widgets/footswitches';

import { sendTempo } from '../../api';
import { useSessionMedia } from '../../components/media/sessionMedia';
import { friendlyError } from '../../lib/friendlyError';
import { requestTuner } from '../../tunerNavigation';

export type StageSceneControls = {
  active: string | null;
  scenes: { id: string; name: string }[];
  onSelect: (id: string) => void;
};

const unassigned: SwitchAction = { kind: 'none' };

export function StageFootswitches({
  layout,
  scenes,
  blocks,
  disabled,
  tempo,
  onStep,
  onToggle,
}: {
  layout: 'four' | 'ten';
  scenes?: StageSceneControls;
  blocks: { id: string; label: string; on: boolean }[];
  disabled: boolean;
  tempo?: { bpm?: number | null };
  onStep: (direction: 'previous' | 'next') => void;
  onToggle: (id: string) => void;
}) {
  const media = useSessionMedia();
  const [error, setError] = useState('');
  const tapPending = useRef(false);
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
        tap.kind === 'boost' ||
        (tap.kind === 'tap' && !tempo) ||
        (tap.kind === 'play' && (!canPlay || media.pending))
      )
        tap = unassigned;
      if (hold?.kind === 'tap' && !tempo) hold = undefined;
      if (hold && ['boost', 'loop'].includes(hold.kind)) hold = undefined;
      return { ...item, tap, hold };
    }),
  };
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
      <Footswitches
        profile={mapped}
        state={{
          scene: scenes?.active ?? null,
          scenes: liveScenes,
          blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
          boost: false,
          tuner: false,
          playing: play,
          loop: false,
          bpm: tempo?.bpm,
        }}
        disabled={disabled}
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
            case 'tap':
              return void tapTempo();
            case 'play':
              return void media.send({ kind: play ? 'pause' : 'play' });
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
