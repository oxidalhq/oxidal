import { describe, expect, it } from 'vitest';
import { allFactoryRecipes } from '../../../factoryCatalog';
import { factoryRoles } from '../../../factoryRecipes';
import { factoryVoices, isFactoryVoice } from '../../../factoryVoices';
import {
  CAPTURE_BUDGET,
  bufferThatFits,
  cardState,
  captureLimit,
  filterItems,
  groupItems,
  missingTones,
  noFilters,
  sceneLine,
  summaryLine,
  type SoundItem,
  type UnitFacts,
} from './oxidalSounds.model';

/** @see docs/factory-collection.md */
const facts = (patch: Partial<UnitFacts> = {}): UnitFacts => ({
  ready: true,
  plugins: [],
  captures: new Set(),
  bindings: {},
  signedIn: true,
  protectOn: false,
  audioRunning: false,
  frames: 96,
  installedPacks: new Set(),
  ...patch,
});
const item = (
  patch: Partial<SoundItem['meta']> = {},
  name = 'Test',
): SoundItem => ({
  key: name,
  name,
  description: 'A test sound.',
  sceneNames: ['A', 'B'],
  meta: {
    genres: ['Funk'],
    techniques: [],
    engine: 'tone3000-a2-full',
    complexity: 'simple',
    inspiration: '',
    performance: '',
    requiredPacks: [],
    namInstances: 3,
    blockCount: 4,
    ...patch,
  },
  built: undefined,
});

describe('capture budget', () => {
  it('allows 3 Lite and 2 Full captures at 96 frames', () => {
    expect(captureLimit('tone3000-a2-lite', CAPTURE_BUDGET.frames)).toBe(3);
    expect(captureLimit('tone3000-a2-full', CAPTURE_BUDGET.frames)).toBe(2);
    expect(captureLimit('hybrid', 96)).toBe(3);
  });
  it('names the smallest buffer that carries a heavy sound', () => {
    expect(bufferThatFits('tone3000-a2-full', 3)).toBe(192);
    expect(bufferThatFits('tone3000-a2-full', 99)).toBeNull();
  });
  it('S-7: three captures on a stream that fits two is Too heavy with the fitting buffer', () => {
    const state = cardState(item(), facts());
    expect(state).toEqual({ kind: 'heavy', count: 3, limit: 2, fitsAt: 192 });
    const fits = cardState(item(), facts({ frames: 192 }));
    expect(fits.kind).not.toBe('heavy');
  });
  it('is Too heavy even when already built, so Play is never offered', () => {
    const built = {
      ...item(),
      built: { name: 'Test', revision: 'r', scenes: [] },
    };
    expect(cardState(built, facts()).kind).toBe('heavy');
  });
});

describe('card states', () => {
  it('is loading until the unit has been read', () => {
    expect(cardState(item(), facts({ ready: false })).kind).toBe('loading');
  });
  it('is ready when built', () => {
    const built = {
      ...item({ namInstances: 0, engine: 'lv2' }),
      built: { name: 'Test', revision: 'r', scenes: [] },
    };
    expect(cardState(built, facts()).kind).toBe('ready');
  });
  it('needs a pack for a built-only sound whose pack is missing', () => {
    const state = cardState(
      item({ namInstances: 0, engine: 'lv2', requiredPacks: ['calf'] }),
      facts(),
    );
    expect(state).toEqual({ kind: 'pack', packs: ['calf'] });
    expect(
      cardState(
        item({ namInstances: 0, engine: 'lv2', requiredPacks: ['calf'] }),
        facts({ installedPacks: new Set(['calf']) }),
      ).kind,
    ).toBe('build');
  });
});

describe('filters, groups and summary', () => {
  const items = [
    item({ genres: ['Funk'], engine: 'lv2', complexity: 'simple' }, 'Pocket'),
    item(
      {
        genres: ['Ambient', 'Post-rock'],
        engine: 'lv2',
        complexity: 'complex',
      },
      'Slow Weather',
    ),
    item(
      { genres: ['Hard rock'], engine: 'hybrid', complexity: 'layered' },
      'Brown',
    ),
  ];
  it('filters by genre, engine, complexity and search together', () => {
    expect(filterItems(items, { ...noFilters, genre: 'Funk' })).toHaveLength(1);
    expect(filterItems(items, { ...noFilters, engine: 'lv2' })).toHaveLength(2);
    expect(
      filterItems(items, { ...noFilters, complexity: 'complex' })[0]!.name,
    ).toBe('Slow Weather');
    expect(
      filterItems(items, { ...noFilters, query: 'post-rock' }),
    ).toHaveLength(1);
    expect(
      filterItems(items, { ...noFilters, engine: 'lv2', query: 'brown' }),
    ).toHaveLength(0);
  });
  it('groups by genre in list order or by engine tier', () => {
    expect(groupItems(items, 'genre').map((g) => g.label)).toEqual([
      'Funk',
      'Hard rock',
      'Ambient',
    ]);
    expect(groupItems(items, 'engine').map((g) => g.label)).toEqual([
      'LV2 only',
      'Hybrid',
    ]);
  });
  it('writes the summary line', () => {
    expect(
      summaryLine(2, [
        { kind: 'ready' },
        { kind: 'build' },
        { kind: 'pack', packs: ['calf'] },
      ]),
    ).toBe('Showing 2 of 3 · 2 ready to play · 1 need a tone or pack');
  });
  it('shortens long scene lists', () => {
    expect(sceneLine(['1', '2', '3', '4', '5', '6', '7', '8'])).toBe(
      '1 · 2 · 3 · 4 · 5 · 6 · +2',
    );
  });
});

describe('tones a sound still needs', () => {
  it('counts a downloaded tone for a voice that leaves the model open', () => {
    const recipe = allFactoryRecipes.find((r) =>
      factoryRoles(r).some(
        (role) =>
          isFactoryVoice(role) &&
          factoryVoices[role].captures[0]?.model === undefined,
      ),
    )!;
    const sound: SoundItem = { ...item(), recipe };
    const before = missingTones(sound, facts());
    const open = before.find((t) => t.named && t.model === undefined)!;
    expect(open).toBeDefined();
    const tone = (open as { tone: number }).tone;
    const after = missingTones(
      sound,
      facts({ captures: new Set([`${tone}:424242`]) }),
    );
    expect(after.some((t) => t.role === open.role)).toBe(false);
  });
});
