import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';

export type ParallelListen = {
  path: 'both' | 'a' | 'b';
  blend: number;
  invertB: boolean;
  mono: boolean;
};

/** Temporary listening controls for the selected pair of parallel paths. */
export function ParallelListening({
  names,
  state,
  headroom,
  trim,
  onChange,
  onRestore,
}: {
  names: [string, string];
  state: ParallelListen;
  headroom: number | null;
  trim: number | null;
  onChange: (next: ParallelListen) => void;
  onRestore: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Parallel path audition</CardTitle>
      </CardHeader>
      <p>
        {names[0]} · {names[1]}
      </p>
      <SegmentedControl
        aria-label="Listen to paths"
        value={state.path}
        onValueChange={(path) => {
          if (path === 'both' || path === 'a' || path === 'b')
            onChange({ ...state, path });
        }}
      >
        <Segment value="a" aria-label={`Solo ${names[0]}`}>
          Solo A
        </Segment>
        <Segment value="both">Both</Segment>
        <Segment value="b" aria-label={`Solo ${names[1]}`}>
          Solo B
        </Segment>
      </SegmentedControl>
      <Slider
        label="Blend toward path B"
        min={0}
        max={100}
        step={1}
        disabled={state.path !== 'both'}
        value={[state.blend]}
        readout={`${state.blend}% B`}
        onValueChange={([blend]) => {
          if (blend !== undefined) onChange({ ...state, blend });
        }}
      />
      <label className="flex items-center justify-between gap-2">
        Invert path B polarity
        <Switch
          checked={state.invertB}
          onCheckedChange={(invertB) => onChange({ ...state, invertB })}
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        Level-matched mono
        <Switch
          checked={state.mono}
          disabled={!state.mono && trim === null}
          onCheckedChange={(mono) => onChange({ ...state, mono })}
        />
      </label>
      <p role="status">
        {state.mono ? 'Mono' : 'Stereo'} ·{' '}
        {headroom === null
          ? 'Silent merge'
          : `${headroom.toFixed(1)} dB merge headroom`}
        {state.mono &&
          (trim === null
            ? ' · Matching unavailable'
            : ` · ${trim.toFixed(1)} dB listening trim`)}
      </p>
      <Button variant="outline" onClick={onRestore}>
        Return to original stereo
      </Button>
    </Card>
  );
}
