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
  layoutFromCurrent,
  profiles,
  savedToLayout,
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
  onSaved,
  canLearnNav,
  onLearnNav,
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
  onSaved: (layouts: NonNullable<MidiMap['saved_layouts']>) => void;
  canLearnNav: boolean;
  onLearnNav: (key: 'previous' | 'next' | 'mute') => void;
}) {
  const [selected, setSelected] = useState('');
  const saved = map.saved_layouts ?? [];
  const [name, setName] = useState('');
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
              <button
                type="button"
                aria-pressed={selected === row.switch}
                onClick={() =>
                  setSelected(selected === row.switch ? '' : row.switch)
                }
              >
                <span className="midi-switch-name">{row.switch}</span>
                <span className="midi-switch-does">{row.does}</span>
                <code>{row.sends}</code>
              </button>
            </li>
          ))}
        </ol>
        {(() => {
          const row = layout.switches.find((r) => r.switch === selected);
          if (!row) return null;
          const key = (
            {
              'Previous preset': 'previous',
              'Next preset': 'next',
              'Mute output': 'mute',
            } as const
          )[row.does as 'Previous preset'];
          return (
            <div className="midi-switch-detail" aria-live="polite">
              <p>
                <strong>{row.switch}</strong> sends {row.sends} and runs{' '}
                {row.does}.
              </p>
              {key ? (
                <Button
                  variant="outline"
                  disabled={!canLearnNav}
                  onClick={() => onLearnNav(key)}
                >
                  Learn another switch for {row.does}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() =>
                    document
                      .querySelector('.midi-preset-list')
                      ?.scrollIntoView?.({ block: 'start' })
                  }
                >
                  Show in mappings
                </Button>
              )}
            </div>
          );
        })()}
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
        <div className="midi-saved" role="group" aria-label="Saved layouts">
          <h4 className="m-0 text-sm">Saved layouts</h4>
          <div className="midi-saved-new">
            <label className="field min-w-0">
              Layout name
              <input
                value={name}
                maxLength={48}
                placeholder="Stage setup"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <Button
              variant="outline"
              disabled={busy || !name.trim() || saved.length >= 32}
              onClick={() => {
                onSaved([
                  ...saved,
                  layoutFromCurrent(
                    map,
                    profile.id,
                    name,
                    saved.map((item) => item.id),
                  ),
                ]);
                setName('');
              }}
            >
              Save current as layout
            </Button>
          </div>
          {saved.length === 0 ? (
            <p className="caption">
              Save the template and triggers you have now to reuse or share
              them. Export keeps saved layouts.
            </p>
          ) : (
            <ul className="midi-saved-list">
              {saved.map((item) => {
                const asLayout = savedToLayout(item);
                const clash = layoutConflicts(map, asLayout, nameOf);
                return (
                  <li key={item.id}>
                    <div className="min-w-0">
                      <strong>{item.name}</strong>
                      <small>{asLayout.summary}</small>
                      {clash.length > 0 && (
                        <small role="alert" className="midi-setup-conflict">
                          Already used by a preset mapping: {clash.join(', ')}
                        </small>
                      )}
                    </div>
                    <div className="midi-actions">
                      <Button
                        variant="outline"
                        className="midi-tool"
                        disabled={busy || clash.length > 0}
                        onClick={() => onApply(applyLayout(map, asLayout))}
                      >
                        Apply <span className="sr-only">{item.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        className="midi-tool"
                        disabled={busy}
                        title="Replace with the current template and triggers"
                        onClick={() =>
                          onSaved(
                            saved.map((s) =>
                              s.id === item.id
                                ? {
                                    ...layoutFromCurrent(
                                      map,
                                      s.profile,
                                      s.name,
                                      [],
                                    ),
                                    id: s.id,
                                  }
                                : s,
                            ),
                          )
                        }
                      >
                        Update <span className="sr-only">{item.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        className="midi-tool"
                        disabled={busy || saved.length >= 32}
                        onClick={() => {
                          const { id, name: copyName } = layoutFromCurrent(
                            {},
                            item.profile,
                            `Copy of ${item.name}`,
                            saved.map((s) => s.id),
                          );
                          onSaved([...saved, { ...item, id, name: copyName }]);
                        }}
                      >
                        Duplicate <span className="sr-only">{item.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        className="midi-tool text-destructive"
                        disabled={busy}
                        onClick={() =>
                          onSaved(saved.filter((s) => s.id !== item.id))
                        }
                      >
                        Delete <span className="sr-only">{item.name}</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
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
