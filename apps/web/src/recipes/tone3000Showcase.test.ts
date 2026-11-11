import { describe, expect, it } from 'vitest';
import catalog from '../fixtures/factory-lv2.json';
import type { Lv2Plugin } from '../api';
import type { RigNativeSource } from '../generated/contract';
import { buildFactoryRecipe, factoryRoles } from '../factoryRecipes.ts';
import { validateFactoryMetadata } from '../factoryMetadata.ts';
import { factoryVoices, isFactoryVoice } from '../factoryVoices.ts';
import {
  tone3000CaptureBudget,
  tone3000ShowcaseRecipes,
} from './tone3000Showcase.ts';

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
const captureCount = (roles: string[]) =>
  roles.filter(
    (role) => !isFactoryVoice(role) || factoryVoices[role].kind !== 'ir',
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
      expect(captureCount(roles), recipe.name).toBeGreaterThanOrEqual(1);
      expect(captureCount(roles), recipe.name).toBeLessThanOrEqual(
        tone3000CaptureBudget[
          recipe.engine as keyof typeof tone3000CaptureBudget
        ],
      );
      // Captures only: no LV2 blocks before, between or after.
      const blocks = [
        ...recipe.before,
        ...recipe.voices.flatMap((v) => v.effects),
        ...recipe.after,
      ];
      expect(
        blocks.every((b) => 'native' in b),
        recipe.name,
      ).toBe(true);
    }
  });

  it('has four to eight scenes, one mix entry per voice and text', () => {
    for (const recipe of tone3000ShowcaseRecipes) {
      expect(recipe.scenes.length).toBeGreaterThanOrEqual(4);
      expect(recipe.scenes.length).toBeLessThanOrEqual(8);
      expect(new Set(recipe.scenes.map((s) => s.name)).size).toBe(
        recipe.scenes.length,
      );
      for (const scene of recipe.scenes) {
        expect(scene.mix).toHaveLength(recipe.voices.length);
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
        manifest.extensions['urn:oxidal:scenes:1'].scenes,
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
