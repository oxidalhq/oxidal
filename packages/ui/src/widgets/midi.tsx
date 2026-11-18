import * as React from 'react';
import { PlugsConnected, X } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import {
  DEFAULT_TARGETS,
  addressOf,
  assign,
  clear,
  formatAddress,
  midiProblems,
  sameAddress,
  type MidiMapping,
  type MidiMessage,
  type MidiTargetInfo,
  type TargetKind,
} from '../lib/midi';
import { Button } from '../components/ui/button';
import { notify } from '../components/ui/notices';
import { Toggle } from '../components/ui/toggle';
import { MidiContext, useMidi, type MidiApi } from './midi-context';

/**
 * Holds the MIDI map for the screens under it and routes incoming messages:
 * while a control is learning, the next CC or Program Change maps to it;
 * otherwise each message drives the controls mapped to it.
 */
export function MidiProvider({
  initial = [],
  onChange,
  children,
}: {
  initial?: MidiMapping[];
  onChange?: (mappings: MidiMapping[]) => void;
  children: React.ReactNode;
}) {
  const [mappings, setMappingsState] = React.useState(initial);
  const [view, setView] = React.useState(false);
  const [learning, setLearning] = React.useState<string | null>(null);
  const [last, setLast] = React.useState<MidiMessage | null>(null);
  const [targets, setTargets] = React.useState<MidiTargetInfo[]>([]);
  const handlers = React.useRef(
    new Map<string, (message: MidiMessage) => void>(),
  );
  const state = React.useRef({ mappings, learning, targets });
  React.useEffect(() => {
    state.current = { mappings, learning, targets };
  });

  const setMappings = React.useCallback(
    (next: MidiMapping[]) => {
      setMappingsState(next);
      onChange?.(next);
    },
    [onChange],
  );

  const register = React.useCallback(
    (info: MidiTargetInfo, handler: (message: MidiMessage) => void) => {
      handlers.current.set(info.id, handler);
      setTargets((all) => [...all.filter((t) => t.id !== info.id), info]);
      return () => {
        handlers.current.delete(info.id);
        setTargets((all) => all.filter((t) => t.id !== info.id));
      };
    },
    [],
  );

  const receive = React.useCallback(
    (message: MidiMessage) => {
      setLast(message);
      const { mappings: map, learning: target, targets: known } = state.current;
      if (target) {
        const address = addressOf(message);
        const kind = known.find((t) => t.id === target)?.kind;
        const next = assign(
          map,
          target,
          address,
          kind === 'switch' ? 'toggle' : undefined,
        );
        setMappings(next);
        setLearning(null);
        const name = (id: string) =>
          known.find((t) => t.id === id)?.label ??
          DEFAULT_TARGETS.find((t) => t.id === id)?.label ??
          id;
        const label = name(target);
        const clash = next.filter(
          (m) => m.target !== target && sameAddress(m.address, address),
        );
        notify({
          action: clash.length
            ? {
                label: 'Use it only here',
                run: () =>
                  setMappings(
                    next.filter(
                      (m) =>
                        m.target === target || !sameAddress(m.address, address),
                    ),
                  ),
              }
            : undefined,
          tone: clash.length ? 'warning' : 'success',
          text: clash.length
            ? `${label} is on ${formatAddress(address)}, which also does ${clash.map((c) => name(c.target)).join(' and ')}`
            : `${label} is on ${formatAddress(address)}`,
        });
        return;
      }
      for (const m of map)
        if (sameAddress(m.address, addressOf(message)))
          handlers.current.get(m.target)?.(message);
    },
    [setMappings],
  );

  const api: MidiApi = React.useMemo(
    () => ({
      mappings,
      setMappings,
      targets,
      register,
      view,
      setView,
      learning,
      learn: setLearning,
      receive,
      last,
    }),
    [mappings, setMappings, targets, register, view, learning, receive, last],
  );

  React.useEffect(() => {
    if (!learning) return;
    const onKey = (event: KeyboardEvent) =>
      event.key === 'Escape' && setLearning(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [learning]);

  return <MidiContext.Provider value={api}>{children}</MidiContext.Provider>;
}

/**
 * Makes any control mappable. Outside a MidiProvider it renders the control
 * unchanged. Inside one:
 * - in the **MIDI view** the control is outlined and shows its mapping; a
 *   tap starts Learn for it (the control does not change while mapping);
 * - a right-click on a laptop starts Learn at any time;
 * - a mapped message drives it: continuous controls follow the value,
 *   switches toggle (or follow while held), triggers fire.
 */
export function MidiTarget({
  id,
  label,
  kind,
  group,
  onMidi,
  children,
  className,
}: {
  id: string;
  label: string;
  kind: TargetKind;
  group: string;
  onMidi: (message: MidiMessage) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const midi = useMidi();
  const handler = React.useRef(onMidi);
  React.useEffect(() => {
    handler.current = onMidi;
  });
  const register = midi?.register;
  React.useEffect(
    () => register?.({ id, label, kind, group }, (m) => handler.current(m)),
    [register, id, label, kind, group],
  );
  if (!midi) return <>{children}</>;
  const mapping = midi.mappings.find((m) => m.target === id);
  const listening = midi.learning === id;
  return (
    <span
      data-slot="midi-target"
      data-mapped={mapping ? '' : undefined}
      className={cn('relative grid', className)}
      onContextMenu={(event) => {
        event.preventDefault();
        midi.learn(id);
      }}
    >
      {children}
      {(midi.view || listening) && (
        <button
          type="button"
          onClick={() => midi.learn(listening ? null : id)}
          className={cn(
            'absolute inset-0 z-10 grid place-items-end rounded-lg border-2 border-dashed border-foreground/60 bg-background/10 p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            listening &&
              'border-solid border-brand bg-brand/10 motion-safe:animate-pulse',
          )}
        >
          <span className="rounded-full bg-raised px-1.5 font-mono text-2xs font-semibold text-foreground shadow-raised">
            {listening
              ? 'Listening…'
              : mapping
                ? formatAddress(mapping.address, false)
                : 'Learn'}
          </span>
          <span className="sr-only">{`, MIDI for ${label}${mapping ? ` (${formatAddress(mapping.address)})` : ', not mapped'}`}</span>
        </button>
      )}
    </span>
  );
}

/**
 * The bar that turns the MIDI view on and says what is happening: how many
 * mappings, any problems, and while learning, which control is listening
 * with Clear and Cancel.
 */
export function MidiBar({
  onOpenMap,
  className,
}: {
  onOpenMap?: () => void;
  className?: string;
}) {
  const midi = useMidi();
  if (!midi) return null;
  const target = midi.targets.find((t) => t.id === midi.learning);
  const problems = midiProblems(midi.mappings, midi.targets);
  return (
    <div
      data-slot="midi-bar"
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2',
        midi.learning && 'border-brand',
        className,
      )}
    >
      <Toggle
        size="sm"
        pressed={midi.view}
        onPressedChange={(on) => {
          midi.setView(on);
          if (!on) midi.learn(null);
        }}
      >
        <PlugsConnected /> MIDI view
      </Toggle>
      {midi.learning ? (
        <>
          <span className="text-sm">
            Move a knob or press a switch on your controller for{' '}
            <strong>{target?.label ?? 'this control'}</strong>.
          </span>
          <span className="ml-auto flex gap-2">
            {midi.mappings.some((m) => m.target === midi.learning) && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  midi.setMappings(clear(midi.mappings, midi.learning!));
                  midi.learn(null);
                }}
              >
                Clear mapping
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => midi.learn(null)}
            >
              <X /> Cancel
            </Button>
          </span>
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">
            {midi.view
              ? 'Tap a control to map it to your controller.'
              : `${midi.mappings.length} mappings`}
            {problems.length > 0 && (
              <strong className="text-foreground">
                {' '}
                · {problems.length}{' '}
                {problems.length === 1 ? 'problem' : 'problems'}
              </strong>
            )}
          </span>
          {midi.last && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              Last: {formatAddress(addressOf(midi.last))}
              {midi.last.kind === 'cc' ? ` = ${midi.last.value}` : ''}
            </span>
          )}
          {onOpenMap && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={onOpenMap}
            >
              Whole map…
            </Button>
          )}
        </>
      )}
    </div>
  );
}
