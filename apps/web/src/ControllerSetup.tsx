import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { FormField } from '@oxidal/design-system/components/form-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { StepProgress } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';

import type { MidiMap } from './api';
import {
  applyLayout,
  type Layout,
  layoutConflicts,
  layoutFromCurrent,
  type Message,
  profiles,
  sameMessage,
  savedToLayout,
} from './controllerLayouts';

type PresetOption = {
  entry: MidiMap['entries'][number]['entry'];
  name: string;
  mappings: number;
};

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
  listening,
  canCheck,
  busy,
  onChecking,
  onApply,
  onSaved,
  presets,
  onApplyToPreset,
  onSaveGuided,
  canLearnNav,
  onLearnNav,
}: {
  map: MidiMap;
  nameOf: (entry: MidiMap['entries'][number]['entry']) => string;
  last: Message | null | undefined;
  recent: { seq: number; message: Message }[];
  checking: boolean;
  listening: boolean;
  canCheck: boolean;
  busy: boolean;
  onChecking: (on: boolean) => void;
  onApply: (content: ReturnType<typeof applyLayout>) => void;
  onSaved: (layouts: NonNullable<MidiMap['saved_layouts']>) => void;
  presets: PresetOption[];
  onApplyToPreset: (
    content: ReturnType<typeof applyLayout>,
    entry: PresetOption['entry'],
  ) => void;
  onSaveGuided: (
    content: ReturnType<typeof applyLayout>,
    saved: NonNullable<MidiMap['saved_layouts']>,
  ) => Promise<boolean>;
  canLearnNav: boolean;
  onLearnNav: (key: 'previous' | 'next' | 'mute' | 'tuner') => void;
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
  const [step, setStep] = useState<number | null>(null);
  const [seen, setSeen] = useState(0);
  const [heard, setHeard] = useState<string[]>([]);
  const [savedName, setSavedName] = useState('');
  const observed =
    checking && listening ? recent.filter((item) => item.seq > seen) : [];
  if (observed.length) {
    setSeen(observed[observed.length - 1]!.seq);
    setHeard([
      ...new Set([
        ...heard,
        ...layout.switches
          .filter((row) =>
            observed.some((event) => sameMessage(row, event.message)),
          )
          .map((row) => row.switch),
      ]),
    ]);
  }
  function startCheck() {
    setSeen(recent.at(-1)?.seq ?? 0);
    setHeard([]);
    onChecking(true);
  }
  function move(next: number | null) {
    onChecking(false);
    setStep(next);
    if (next === 0 || next === 1) setHeard([]);
  }
  const [presetKey, setPresetKey] = useState('');
  const [confirmPreset, setConfirmPreset] = useState('');
  const chosenPreset = presets.find(
    (preset) => `${preset.entry.kind}:${preset.entry.id}` === presetKey,
  );
  const passed = checking && heard.includes(layout.check.press);
  const isChocolate = profile.id === 'chocolate';
  return (
    <section
      className="min-w-0 border-b border-border last:border-b-0"
      aria-label="Controller setup"
    >
      <div className="grid min-w-0 items-center gap-x-4 gap-y-2 bg-muted/55 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h3 className="m-0 text-base">Controller setup</h3>
          <Caption className="mt-0.5">
            Start from a layout, then adjust any switch with Learn below.
          </Caption>
        </div>
        {step === null ? (
          <Button
            variant="outline"
            onClick={() => {
              setSavedName('');
              move(0);
            }}
          >
            Guided setup
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => move(null)}>
            Exit guide
          </Button>
        )}
      </div>
      {savedName && <p role="status">Saved {savedName}.</p>}
      {step !== null && (
        <StepProgress
          label="Controller setup"
          steps={['Controller', 'Layout', 'Check each switch', 'Save']}
          current={step}
        />
      )}
      {(step === null || step === 0) && (
        <>
          <FormField className="min-w-0 sm:min-w-56">
            Controller
            <Select
              value={profile.id}
              onValueChange={(value) => {
                onChecking(false);
                setHeard([]);
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
          </FormField>
        </>
      )}
      <div className="grid gap-3 border-t border-border/70 p-3">
        {(step === null || step === 0) && (
          <>
            <Caption>{profile.evidence}</Caption>
            <ul className="m-0 list-disc pl-5 text-sm text-muted-foreground">
              {profile.setup.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
        {(step === null || step === 1) && (
          <div
            role="radiogroup"
            aria-label="Starting layout"
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2"
          >
            {profile.layouts.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                className="grid content-start gap-1 rounded-lg border border-input px-3 py-2.5 text-left aria-checked:border-foreground aria-checked:ring-1"
                aria-checked={l.id === layout.id}
                onClick={() => {
                  onChecking(false);
                  setHeard([]);
                  setLayoutId({ ...layoutId, [profile.id]: l.id });
                }}
              >
                <strong>{l.label}</strong>
                <small className="text-muted-foreground">{l.summary}</small>
              </button>
            ))}
          </div>
        )}
        {(step === null || step === 2) && (
          <>
            <ol
              className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2 p-0 data-[pedal=chocolate]:grid-cols-2 sm:data-[pedal=chocolate]:grid-cols-4"
              aria-label="What each switch does"
              data-pedal={isChocolate ? 'chocolate' : 'generic'}
            >
              {layout.switches.map((row) => (
                <li
                  key={row.switch}
                  className="group grid"
                  data-received={
                    (step === 2
                      ? heard.includes(row.switch)
                      : sameMessage(row, last)) || undefined
                  }
                >
                  <button
                    type="button"
                    className="grid gap-0.5 rounded-lg border border-input px-2 py-2.5 text-center group-data-[received]:border-foreground group-data-[received]:bg-muted aria-pressed:border-foreground aria-pressed:ring-1"
                    aria-pressed={selected === row.switch}
                    onClick={() =>
                      setSelected(selected === row.switch ? '' : row.switch)
                    }
                  >
                    <span className="text-md font-bold">{row.switch}</span>
                    <span className="text-sm">{row.does}</span>
                    <code className="font-mono text-xs text-muted-foreground">
                      {row.sends}
                    </code>
                    {heard.includes(row.switch) && <small>Received</small>}
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
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm"
                  aria-live="polite"
                >
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
                          .querySelector('[data-midi-preset-list]')
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
              <p className="m-0 text-sm text-muted-foreground" role="note">
                E = A+B and F = C+D are the pedal’s own bank down/up (CC 2 and
                CC 3, value 5). They change which Program A–D send and are not
                assigned.
              </p>
            )}
          </>
        )}
        {conflicts.length > 0 && (
          <p role="alert" className="m-0 text-sm text-destructive">
            Already used by a preset mapping: {conflicts.join(', ')}. Clear or
            change those first.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1">
          {(step === null || step === 2) && (
            <Button
              variant={checking ? 'secondary' : 'outline'}
              disabled={!checking && !canCheck}
              aria-pressed={checking}
              onClick={() => {
                if (checking) onChecking(false);
                else startCheck();
              }}
            >
              {checking ? 'Stop check' : 'Check pedal'}
            </Button>
          )}
          {step === null && (
            <Button
              disabled={busy || conflicts.length > 0}
              onClick={() => onApply(applyLayout(map, layout))}
            >
              Save layout
            </Button>
          )}
        </div>
        {step === 2 && (
          <p role="status">
            {heard.length} of {layout.switches.length} switches received.{' '}
            {canCheck || checking
              ? 'Press Check pedal, then press each switch on the pedal.'
              : 'Connect the selected controller and open a rig with MIDI input to check the switches.'}
          </p>
        )}
        {step === 3 && (
          <FormField>
            Layout name
            <input
              maxLength={48}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
        )}
        {step !== null && (
          <div className="flex flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1">
            {step > 0 && (
              <Button variant="outline" onClick={() => move(step - 1)}>
                Back
              </Button>
            )}
            {step < 3 ? (
              <Button onClick={() => move(step + 1)}>
                {step === 2 && heard.length < layout.switches.length
                  ? 'Continue without checking all switches'
                  : 'Next'}
              </Button>
            ) : (
              <Button
                disabled={
                  busy ||
                  !name.trim() ||
                  conflicts.length > 0 ||
                  saved.length >= 32
                }
                onClick={async () => {
                  const content = applyLayout(map, layout);
                  const entry = layoutFromCurrent(
                    content,
                    profile.id,
                    name,
                    saved.map((item) => item.id),
                  );
                  if (await onSaveGuided(content, [...saved, entry])) {
                    setName('');
                    setSavedName(entry.name);
                    move(null);
                  }
                }}
              >
                Save named layout
              </Button>
            )}
          </div>
        )}
        {step === null && (
          <>
            {layout.template !== 'keep' && presets.length > 0 && (
              <div
                className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                role="group"
                aria-label="Apply layout to existing preset"
              >
                <FormField className="min-w-0">
                  Existing preset
                  <Select
                    value={presetKey}
                    onValueChange={(value) => {
                      setPresetKey(value);
                      setConfirmPreset('');
                    }}
                  >
                    <SelectTrigger aria-label="Existing preset for layout">
                      <SelectValue placeholder="Choose preset" />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((preset) => {
                        const key = `${preset.entry.kind}:${preset.entry.id}`;
                        return (
                          <SelectItem key={key} value={key}>
                            {preset.name} · {preset.mappings}{' '}
                            {preset.mappings === 1 ? 'mapping' : 'mappings'}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </FormField>
                <Button
                  variant="outline"
                  disabled={!chosenPreset || busy || conflicts.length > 0}
                  onClick={() => {
                    if (!chosenPreset) return;
                    if (
                      chosenPreset.mappings > 0 &&
                      confirmPreset !== presetKey
                    ) {
                      setConfirmPreset(presetKey);
                      return;
                    }
                    setConfirmPreset('');
                    onApplyToPreset(
                      applyLayout(map, layout),
                      chosenPreset.entry,
                    );
                  }}
                >
                  {chosenPreset && confirmPreset === presetKey
                    ? `Replace ${chosenPreset.mappings} ${chosenPreset.mappings === 1 ? 'mapping' : 'mappings'}`
                    : 'Apply layout to preset'}
                </Button>
              </div>
            )}
            <div
              className="grid gap-2 border-t border-border/70 pt-3"
              role="group"
              aria-label="Saved layouts"
            >
              <h4 className="m-0 text-sm">Saved layouts</h4>
              <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <FormField className="min-w-0">
                  Layout name
                  <input
                    value={name}
                    maxLength={48}
                    placeholder="Stage setup"
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
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
                <Caption>
                  Save the template and triggers you have now to reuse or share
                  them. Export keeps saved layouts.
                </Caption>
              ) : (
                <ul className="m-0 grid list-none p-0 [&_li]:grid [&_li]:items-center [&_li]:gap-x-4 [&_li]:gap-y-2 [&_li]:border-t [&_li]:border-border/60 [&_li]:py-2 sm:[&_li]:grid-cols-[minmax(0,1fr)_auto] [&_small]:block [&_small]:text-muted-foreground">
                  {saved.map((item) => {
                    const asLayout = savedToLayout(item);
                    const clash = layoutConflicts(map, asLayout, nameOf);
                    return (
                      <li key={item.id}>
                        <div className="min-w-0">
                          <strong>{item.name}</strong>
                          <small>{asLayout.summary}</small>
                          {clash.length > 0 && (
                            <small
                              role="alert"
                              className="m-0 text-sm text-destructive"
                            >
                              Already used by a preset mapping:{' '}
                              {clash.join(', ')}
                            </small>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                          <Button
                            variant="outline"
                            className="px-2"
                            disabled={busy || clash.length > 0}
                            onClick={() => onApply(applyLayout(map, asLayout))}
                          >
                            Apply <span className="sr-only">{item.name}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-2"
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
                            className="px-2"
                            disabled={busy || saved.length >= 32}
                            onClick={() => {
                              const { id, name: copyName } = layoutFromCurrent(
                                {},
                                item.profile,
                                `Copy of ${item.name}`,
                                saved.map((s) => s.id),
                              );
                              onSaved([
                                ...saved,
                                { ...item, id, name: copyName },
                              ]);
                            }}
                          >
                            Duplicate{' '}
                            <span className="sr-only">{item.name}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-2 text-destructive"
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
          </>
        )}
        {checking && (
          <Caption role="status">
            {!listening
              ? 'Waiting for the device to start listening…'
              : passed
                ? `Received ${layout.check.press} as expected.`
                : `Press ${layout.check.press} on the pedal. Oxidal listens and does nothing.`}
          </Caption>
        )}
      </div>
    </section>
  );
}
