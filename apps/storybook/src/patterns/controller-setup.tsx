import * as React from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { StepProgress } from '../components/ui/states';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Caption } from '../components/ui/text';
import { CONTROLLERS, type SwitchAction } from '../widgets/controllers';

const DOES: Record<SwitchAction['kind'], string> = {
  scene: 'Scene',
  previous: 'Previous preset',
  next: 'Next preset',
  block: 'Block on/off',
  tuner: 'Tuner',
  tap: 'Tap tempo',
  boost: 'Boost',
  play: 'Play backing',
  loop: 'Looper',
  none: 'Nothing',
};
const does = (a: SwitchAction) =>
  a.kind === 'scene' ? `Scene ${a.scene.toUpperCase()}` : DOES[a.kind];

/**
 * Controller setup: pick your controller, pick a starting layout, then press
 * each switch and see what it sends and does. A layout is a starting point;
 * Oxidal cannot see which mode the pedal is in, so pressing each switch is
 * the check. Save names the layout; any preset can still change it.
 */
export function ControllerSetup() {
  const [step, setStep] = React.useState(0);
  const [controller, setController] = React.useState(CONTROLLERS[0]!.id);
  const [layout, setLayout] = React.useState('scenes');
  const [pressed, setPressed] = React.useState<Set<string>>(new Set());
  const [last, setLast] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const profile = CONTROLLERS.find((c) => c.id === controller)!;
  const steps = ['Controller', 'Layout', 'Check each switch', 'Save'];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Controller setup</CardTitle>
        {step > 0 && !saved && (
          <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)}>
            <ArrowLeft /> Back
          </Button>
        )}
      </CardHeader>
      <StepProgress label="Controller setup" steps={steps} current={step} />
      {step === 0 && (
        <div className="grid gap-2">
          {CONTROLLERS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={controller === c.id}
              onClick={() => setController(c.id)}
              className="grid gap-0.5 rounded-lg border border-input px-4 py-2.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
            >
              <span className="font-semibold">{c.name}</span>{' '}
              <span className="text-sm opacity-80">
                {c.switches.length} switches
              </span>
            </button>
          ))}
          <Button className="justify-self-end" onClick={() => setStep(1)}>
            Next
          </Button>
        </div>
      )}
      {step === 1 && (
        <div className="grid gap-2">
          <SegmentedControl
            value={layout}
            onValueChange={setLayout}
            aria-label="Starting layout"
          >
            <Segment value="scenes">Scenes</Segment>
            <Segment value="presets">Presets</Segment>
            <Segment value="stomps">Stomp boxes</Segment>
          </SegmentedControl>
          <Caption>
            {layout === 'scenes'
              ? 'Switches play scenes; the outer pair steps presets.'
              : layout === 'presets'
                ? 'Switches step through the set list.'
                : 'Switches turn blocks on and off, like a pedalboard.'}
          </Caption>
          <Button className="justify-self-end" onClick={() => setStep(2)}>
            Next
          </Button>
        </div>
      )}
      {step === 2 && (
        <div className="grid gap-2">
          <Caption>
            Press each switch on your pedal. Oxidal cannot see which mode the
            pedal is in, so this is how you know it matches.
          </Caption>
          <div
            role="group"
            aria-label="Switches"
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${Math.min(profile.columns, 5)}, minmax(0, 1fr))`,
            }}
          >
            {profile.switches.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setPressed((p) => new Set(p).add(s.id));
                  setLast(s.id);
                }}
                className={cn(
                  'grid min-h-20 content-center gap-0.5 rounded-lg border border-input px-2 text-center text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                  pressed.has(s.id) && 'border-foreground',
                  last === s.id && 'bg-foreground text-background',
                )}
              >
                <span className="text-lg font-semibold">{s.name}</span>{' '}
                <span className="font-mono">CC {16 + i} · ch 1</span>{' '}
                <span>{does(s.tap)}</span>
              </button>
            ))}
          </div>
          <Caption role="status">
            {pressed.size}/{profile.switches.length} switches checked
            {last &&
              ` · last: ${profile.switches.find((s) => s.id === last)!.name} sent CC ${16 + profile.switches.findIndex((s) => s.id === last)}`}
          </Caption>
          <Button className="justify-self-end" onClick={() => setStep(3)}>
            {pressed.size === profile.switches.length
              ? 'Next'
              : 'Skip the rest'}
          </Button>
        </div>
      )}
      {step === 3 && (
        <div className="grid gap-2">
          <label className="grid gap-0.5">
            <span className="small-caps text-xs text-muted-foreground">
              Layout name
            </span>
            <input
              defaultValue={`${profile.switches.length} switches · ${layout}`}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          {saved ? (
            <Caption role="status">
              Saved. Every preset uses it unless the preset sets its own.
            </Caption>
          ) : (
            <Button className="justify-self-end" onClick={() => setSaved(true)}>
              Save layout
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** More than one controller: say which one Oxidal listens to. */
export function ExtraControllers() {
  const [policy, setPolicy] = React.useState('all');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Additional controllers</CardTitle>
      </CardHeader>
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        <li>M-Vave Chocolate · USB · connected</li>
        <li>MIDI Captain STD 10 · USB · connected</li>
      </ul>
      <Select value={policy} onValueChange={setPolicy}>
        <SelectTrigger aria-label="Listen to" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Every controller</SelectItem>
          <SelectItem value="first">The first one only</SelectItem>
          <SelectItem value="each">Each with its own map</SelectItem>
        </SelectContent>
      </Select>
      <Caption className="text-xs">
        {policy === 'each'
          ? 'Each controller keeps its own mappings; the same CC can do different things on each.'
          : policy === 'first'
            ? 'Others are ignored until the first is unplugged.'
            : 'All controllers share one map.'}
      </Caption>
    </Card>
  );
}
