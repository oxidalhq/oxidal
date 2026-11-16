/**
 * Foot controllers as the stage draws them. Any controller works: a profile
 * is just how many switches, how they are laid out, and what a tap and a
 * hold on each one do. These are starting points the player edits; Learn
 * fills in the MIDI each switch sends.
 */
export type SwitchAction =
  | { kind: 'scene'; scene: string }
  | { kind: 'previous' }
  | { kind: 'next' }
  | { kind: 'block'; block: string }
  | { kind: 'tuner' }
  | { kind: 'tap' }
  | { kind: 'boost' }
  | { kind: 'play' }
  | { kind: 'loop' }
  | { kind: 'none' };

export type Footswitch = {
  id: string;
  /** The letter or number printed on the unit. */
  name: string;
  tap: SwitchAction;
  hold?: SwitchAction;
};

export type ControllerProfile = {
  id: string;
  name: string;
  /** Switches per row, as on the unit. */
  columns: number;
  switches: Footswitch[];
};

export const CONTROLLERS: ControllerProfile[] = [
  {
    id: 'four',
    name: '4 switches (M-Vave Chocolate and similar)',
    columns: 4,
    switches: [
      {
        id: 'A',
        name: 'A',
        tap: { kind: 'scene', scene: 'a' },
        hold: { kind: 'boost' },
      },
      {
        id: 'B',
        name: 'B',
        tap: { kind: 'scene', scene: 'b' },
        hold: { kind: 'block', block: 'echo' },
      },
      {
        id: 'C',
        name: 'C',
        tap: { kind: 'previous' },
        hold: { kind: 'tuner' },
      },
      { id: 'D', name: 'D', tap: { kind: 'next' }, hold: { kind: 'tap' } },
    ],
  },
  {
    id: 'ten',
    name: '10 switches (MIDI Captain STD 10 and similar)',
    columns: 5,
    switches: [
      { id: '1', name: '1', tap: { kind: 'scene', scene: 'a' } },
      { id: '2', name: '2', tap: { kind: 'scene', scene: 'b' } },
      { id: '3', name: '3', tap: { kind: 'scene', scene: 'c' } },
      { id: '4', name: '4', tap: { kind: 'scene', scene: 'd' } },
      { id: 'up', name: '▲', tap: { kind: 'tap' }, hold: { kind: 'tuner' } },
      { id: 'A', name: 'A', tap: { kind: 'block', block: 'ts9' } },
      { id: 'B', name: 'B', tap: { kind: 'block', block: 'echo' } },
      { id: 'C', name: 'C', tap: { kind: 'boost' } },
      { id: 'D', name: 'D', tap: { kind: 'play' }, hold: { kind: 'loop' } },
      {
        id: 'down',
        name: '▼',
        tap: { kind: 'next' },
        hold: { kind: 'previous' },
      },
    ],
  },
  {
    id: 'six',
    name: '6 switches (generic)',
    columns: 3,
    switches: [
      { id: '1', name: '1', tap: { kind: 'scene', scene: 'a' } },
      { id: '2', name: '2', tap: { kind: 'scene', scene: 'b' } },
      { id: '3', name: '3', tap: { kind: 'scene', scene: 'c' } },
      {
        id: '4',
        name: '4',
        tap: { kind: 'previous' },
        hold: { kind: 'tuner' },
      },
      { id: '5', name: '5', tap: { kind: 'block', block: 'echo' } },
      { id: '6', name: '6', tap: { kind: 'next' }, hold: { kind: 'tap' } },
    ],
  },
  {
    id: 'two',
    name: '2 switches (any)',
    columns: 2,
    switches: [
      {
        id: '1',
        name: '1',
        tap: { kind: 'previous' },
        hold: { kind: 'tuner' },
      },
      { id: '2', name: '2', tap: { kind: 'next' }, hold: { kind: 'tap' } },
    ],
  },
];
