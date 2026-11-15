/**
 * Stem mix drafts: roles, starting-point mixes and the editor's undo history.
 * The device renders the saved recipe; nothing here touches audio.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import type { SongSaveMix, SongView } from '../../api';

export type Recipe = SongSaveMix['recipe'];
export type StemControls = Recipe['vocals'];
export type StemRole =
  'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other';
export type Split = SongView['splits'][number];

/** Display order: the parts players reach for first, Other last. */
export const ROLE_ORDER: StemRole[] = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
];
const ROLE_LABEL: Record<StemRole, string> = {
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass',
  guitar: 'Guitar',
  piano: 'Piano',
  other: 'Other',
};
export const roleLabel = (role: StemRole) => ROLE_LABEL[role];

/** Gain range in tenths of a dB, matching backing trim. */
export const GAIN_MIN = -240;
export const GAIN_MAX = 60;
const NEUTRAL: StemControls = {
  gain_tenths_db: 0,
  muted: false,
  solo: false,
};

export const MODE_INFO: Record<
  Recipe['mode'],
  { label: string; parts: string }
> = {
  four: { label: '4 stems', parts: 'Vocals, drums, bass and other' },
  six: {
    label: '6 stems',
    parts: 'Adds guitar and piano. Expect some bleed between them.',
  },
};

/** "6 stems", "4 stems (2)" or "3 uploaded", for one of a song's splits. */
export function splitLabel(split: Split, splits: Split[]) {
  if (split.importedRoles) return `${split.importedRoles.length} uploaded`;
  const same = splits.filter((s) => !s.importedRoles && s.mode === split.mode);
  const base = MODE_INFO[split.mode].label;
  return same.length > 1 ? `${base} (${same.indexOf(split) + 1})` : base;
}

/** Roles a split actually has: uploaded stems may be any subset. */
export function splitRoles(split: Split): StemRole[] {
  const present: StemRole[] =
    split.importedRoles ??
    (split.mode === 'six'
      ? ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']
      : ['vocals', 'drums', 'bass', 'other']);
  return ROLE_ORDER.filter((role) => present.includes(role));
}

export function controls(recipe: Recipe, role: StemRole): StemControls {
  if (role === 'guitar' || role === 'piano')
    return recipe.mode === 'six' ? recipe[role] : NEUTRAL;
  return recipe[role];
}

export function withControls(
  recipe: Recipe,
  role: StemRole,
  next: StemControls,
): Recipe {
  if ((role === 'guitar' || role === 'piano') && recipe.mode !== 'six')
    return recipe;
  return { ...recipe, [role]: next } as Recipe;
}

export function blankRecipe(mode: Recipe['mode']): Recipe {
  const four = {
    vocals: NEUTRAL,
    drums: NEUTRAL,
    bass: NEUTRAL,
    other: NEUTRAL,
  };
  return mode === 'six'
    ? { ...four, mode, guitar: NEUTRAL, piano: NEUTRAL }
    : { ...four, mode };
}

/** True when a role is heard: not muted, and soloed if anything is soloed. */
export function audible(recipe: Recipe, roles: StemRole[], role: StemRole) {
  const own = controls(recipe, role);
  if (own.muted) return false;
  const soloing = roles.some((r) => controls(recipe, r).solo);
  return !soloing || own.solo;
}

/** Words in a file name that identify a stem, checked in this order. */
const ROLE_WORDS: [StemRole, RegExp][] = [
  ['vocals', /vocal|vox|voice|sing/],
  ['drums', /drum|kit|perc/],
  ['bass', /bass/],
  ['guitar', /guitar|gtr/],
  ['piano', /piano|keys|keyboard/],
  ['other', /other|rest|inst|accomp/],
];

export function guessRole(name: string): StemRole | null {
  const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  return ROLE_WORDS.find(([, words]) => words.test(base))?.[0] ?? null;
}

export interface QuickMix {
  name: string;
  /** Roles left playing; every other role is muted. */
  keep: StemRole[];
}

/**
 * One-tap starting points. Each resets levels and solo and mutes the named
 * parts. In a four-stem split, guitars and keys are inside Other.
 */
export function quickMixes(roles: StemRole[]): QuickMix[] {
  const without = (role: StemRole, name: string): QuickMix[] =>
    roles.includes(role) && roles.length > 1
      ? [{ name, keep: roles.filter((r) => r !== role) }]
      : [];
  const four = !roles.includes('guitar') && !roles.includes('piano');
  return [
    { name: 'Full song', keep: roles },
    ...without('vocals', 'No vocals'),
    ...without('guitar', 'No guitar'),
    ...without('bass', 'No bass'),
    ...without('drums', 'No drums'),
    ...without('piano', 'No keys'),
    ...without('other', four ? 'No guitar or keys' : 'No other parts'),
    ...(roles.includes('drums') && roles.includes('bass') && roles.length > 2
      ? [{ name: 'Drums and bass', keep: ['drums', 'bass'] as StemRole[] }]
      : []),
    ...(roles.includes('drums') && roles.length > 1
      ? [{ name: 'Drums only', keep: ['drums'] as StemRole[] }]
      : []),
  ];
}

export function applyQuickMix(
  recipe: Recipe,
  roles: StemRole[],
  quick: QuickMix,
): Recipe {
  return roles.reduce(
    (next, role) =>
      withControls(next, role, {
        gain_tenths_db: 0,
        solo: false,
        muted: !quick.keep.includes(role),
      }),
    blankRecipe(recipe.mode),
  );
}

/** The starting point a draft still matches exactly, if any. */
export function matchingQuickMix(
  recipe: Recipe,
  roles: StemRole[],
  quicks: QuickMix[],
): QuickMix | undefined {
  return quicks.find((quick) =>
    roles.every((role) => {
      const own = controls(recipe, role);
      return (
        own.gain_tenths_db === 0 &&
        !own.solo &&
        own.muted === !quick.keep.includes(role)
      );
    }),
  );
}

export function sameRecipe(a: Recipe, b: Recipe) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function formatGain(tenths: number) {
  if (tenths === 0) return '0 dB';
  const db = (tenths / 10).toFixed(1).replace(/\.0$/, '');
  return `${tenths > 0 ? '+' : '−'}${db.replace('-', '')} dB`;
}

/** A short recipe summary for lists, such as "Guitar muted · Drums +2 dB". */
export function describeRecipe(recipe: Recipe, roles: StemRole[]): string {
  const parts = roles.flatMap((role) => {
    const own = controls(recipe, role);
    if (own.muted) return [`${roleLabel(role)} muted`];
    const notes = [
      own.solo ? 'solo' : '',
      own.gain_tenths_db ? formatGain(own.gain_tenths_db) : '',
    ].filter(Boolean);
    return notes.length ? [`${roleLabel(role)} ${notes.join(', ')}`] : [];
  });
  return parts.length ? parts.join(' · ') : 'All stems at 0 dB';
}

export interface Draft {
  title: string;
  recipe: Recipe;
}
export interface History {
  current: Draft;
  past: Draft[];
  future: Draft[];
}
export const freshHistory = (current: Draft): History => ({
  current,
  past: [],
  future: [],
});

/** Records `next` as one undo step. */
export function commit(history: History, next: Draft, from = history.current) {
  if (JSON.stringify(from) === JSON.stringify(next))
    return { ...history, current: next };
  return {
    current: next,
    past: [...history.past.slice(-99), from],
    future: [],
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  return previous
    ? {
        current: previous,
        past: history.past.slice(0, -1),
        future: [history.current, ...history.future],
      }
    : history;
}

export function redo(history: History): History {
  const next = history.future[0];
  return next
    ? {
        current: next,
        past: [...history.past, history.current],
        future: history.future.slice(1),
      }
    : history;
}
