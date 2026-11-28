import { type ReactNode, useEffect, useRef, useState } from 'react';

import {
  type EdgeFigure,
  EdgeLanes,
} from '@oxidal/design-system/patterns/edge-lanes';

import { midiDevices, type RigAudioState } from '../../api';
import { BoostControl } from '../../BoostControl';
import { GuitarLane } from '../../GuitarSettings';
import { OutLevelButton } from '../../MasterLevel';
import { boostKey } from '../../presetChoices';
import { useResource } from '../../resourceContext';
import { requestScreen } from '../../screenNavigation';
import { useDockParts } from '../dock/dockParts';
import type { RigViewProps } from './useMixedRigSession';

const minus = (text: string) => text.replace('-', '−');
const loudest = (pair?: [number | null, number | null] | null) => {
  const values = (pair ?? []).flatMap((v) => (v == null ? [] : [v]));
  return values.length ? Math.max(...values) : null;
};

/** The pointer or a drag is moving: the edge figures fade further. */
function useMoving() {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      setMoving(true);
      clearTimeout(t);
      t = setTimeout(() => setMoving(false), 800);
    };
    window.addEventListener('pointermove', on);
    window.addEventListener('wheel', on);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', on);
      window.removeEventListener('wheel', on);
    };
  }, []);
  return moving;
}

/**
 * The controller's own name for a port such as "hw:SINCO,0,0", once known.
 * Asked again when the controller connects, so a controller plugged in
 * later gets its name; null while the port is not in the device list.
 */
function usePortName(port: string | undefined, connected: boolean) {
  const [names, setNames] = useState<Record<string, string>>({});
  const asked = useRef('');
  useEffect(() => {
    const ask = `${port}|${connected}`;
    if (!port || asked.current === ask) return;
    asked.current = ask;
    midiDevices()
      .then((d) =>
        setNames(Object.fromEntries(d.inputs.map((i) => [i.id, i.name]))),
      )
      .catch(() => {});
  }, [port, connected]);
  return port ? (names[port] ?? null) : undefined;
}

type RigMidi = NonNullable<RigAudioState['control']>['midi'];

/** "Program 3" or "CC 64 · 127" for a moment after a controller sends it. */
function useMidiMessage(midi: RigMidi | undefined) {
  const [shown, setShown] = useState<string | null>(null);
  const events = useRef(midi?.events);
  useEffect(() => {
    const before = events.current;
    events.current = midi?.events;
    const last = midi?.last;
    if (before === undefined || midi?.events === before || !last) return;
    setShown(
      last.kind === 'program'
        ? `Program ${last.program + 1}`
        : `CC ${last.controller} · ${last.value}`,
    );
    const t = setTimeout(() => setShown(null), 1500);
    return () => clearTimeout(t);
  }, [midi?.events, midi?.last]);
  return shown;
}

/**
 * The Rig's edge lanes over the chain: the IN meter with the guitar under it
 * and the input peak and foot controller beside it; the OUT meter with the
 * output level (Mono and the preset's boost) under it and DSP, CPU, xruns
 * and clips beside it, with memory and temperature only when they need
 * attention. Every figure is one the device already reports; a phone has
 * no lanes and keeps the guitar and level in the panel.
 * @see docs/interface.md
 */
export function DeviceEdgeLanes({
  midi,
  midiPort,
  boost,
  figuresFrom,
  className,
}: {
  /** The sounding engine's MIDI status, when it listens to a controller. */
  midi?: RigMidi;
  /** The configured MIDI input port, such as "hw:SINCO,0,0". */
  midiPort?: string;
  /** The boost beside the OUT level, for the sounding preset. */
  boost?: ReactNode;
  figuresFrom?: number;
  className?: string;
}) {
  const resource = useResource();
  const moving = useMoving();
  const midiName = usePortName(midiPort, !!midi?.connected);
  const message = useMidiMessage(midi);
  // The folded dock icons sit in the lanes' bottom rows, beside the guitar
  // and the output level, never over a meter (as in Storybook's Rig).
  const strips = useDockParts()?.strips;
  if (!resource) return null;
  const { readings, levels, running } = resource;
  const input = loudest(levels?.input);
  const output = loudest(levels?.output);
  const left: EdgeFigure[] = [];
  if (input != null)
    left.push({
      label: 'Input',
      value: minus(`${Math.round(input)} dBFS`),
      attention: input > -3,
    });
  // A port missing from the device list is a controller that is not
  // plugged in: say so rather than showing the raw port id.
  if (midiPort)
    left.push({
      label: 'MIDI',
      value: message ?? midiName ?? 'Not connected',
      light: midi?.connected ? 'on' : 'off',
      attention: !!midi?.error,
      title: `${midiName ?? midiPort} ${midi?.connected ? 'connected' : 'not connected'}. Open Settings › MIDI`,
      onOpen: () => requestScreen({ screen: 'settings', section: 'midi' }),
    });
  const right: EdgeFigure[] = [];
  if (readings.dsp)
    right.push({
      label: 'DSP',
      value: `${Math.round(readings.dsp.p95 * 100)}%`,
      attention: readings.dsp.peak > 0.9,
    });
  if (readings.cpu != null)
    right.push({
      label: 'CPU',
      value: `${Math.round(readings.cpu)}%`,
      attention: readings.cpu > 85,
    });
  if (readings.xruns != null)
    right.push({
      label: 'Xruns',
      value: String(readings.xruns),
      attention: readings.xruns > 0,
    });
  if (readings.clips != null)
    right.push({
      label: 'Clips',
      value: String(readings.clips),
      attention: readings.clips > 0,
    });
  // Shown only when they need attention.
  if (readings.ram && readings.ram.used / readings.ram.total > 0.9)
    right.push({
      label: 'RAM',
      value: `${Math.round((100 * readings.ram.used) / readings.ram.total)}%`,
      attention: true,
    });
  if (readings.temperature != null && readings.temperature >= 80)
    right.push({
      label: 'Temp',
      value: `${Math.round(readings.temperature)} °C`,
      attention: true,
    });
  return (
    <EdgeLanes
      className={className}
      figuresFrom={figuresFrom}
      stopped={!running}
      playing={running}
      moving={moving}
      input={{
        level: input,
        figures: left,
        control: (
          <span className="flex items-center gap-4">
            <GuitarLane />
            {strips?.left}
          </span>
        ),
      }}
      output={{
        level: output,
        figures: right,
        control: (
          <span className="flex items-center gap-4">
            {strips?.right}
            <OutLevelButton boost={boost} />
          </span>
        ),
      }}
    />
  );
}

/**
 * The mixed Rig's edge lanes: the device lanes with its controller and the
 * Boost of the sounding preset and scene.
 */
export function RigEdgeLanes({
  rig,
  vm,
  figuresFrom,
  className,
}: RigViewProps & { figuresFrom?: number; className?: string }) {
  const { matching } = rig;
  const scene = vm.soundingScene;
  return (
    <DeviceEdgeLanes
      className={className}
      figuresFrom={figuresFrom}
      midi={vm.state.control?.midi}
      midiPort={vm.state.configured?.midi?.input || undefined}
      boost={
        matching ? (
          <BoostControl
            targets={[
              {
                key: boostKey.scenes(matching.manifest.id),
                label: matching.manifest.name,
              },
              ...(scene
                ? [
                    {
                      key: boostKey.scene(matching.manifest.id, scene.id),
                      label: `Scene · ${scene.name}`,
                    },
                  ]
                : []),
            ]}
          />
        ) : undefined
      }
    />
  );
}
