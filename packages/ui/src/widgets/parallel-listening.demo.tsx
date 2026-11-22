import { useState } from 'react';

import { type ParallelListen, ParallelListening } from './parallel-listening';

const original: ParallelListen = {
  path: 'both',
  blend: 50,
  invertB: false,
  mono: false,
};

/** Stereo paths from the same test phrase, with different harmonics on B. */
const phrase = Array.from({ length: 1024 }, (_, i) => {
  const phase = (i * 2 * Math.PI) / 64;
  return [
    0.5 * Math.sin(phase),
    0.32 * Math.sin(phase) + 0.12 * Math.sin(phase * 3),
  ] as const;
});

export function ParallelListeningDemo({
  names = ['Plexi 50', 'AC30 top boost'],
}: {
  names?: [string, string];
}) {
  const [state, setState] = useState(original);
  const a =
    state.path === 'a' ? 1 : state.path === 'b' ? 0 : 1 - state.blend / 100;
  const b =
    (state.path === 'b' ? 1 : state.path === 'a' ? 0 : state.blend / 100) *
    (state.invertB ? -1 : 1);
  let stereoEnergy = 0;
  let monoEnergy = 0;
  let monoPeak = 0;
  let stereoPeak = 0;
  for (const [left, right] of phrase) {
    const l = a * left;
    const r = b * right;
    const mono = (l + r) / 2;
    stereoEnergy += (l * l + r * r) / 2;
    monoEnergy += mono * mono;
    monoPeak = Math.max(monoPeak, Math.abs(mono));
    stereoPeak = Math.max(stereoPeak, Math.abs(l), Math.abs(r));
  }
  const gain = monoEnergy > 0 ? Math.sqrt(stereoEnergy / monoEnergy) : 0;
  const trim = gain > 0 && gain * monoPeak <= 1 ? 20 * Math.log10(gain) : null;
  const peak = state.mono ? monoPeak * (trim === null ? 1 : gain) : stereoPeak;
  return (
    <ParallelListening
      names={names}
      state={state}
      trim={trim}
      headroom={peak > 0 ? -20 * Math.log10(peak) : null}
      onChange={setState}
      onRestore={() => setState(original)}
    />
  );
}
