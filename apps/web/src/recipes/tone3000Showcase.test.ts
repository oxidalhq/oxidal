import { describe, expect, it } from 'vitest';
import catalog from '../fixtures/factory-lv2.json';
import type { Lv2Plugin } from '../api';
import type { RigNativeSource } from '../generated/contract';
import {
  buildFactoryRecipe,
  factoryRoles,
  recipeEffects,
} from '../factoryRecipes.ts';
import { validateFactoryMetadata } from '../factoryMetadata.ts';
import { factoryVoices, isFactoryVoice } from '../factoryVoices.ts';
import {
  tone3000CaptureBudget,
  tone3000ShowcaseRecipes,
} from './tone3000Showcase.ts';
import { scenesKey } from '../sceneFormat';

/**
 * @see docs/factory-collection.md
 */
const source: RigNativeSource = {
  preset: {
    sha256: 'a'.repeat(64),
    name: 'User tone',
    size_bytes: 100,
    framing: 'current',
    block_count: 1,
    embedded_bytes: 20,
    parameter_count: 1,
    playback_available: true,
  },
  source: { kind: 'original', preset: 'a'.repeat(64) },
};
const bindingsFor = (roles: string[]) =>
  Object.fromEntries(roles.map((role) => [role, source]));

const lite = tone3000ShowcaseRecipes.filter(
  (r) => r.engine === 'tone3000-a2-lite',
);
const full = tone3000ShowcaseRecipes.filter(
  (r) => r.engine === 'tone3000-a2-full',
);
/** NAM instances: every capture block counts, IRs do not. */
const instances = (recipe: (typeof tone3000ShowcaseRecipes)[number]) =>
  recipeEffects(recipe).filter(
    (e) =>
      'native' in e &&
      (!isFactoryVoice(e.native) || factoryVoices[e.native].kind !== 'ir'),
  ).length;

describe('TONE3000 showcase recipes', () => {
  it('meets the tier minimums with distinct names and ids', () => {
    expect(lite.length).toBeGreaterThanOrEqual(12);
    expect(full.length).toBeGreaterThanOrEqual(8);
    expect(lite.length + full.length).toBe(tone3000ShowcaseRecipes.length);
    const names = tone3000ShowcaseRecipes.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    const ids = tone3000ShowcaseRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates, uses named voices only and stays inside the capture budget', () => {
    for (const recipe of tone3000ShowcaseRecipes) {
      expect(validateFactoryMetadata(recipe), recipe.name).toEqual([]);
      const roles = factoryRoles(recipe);
      expect(roles.length).toBeGreaterThan(0);
      for (const role of roles) {
        expect(isFactoryVoice(role), `${recipe.name} ${role}`).toBe(true);
        if (factoryVoices[role as keyof typeof factoryVoices].kind === 'ir')
          continue;
        expect(
          factoryVoices[role as keyof typeof factoryVoices].tiers,
        ).toContain(
          recipe.engine === 'tone3000-a2-lite' ? 'a2-lite' : 'a2-full',
        );
      }
      expect(instances(recipe), recipe.name).toBeGreaterThanOrEqual(1);
      expect(instances(recipe), recipe.name).toBeLessThanOrEqual(
        tone3000CaptureBudget[
          recipe.engine as keyof typeof tone3000CaptureBudget
        ],
      );
      // Captures only: no LV2 blocks anywhere, and no scene effect settings.
      const blocks = recipeEffects(recipe);
      expect(blocks.length, recipe.name).toBeGreaterThan(0);
      expect(
        blocks.every((b) => 'native' in b),
        recipe.name,
      ).toBe(true);
      expect(
        recipe.scenes.every((s) => !s.controls),
        recipe.name,
      ).toBe(true);
    }
  });

  it('has at least three complex presets in each tier, and they really are', () => {
    for (const tier of [lite, full]) {
      const complex = tier.filter((r) => r.complexity === 'complex');
      expect(complex.length).toBeGreaterThanOrEqual(3);
      for (const recipe of complex) {
        // Parallel paths mixed after the captures, some of them panned, and
        // scenes that re-mix them rather than select one.
        expect(recipe.topology, recipe.name).toBe('routed');
        expect(recipe.techniques, recipe.name).toContain('Parallel routing');
        const text = JSON.stringify(recipe.route);
        expect(text, recipe.name).toMatch(/"pan":/);
        expect((text.match(/"name":/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect(
          recipe.scenes.filter((s) => s.mix.filter((m) => m > 0).length > 1)
            .length,
          recipe.name,
        ).toBeGreaterThanOrEqual(2);
      }
    }
    // The genres A2 Full lacked are covered.
    for (const genre of ['Country', 'Jazz', 'Ambient', 'Post-rock'] as const)
      expect(
        full.some((r) => r.genres.includes(genre)),
        genre,
      ).toBe(true);
    // The A2 Lite budget is used.
    expect(lite.some((r) => instances(r) >= 3)).toBe(true);
  });

  it('has no near-copy scenes and no tier twins', () => {
    for (const recipe of tone3000ShowcaseRecipes) {
      // Two scenes never drive the same voices equally hard.
      const mixes = recipe.scenes.map((s) => s.mix.join());
      expect(new Set(mixes).size, recipe.name).toBe(mixes.length);
    }
    // An A2 Full preset built on an A2 Lite preset's capture plays it with a
    // different scene design: none of its scenes drives that capture alone
    // about as hard, at about the same level, as a Lite scene does.
    const near = (a: number, b: number, by: number) => Math.abs(a - b) < by;
    for (const a of lite.filter((r) => r.voices.length === 1))
      for (const b of full) {
        const at = b.voices.findIndex(
          (v) =>
            JSON.stringify(v.effects) === JSON.stringify(a.voices[0]!.effects),
        );
        if (at < 0) continue;
        for (const scene of b.scenes)
          for (const theirs of a.scenes)
            expect(
              scene.mix.every((m, i) => i === at || m === 0) &&
                near(scene.mix[at]!, theirs.mix[0]!, 0.08) &&
                near(scene.level!, theirs.level!, 0.12),
              `${b.name} ${scene.name} / ${a.name} ${theirs.name}`,
            ).toBe(false);
      }
    const shape = (r: (typeof lite)[number]) =>
      JSON.stringify([r.voices, r.route, r.scenes.map((s) => s.mix)]);
    for (const a of lite)
      for (const b of full)
        expect(shape(a), `${a.name} / ${b.name}`).not.toBe(shape(b));
  });

  it('has four to eight scenes, one mix entry per voice and text', () => {
    for (const recipe of tone3000ShowcaseRecipes) {
      expect(recipe.scenes.length).toBeGreaterThanOrEqual(4);
      expect(recipe.scenes.length).toBeLessThanOrEqual(8);
      expect(new Set(recipe.scenes.map((s) => s.name)).size).toBe(
        recipe.scenes.length,
      );
      const width =
        recipe.topology === 'routed'
          ? (recipe.route!.find((s) => 'paths' in s) as { paths: unknown[] })
              .paths.length
          : recipe.voices.length;
      for (const scene of recipe.scenes) {
        expect(scene.mix).toHaveLength(width);
        expect(scene.mix.every((m) => m >= 0 && m <= 1)).toBe(true);
        expect(scene.level).toBeGreaterThan(0);
        expect(scene.level).toBeLessThanOrEqual(2.5);
        // Each scene drives at least one voice.
        expect(scene.mix.some((m) => m > 0)).toBe(true);
      }
      expect(recipe.inspiration.length).toBeGreaterThan(40);
      expect(recipe.performance.length).toBeGreaterThan(40);
    }
  });

  it('builds with fake bindings for its roles', () => {
    for (const recipe of tone3000ShowcaseRecipes) {
      const request = buildFactoryRecipe(
        recipe,
        catalog as Lv2Plugin[],
        bindingsFor(factoryRoles(recipe)),
        'profile',
        crypto.randomUUID(),
      );
      const manifest = JSON.parse(request.manifest_json);
      expect(manifest.name).toBe(`Oxidal · ${recipe.name}`);
      expect(
        manifest.extensions[scenesKey(manifest)!].scenes,
        recipe.name,
      ).toHaveLength(recipe.scenes.length);
    }
  });

  it('names no artist, band or trademark in preset names or text', () => {
    const artists =
      /hendrix|clapton|gilmour|van halen|slash|metallica|mayer|santana|vaughan|page|knopfler|beatles|zeppelin|pink floyd|u2|iron maiden|slayer|pantera|gojira|periphery|petrucci/i;
    const marks =
      /fender|marshall|vox|mesa|boogie|roland|jazz chorus|plexi|ampeg|darkglass|boss|ibanez|soldano|peavey|friedman|diezel|tube screamer|jcm|ac30|twin|deluxe|dumble|bogner|orange|matchless|tone king|two-rock|polytone|fortin|centaur|sansamp|tech21|jhs|rectifier|svt|5150|\bslo\b/i;
    for (const recipe of tone3000ShowcaseRecipes) {
      expect(recipe.name, recipe.name).not.toMatch(marks);
      const text = [
        recipe.description,
        recipe.inspiration,
        recipe.performance,
      ].join(' ');
      expect(text, recipe.name).not.toMatch(artists);
      expect(text, recipe.name).not.toMatch(marks);
    }
  });
});
