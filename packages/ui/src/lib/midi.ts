/**
 * MIDI mappings as the interface sees them. The product keeps the real map
 * on the device (CC with absolute or relative modes and curves, PC with Bank
 * Select); this is the shape the controls, the learn flow and the map page
 * share.
 */
export type MidiMessage =
  | { kind: 'cc'; channel: number; number: number; value: number }
  | { kind: 'pc'; channel: number; number: number };

/** A message without its value: what a mapping listens for. */
export type MidiAddress = {
  kind: 'cc' | 'pc';
  channel: number;
  number: number;
};

/** What a control does with a mapped message. */
export type TargetKind = 'continuous' | 'switch' | 'trigger';

export type MidiTargetInfo = {
  id: string;
  /** As the player reads it: "Plexi 50 · Gain", "Scene 2 · Crunch". */
  label: string;
  kind: TargetKind;
  /** Grouping on the map page: Blocks, Scenes, Stage, Player… */
  group: string;
};

export type MidiMapping = {
  target: string;
  address: MidiAddress;
  /** Switches: toggle on each press, or on while held. */
  mode?: 'toggle' | 'momentary';
};

export function sameAddress(a: MidiAddress, b: MidiAddress) {
  return a.kind === b.kind && a.channel === b.channel && a.number === b.number;
}

export function addressOf(message: MidiMessage): MidiAddress {
  return {
    kind: message.kind,
    channel: message.channel,
    number: message.number,
  };
}

export function formatAddress(address: MidiAddress, withChannel = true) {
  const base =
    address.kind === 'cc' ? `CC ${address.number}` : `PC ${address.number}`;
  return withChannel ? `${base} · ch ${address.channel}` : base;
}

/** 0–127 to the control's range, for continuous targets. */
export function scaleFromMidi(
  value: number,
  min: number,
  max: number,
  step = 0,
) {
  const raw = min + (Math.max(0, Math.min(127, value)) / 127) * (max - min);
  return step ? Math.round(raw / step) * step : raw;
}

/** Numbers controllers and synths give fixed meanings; mapping a button to them is risky. */
const RESERVED: Record<number, string> = {
  0: 'Bank Select',
  32: 'Bank Select (fine)',
  1: 'mod wheel on many controllers',
  7: 'volume on many controllers',
  11: 'expression on many controllers',
  64: 'sustain pedal on many controllers',
};

export type MidiProblem = {
  address: MidiAddress;
  targets: string[];
  text: string;
};

/** Two targets on one message, and buttons on numbers with a fixed meaning. */
export function midiProblems(
  mappings: MidiMapping[],
  targets: MidiTargetInfo[],
): MidiProblem[] {
  const label = (id: string) => targets.find((t) => t.id === id)?.label ?? id;
  const kind = (id: string) => targets.find((t) => t.id === id)?.kind;
  const problems: MidiProblem[] = [];
  const seen: { address: MidiAddress; targets: string[] }[] = [];
  for (const m of mappings) {
    const found = seen.find((s) => sameAddress(s.address, m.address));
    if (found) found.targets.push(m.target);
    else seen.push({ address: m.address, targets: [m.target] });
  }
  for (const s of seen)
    if (s.targets.length > 1)
      problems.push({
        address: s.address,
        targets: s.targets,
        text: `${formatAddress(s.address)} does ${s.targets.map(label).join(' and ')}`,
      });
  for (const m of mappings)
    if (
      m.address.kind === 'cc' &&
      RESERVED[m.address.number] &&
      (m.address.number === 0 ||
        m.address.number === 32 ||
        kind(m.target) !== 'continuous')
    )
      problems.push({
        address: m.address,
        targets: [m.target],
        text: `${formatAddress(m.address)} is ${RESERVED[m.address.number]}; ${label(m.target)} may clash`,
      });
  return problems;
}

/** Replace the mapping for a target; other targets on the same message are kept (and reported). */
export function assign(
  mappings: MidiMapping[],
  target: string,
  address: MidiAddress,
  mode?: MidiMapping['mode'],
): MidiMapping[] {
  return [
    ...mappings.filter((m) => m.target !== target),
    { target, address, mode },
  ];
}

export function clear(mappings: MidiMapping[], target: string): MidiMapping[] {
  return mappings.filter((m) => m.target !== target);
}

/**
 * The proposed default map (decision D-9 in the Sprint 15 brief), channel 1.
 * Target ids are the stage's: they exist on every preset.
 */
export const DEFAULT_MAP: MidiMapping[] = [
  { target: 'stage:level', address: { kind: 'cc', channel: 1, number: 7 } },
  {
    target: 'stage:expression',
    address: { kind: 'cc', channel: 1, number: 11 },
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    target: `scene:${i + 1}`,
    address: { kind: 'cc' as const, channel: 1, number: 16 + i },
  })),
  { target: 'stage:previous', address: { kind: 'cc', channel: 1, number: 24 } },
  { target: 'stage:next', address: { kind: 'cc', channel: 1, number: 25 } },
  {
    target: 'stage:tuner',
    address: { kind: 'cc', channel: 1, number: 26 },
    mode: 'toggle',
  },
  { target: 'stage:tap', address: { kind: 'cc', channel: 1, number: 27 } },
  {
    target: 'stage:boost',
    address: { kind: 'cc', channel: 1, number: 28 },
    mode: 'toggle',
  },
  {
    target: 'stage:protect',
    address: { kind: 'cc', channel: 1, number: 29 },
    mode: 'toggle',
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    target: `bypass:${i + 1}`,
    address: { kind: 'cc' as const, channel: 1, number: 48 + i },
    mode: 'toggle' as const,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    target: `branch:${i + 1}`,
    address: { kind: 'cc' as const, channel: 1, number: 56 + i },
    mode: 'toggle' as const,
  })),
  { target: 'player:play', address: { kind: 'cc', channel: 1, number: 80 } },
  { target: 'player:stop', address: { kind: 'cc', channel: 1, number: 81 } },
  {
    target: 'player:previous',
    address: { kind: 'cc', channel: 1, number: 82 },
  },
  { target: 'player:next', address: { kind: 'cc', channel: 1, number: 83 } },
  {
    target: 'player:loop',
    address: { kind: 'cc', channel: 1, number: 84 },
    mode: 'toggle',
  },
  {
    target: 'player:click',
    address: { kind: 'cc', channel: 1, number: 85 },
    mode: 'toggle',
  },
  {
    target: 'sheet:scroll',
    address: { kind: 'cc', channel: 1, number: 86 },
    mode: 'toggle',
  },
  { target: 'sheet:speed', address: { kind: 'cc', channel: 1, number: 87 } },
];

export const DEFAULT_TARGETS: MidiTargetInfo[] = [
  {
    id: 'stage:level',
    label: 'Output level',
    kind: 'continuous',
    group: 'Stage',
  },
  {
    id: 'stage:expression',
    label: 'Expression 1',
    kind: 'continuous',
    group: 'Stage',
  },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `scene:${i + 1}`,
    label: `Scene ${i + 1}`,
    kind: 'trigger' as const,
    group: 'Scenes',
  })),
  {
    id: 'stage:previous',
    label: 'Previous preset',
    kind: 'trigger',
    group: 'Stage',
  },
  { id: 'stage:next', label: 'Next preset', kind: 'trigger', group: 'Stage' },
  { id: 'stage:tuner', label: 'Tuner', kind: 'switch', group: 'Stage' },
  { id: 'stage:tap', label: 'Tap tempo', kind: 'trigger', group: 'Stage' },
  { id: 'stage:boost', label: 'Boost', kind: 'switch', group: 'Stage' },
  { id: 'stage:protect', label: 'Protect', kind: 'switch', group: 'Stage' },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `bypass:${i + 1}`,
    label: `Block ${i + 1} on/off`,
    kind: 'switch' as const,
    group: 'Blocks',
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `branch:${i + 1}`,
    label: `Branch ${i + 1} on/off`,
    kind: 'switch' as const,
    group: 'Blocks',
  })),
  {
    id: 'player:play',
    label: 'Play / pause',
    kind: 'trigger',
    group: 'Player',
  },
  { id: 'player:stop', label: 'Stop', kind: 'trigger', group: 'Player' },
  {
    id: 'player:previous',
    label: 'Previous track',
    kind: 'trigger',
    group: 'Player',
  },
  { id: 'player:next', label: 'Next track', kind: 'trigger', group: 'Player' },
  { id: 'player:loop', label: 'Loop section', kind: 'switch', group: 'Player' },
  { id: 'player:click', label: 'Click', kind: 'switch', group: 'Player' },
  {
    id: 'sheet:scroll',
    label: 'Chord sheet scroll',
    kind: 'switch',
    group: 'Chord sheet',
  },
  {
    id: 'sheet:speed',
    label: 'Chord sheet speed',
    kind: 'continuous',
    group: 'Chord sheet',
  },
];

/** Parse raw Web MIDI bytes; anything but CC and Program Change is ignored. */
export function parseMidiBytes(data: ArrayLike<number>): MidiMessage | null {
  const status = data[0] ?? 0;
  const channel = (status & 0x0f) + 1;
  const type = status & 0xf0;
  if (type === 0xb0 && data.length >= 3)
    return { kind: 'cc', channel, number: data[1]!, value: data[2]! };
  if (type === 0xc0 && data.length >= 2)
    return { kind: 'pc', channel, number: data[1]! };
  return null;
}
