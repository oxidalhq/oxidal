import { useState } from 'react';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import {
  applyLayout,
  checkPassed,
  layoutConflicts,
  profiles,
  type Layout,
  type SwitchRow,
} from './controllerLayouts';
import type { MidiMap } from './api';

type Message = {
  kind: string;
  program?: number;
  controller?: number;
  value?: number;
};

const sameMessage = (row: SwitchRow, message: Message | null | undefined) =>
  !!message &&
  (row.message.program != null
    ? message.kind === 'program' && message.program === row.message.program
    : message.kind === 'control' &&
      message.controller === row.message.controller &&
      (message.value ?? 0) >= 64);

/**
 * Pick a controller and a starting layout, see exactly what each switch sends
 * and does, check the pedal passively, then save. A layout is a starting point:
 * it never proves the pedal is in the expected mode, and it leaves every preset
 * mapping alone.
 * @see docs/architecture.md
 */
export function ControllerSetup({
  map,
  nameOf,
  last,
  recent,
  checking,
  canCheck,
  busy,
  onChecking,
  onApply,
}: {
  map: MidiMap;
  nameOf: (entry: MidiMap['entries'][number]['entry']) => string;
  last: Message | null | undefined;
  recent: Message[];
  checking: boolean;
  canCheck: boolean;
  busy: boolean;
  onChecking: (on: boolean) => void;
  onApply: (content: ReturnType<typeof applyLayout>) => void;
}) {
  const [profileId, setProfileId] = useState('chocolate');
  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0]!;
  const [layoutId, setLayoutId] = useState<Record<string, string>>({});
  const layout: Layout =
    profile.layouts.find((l) => l.id === layoutId[profile.id]) ??
    profile.layouts[0]!;
  const conflicts = layoutConflicts(map, layout, nameOf);
  const [seen, setSeen] = useState(0);
  const passed = checking && checkPassed(layout, recent.slice(seen));
  const isChocolate = profile.id === 'chocolate';
  return (
    <section className="midi-preset-group" aria-label="Controller setup">
      <div className="midi-group-head">
        <div className="min-w-0">
          <h3 className="m-0 text-base">Controller setup</h3>
          <p className="caption mt-0.5">
            Start from a layout, then adjust any switch with Learn below.
          </p>
        </div>
        <label className="field midi-setup-profile">
          Controller
          <Select
            value={profile.id}
            onValueChange={(value) => {
              onChecking(false);
              setProfileId(value);
            }}
          >
            <SelectTrigger aria-label="Controller profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="midi-setup">
        <p className="caption">{profile.evidence}</p>
        <ul className="midi-setup-notes">
          {profile.setup.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div
          role="radiogroup"
          aria-label="Starting layout"
          className="midi-layouts"
        >
          {profile.layouts.map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={l.id === layout.id}
              onClick={() => {
                onChecking(false);
                setLayoutId({ ...layoutId, [profile.id]: l.id });
              }}
            >
              <strong>{l.label}</strong>
              <small>{l.summary}</small>
            </button>
          ))}
        </div>
        <ol
          className="midi-switches"
          aria-label="What each switch does"
          data-pedal={isChocolate ? 'chocolate' : 'generic'}
        >
          {layout.switches.map((row) => (
            <li
              key={row.switch}
              data-received={sameMessage(row, last) || undefined}
            >
              <span className="midi-switch-name">{row.switch}</span>
              <span className="midi-switch-does">{row.does}</span>
              <code>{row.sends}</code>
            </li>
          ))}
        </ol>
        {isChocolate && (
          <p className="midi-switch-bank" role="note">
            E = A+B and F = C+D are the pedal’s own bank down/up (CC 2 and CC 3,
            value 5). They change which Program A–D send and are not assigned.
          </p>
        )}
        {conflicts.length > 0 && (
          <p role="alert" className="midi-setup-conflict">
            Already used by a preset mapping: {conflicts.join(', ')}. Clear or
            change those first.
          </p>
        )}
        <div className="midi-setup-actions">
          <Button
            variant={checking ? 'secondary' : 'outline'}
            disabled={!checking && !canCheck}
            aria-pressed={checking}
            onClick={() => {
              setSeen(recent.length);
              onChecking(!checking);
            }}
          >
            {checking ? 'Stop check' : 'Check pedal'}
          </Button>
          <Button
            disabled={busy || conflicts.length > 0}
            onClick={() => onApply(applyLayout(map, layout))}
          >
            Save layout
          </Button>
        </div>
        {checking && (
          <p className="caption" role="status">
            {passed
              ? `Received ${layout.check.press} as expected.`
              : `Press ${layout.check.press} on the pedal. Oxidal listens and does nothing.`}
          </p>
        )}
      </div>
    </section>
  );
}
