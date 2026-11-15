import { describe, expect, it } from 'vitest';
import { allFactoryRecipes } from './factoryCatalog.ts';
import {
  allFactoryMetadataProblems,
  factoryDerivedEngine,
  factoryGenres,
  factoryMetadata,
  factoryRequiredPacks,
  validateFactoryMetadata,
} from './factoryMetadata.ts';
import { factoryPackFor, factoryPluginNames } from './factoryMetadata.ts';
import { factoryRecipes, factoryRoles } from './factoryRecipes.ts';

/**
 * @see docs/factory-collection.md
 */
describe('recipe metadata', () => {
  it('tags every recipe validly', () => {
    expect(allFactoryRecipes.length).toBeGreaterThanOrEqual(130);
    expect(allFactoryMetadataProblems()).toEqual([]);
    for (const recipe of allFactoryRecipes) {
      expect(recipe.genres.length).toBeGreaterThanOrEqual(1);
      expect(recipe.genres.length).toBeLessThanOrEqual(3);
      for (const genre of recipe.genres) expect(factoryGenres).toContain(genre);
      const derived = factoryDerivedEngine(recipe);
      // Captures with effects are hybrid, unless the sound is built for one
      // capture size and says so: its tier then sets its capture budget.
      if (derived === 'tone3000-a2-lite')
        expect(recipe.engine).toMatch(/^tone3000-a2-(lite|full)$/);
      else if (derived === 'hybrid')
        expect(recipe.engine).toMatch(/^(hybrid|tone3000-a2-(lite|full))$/);
      else expect(recipe.engine).toBe(derived);
      expect(recipe.engine === 'lv2').toBe(factoryRoles(recipe).length === 0);
    }
  });

  it('has unique ids and names and meets the showcase tier minimums', () => {
    const ids = allFactoryRecipes.map((r) => r.id);
    const names = allFactoryRecipes.map((r) => r.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    const count = (engine: string) =>
      allFactoryRecipes.filter((r) => r.engine === engine).length;
    expect(count('lv2')).toBeGreaterThanOrEqual(24);
    expect(count('tone3000-a2-lite')).toBeGreaterThanOrEqual(12);
    expect(count('tone3000-a2-full')).toBeGreaterThanOrEqual(8);
    expect(count('hybrid')).toBeGreaterThanOrEqual(16);
    expect(
      allFactoryRecipes.filter((r) => r.complexity === 'complex').length,
    ).toBeGreaterThanOrEqual(10);
  });

  it('keeps technique tags out of genres and never names a style in a genre by accident', () => {
    for (const recipe of allFactoryRecipes) {
      expect(recipe.genres).not.toContain('Hold');
      expect(recipe.genres).not.toContain('Parallel routing');
    }
    expect(
      allFactoryRecipes
        .filter((r) => r.topology === 'routed')
        .every((r) => r.techniques?.includes('Parallel routing')),
    ).toBe(true);
  });

  it('rejects bad genres, engines and complexities', () => {
    const base = allFactoryRecipes.find((r) => r.id === 'C01')!;
    expect(validateFactoryMetadata({ ...base, genres: [] })).toContain(
      'Use one to three genres',
    );
    expect(
      validateFactoryMetadata({
        ...base,
        genres: ['Clean', 'Funk', 'Blues', 'Jazz'],
      }),
    ).toContain('Use one to three genres');
    expect(
      validateFactoryMetadata({
        ...base,
        genres: ['Metalcore' as never],
      }),
    ).toContain('Unknown genre Metalcore');
    expect(validateFactoryMetadata({ ...base, engine: 'lv2' })).toContain(
      'Engine disagrees with the NAM roles',
    );
    expect(
      validateFactoryMetadata({ ...base, engine: 'tube' as never }),
    ).toContain('Unknown engine');
    expect(
      validateFactoryMetadata({ ...base, complexity: 'epic' as never }),
    ).toContain('Unknown complexity');
    const lv2 = allFactoryRecipes.find((r) => r.engine === 'lv2')!;
    expect(
      validateFactoryMetadata({ ...lv2, engine: 'tone3000-a2-lite' }),
    ).toContain('Engine disagrees with the NAM roles');
  });

  it('names the pack of every ZamAudio and DISTRHO Ports effect', () => {
    for (const name of ['ZamVerb', 'ZamGrains', 'ZaMultiCompX2'])
      expect(factoryPackFor(name), name).toBe('zam');
    for (const name of ['MVerb', 'MaGigaverb', '3 Band EQ', 'Soul Force'])
      expect(factoryPackFor(name), name).toBe('dpf');
    expect(factoryPackFor('Oxidal Hold (Stereo)')).toBeUndefined();
  });

  it('derives packs, tones and counts from the blocks', () => {
    for (const recipe of allFactoryRecipes)
      for (const name of factoryPluginNames(recipe))
        if (!name.startsWith('Oxidal '))
          expect(factoryPackFor(name), name).toBeDefined();
    const brown = allFactoryRecipes.find((r) => r.id === 'E80-01')!;
    const meta = factoryMetadata(brown);
    expect(meta.engine).toBe('hybrid');
    expect(meta.nam_instances).toBe(1);
    expect(meta.required_tones).toEqual([65578]);
    expect(meta.required_packs).toEqual(factoryRequiredPacks(brown));
    expect(meta.block_count).toBeGreaterThan(3);
    // A retired recipe still validates as data: the catalog filters it out.
    const ambient = factoryRecipes.find((r) => r.id === 'A04')!;
    expect(factoryMetadata(ambient)).toMatchObject({
      engine: 'lv2',
      nam_instances: 0,
      required_tones: [],
      techniques: ['Hold'],
    });
  });

  it('rejects missing, short and placeholder inspiration and performance text', () => {
    const base = allFactoryRecipes.find((r) => r.id === 'C01')!;
    for (const text of [
      '',
      '   ',
      'Warm clean.',
      'TODO: describe the style and era of this sound in a sentence or two.',
      'Placeholder until the listening pass on the unit is finished and written up.',
      'tbd: the style, the era and the kind of gear this sound is modelled on',
    ]) {
      expect(
        validateFactoryMetadata({ ...base, inspiration: text }),
        text,
      ).toContain('Inspiration is missing or a placeholder');
      expect(
        validateFactoryMetadata({ ...base, performance: text }),
        text,
      ).toContain('Performance is missing or a placeholder');
    }
    // Finished text everywhere, retired recipes included.
    for (const recipe of [...allFactoryRecipes, ...factoryRecipes]) {
      expect(validateFactoryMetadata(recipe), recipe.id).toEqual([]);
      expect(recipe.inspiration, recipe.id).not.toMatch(/TODO/i);
      expect(recipe.performance, recipe.id).not.toMatch(/TODO/i);
    }
  });
});
