import * as React from 'react';
import { PlugsConnected } from '@phosphor-icons/react';
import { parseMidiBytes, type MidiMessage } from '../lib/midi';
import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Caption } from '../components/ui/text';
import { useMidi } from './midi-context';

/**
 * A pretend foot controller for trying MIDI without hardware: four switches
 * sending CC presses, an expression pedal sending CC values, and two
 * Program Change buttons. Sends into the nearest MidiProvider.
 */
export function PretendController({
  channel = 1,
  switches = [20, 21, 22, 23],
  expression = 30,
}: {
  channel?: number;
  switches?: number[];
  expression?: number;
}) {
  const midi = useMidi();
  const [pedal, setPedal] = React.useState(64);
  if (!midi) return null;
  const send = (message: MidiMessage) => midi.receive(message);
  return (
    <section
      aria-label="Pretend MIDI controller"
      className="grid gap-3 rounded-lg border border-dashed border-wire p-3"
    >
      <span className="small-caps text-sm font-medium text-muted-foreground">
        Pretend controller · channel {channel}
      </span>
      <div className="grid grid-cols-4 gap-2">
        {switches.map((cc, i) => (
          <Button
            key={cc}
            variant="outline"
            onClick={() =>
              send({ kind: 'cc', channel, number: cc, value: 127 })
            }
            className="h-14 flex-col gap-0"
          >
            <span className="text-md font-bold">{'ABCD'[i]}</span>
            <span className="font-mono text-2xs text-muted-foreground">
              CC {cc}
            </span>
          </Button>
        ))}
      </div>
      <Slider
        label={`Expression pedal · CC ${expression}`}
        min={0}
        max={127}
        value={[pedal]}
        onValueChange={([v]) => {
          if (v === undefined) return;
          setPedal(v);
          send({ kind: 'cc', channel, number: expression, value: v });
        }}
        readout={String(pedal)}
      />
      <div className="flex gap-2">
        {[0, 1].map((p) => (
          <Button
            key={p}
            size="sm"
            variant="outline"
            onClick={() => send({ kind: 'pc', channel, number: p })}
          >
            Program {p}
          </Button>
        ))}
      </div>
    </section>
  );
}

/**
 * Listen to a real controller plugged into this computer, where the browser
 * offers Web MIDI (Chrome and Edge; not Safari). Asks permission first.
 */
export function WebMidiButton() {
  const midi = useMidi();
  const [state, setState] = React.useState<
    'off' | 'asking' | 'on' | 'unavailable' | 'denied'
  >(
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
      ? 'off'
      : 'unavailable',
  );
  const [inputs, setInputs] = React.useState<string[]>([]);
  if (!midi) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={
          state === 'unavailable' || state === 'asking' || state === 'on'
        }
        onClick={async () => {
          setState('asking');
          try {
            const access = await navigator.requestMIDIAccess();
            const names: string[] = [];
            access.inputs.forEach((input) => {
              names.push(input.name ?? 'MIDI input');
              input.onmidimessage = (event) => {
                const message = event.data ? parseMidiBytes(event.data) : null;
                if (message) midi.receive(message);
              };
            });
            setInputs(names);
            setState('on');
          } catch {
            setState('denied');
          }
        }}
      >
        <PlugsConnected />{' '}
        {state === 'on'
          ? 'Listening to MIDI'
          : 'Use a MIDI device on this computer'}
      </Button>
      <Caption as="span" className="text-xs">
        {state === 'unavailable' &&
          'This browser has no Web MIDI; use Chrome or Edge, or the pretend controller.'}
        {state === 'denied' &&
          'MIDI was not allowed. Allow it in the browser’s site settings and try again.'}
        {state === 'on' &&
          (inputs.length
            ? `Inputs: ${inputs.join(', ')}`
            : 'No MIDI inputs found; plug one in and reload.')}
      </Caption>
    </div>
  );
}
