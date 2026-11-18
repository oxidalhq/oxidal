/**
 * Oxidal effects showcase: metadata, tiers, the capture budget, builds against
 * the plugin fixture, scene shape, scene effect settings and the limit rigs.
 *
 * @see docs/factory-collection.md
 */
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../../docs/presets/manifest.schema.json';
import catalog from '../fixtures/factory-lv2.json';
import type { Lv2Plugin } from '../api';
import type { RigNativeSource } from '../generated/contract';
import { allFactoryRecipes } from '../factoryCatalog';
import {
  buildFactoryRecipe,
  factoryMissingPlugins,
  factoryRoles,
  recipeEffects,
  sceneControlProblems,
  type FactoryRecipe,
} from '../factoryRecipes';
import {
  factoryGenres,
  factoryPackFor,
  factoryPluginNames,
  validateFactoryMetadata,
} from '../factoryMetadata';
import { factoryVoices, isFactoryVoice } from '../factoryVoices';
import { scenesKey } from '../sceneFormat';
import {
  oxidalEffectPlugins,
  oxidalEffectsFeatured,
  oxidalEffectsSetList,
  oxidalEffectsShowcaseRecipes,
  oxidalGenreSet,
  oxidalLimitRigIds,
  oxidalMomentSounds,
  oxidalWorshipSetList,
  type OxidalFeaturedEffect,
} from './oxidalEffectsShowcase';
import { tone3000CaptureBudget } from './tone3000Showcase';

const plugins = catalog as Lv2Plugin[];
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
const validate = new Ajv({ strict: false }).compile(schema);
const limitIds: readonly string[] = oxidalLimitRigIds;
const sounds = oxidalEffectsShowcaseRecipes.filter(
  (r) => !limitIds.includes(r.id) && !oxidalMomentSounds.includes(r),
);
const limits = oxidalEffectsShowcaseRecipes.filter((r) =>
  limitIds.includes(r.id),
);
const effects = Object.keys(oxidalEffectPlugins) as OxidalFeaturedEffect[];
const byId = (id: string) =>
  oxidalEffectsShowcaseRecipes.find((r) => r.id === id)!;
/** NAM instances: every capture block counts, IRs do not. */
const instances = (recipe: FactoryRecipe) =>
  recipeEffects(recipe).filter(
    (e) =>
      'native' in e &&
      (!isFactoryVoice(e.native) || factoryVoices[e.native].kind !== 'ir'),
  ).length;
/** Hybrids have no tier of their own; they keep to the tighter budget, apart
 * from the limit rig built to fill the larger one. */
const budget = (recipe: FactoryRecipe) =>
  recipe.engine === 'tone3000-a2-lite' || recipe.id === 'OX-LIMIT'
    ? tone3000CaptureBudget['tone3000-a2-lite']
    : tone3000CaptureBudget['tone3000-a2-full'];
const blocks = (recipe: FactoryRecipe) =>
  recipeEffects(recipe).flatMap((e) => ('plugin' in e ? [e] : []));
const portOf = (pluginName: string, symbol: string) =>
  plugins
    .find((p) => p.name === pluginName)
    ?.ports.find((p) => p.symbol === symbol && p.control && p.input);
/** Scene settings that count as a change of mode or of time. */
const modeOrTime = ['mode', 'time', 'division'];
const changes = (recipe: FactoryRecipe, key: string) => {
  const block = blocks(recipe).find((b) => b.key === key)!;
  return modeOrTime.some((symbol) => {
    const own = block.controls?.[symbol];
    const values = recipe.scenes.map((s) => s.controls?.[key]?.[symbol] ?? own);
    return new Set(values).size > 1;
  });
};

describe('Oxidal effects showcase', () => {
  it('has 42 sounds and two limit rigs with unique ids and names', () => {
    expect(sounds).toHaveLength(42);
    expect(sounds.map((r) => r.id)).toEqual(
      Array.from(
        { length: 42 },
        (_, i) => `OX-${String(i + 1).padStart(2, '0')}`,
      ),
    );
    expect(limits.map((r) => r.id)).toEqual(['OX-LIMIT', 'OX-LIMIT-F']);
    const ids = allFactoryRecipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = allFactoryRecipes.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    for (const recipe of oxidalEffectsShowcaseRecipes)
      expect(allFactoryRecipes).toContain(recipe);
  });

  it('features each effect in six sounds', () => {
    const all = effects.flatMap((effect) => oxidalEffectsFeatured[effect]);
    expect([...all].sort()).toEqual(
      sounds
        .slice(0, 24)
        .map((r) => r.id)
        .sort(),
    );
    for (const effect of effects) {
      expect(oxidalEffectsFeatured[effect], effect).toHaveLength(6);
      for (const id of oxidalEffectsFeatured[effect]) {
        const recipe = byId(id);
        expect(factoryPluginNames(recipe), id).toContain(
          oxidalEffectPlugins[effect],
        );
        expect(recipe.techniques, id).toContain(effect);
        // The featured effect is the one whose mode or time the scenes change.
        expect(changes(recipe, effect.toLowerCase()), id).toBe(true);
      }
    }
  });

  it('meets the tier minimums and each tier keeps to its effects', () => {
    const count = (engine: string) =>
      sounds.filter((r) => r.engine === engine).length;
    expect(count('lv2')).toBeGreaterThanOrEqual(8);
    expect(count('hybrid')).toBeGreaterThanOrEqual(6);
    expect(count('tone3000-a2-lite')).toBeGreaterThanOrEqual(4);
    expect(count('tone3000-a2-full')).toBeGreaterThanOrEqual(4);
    const elsewhere = new Set(
      allFactoryRecipes
        .filter(
          (r) =>
            r.engine === 'lv2' && !oxidalEffectsShowcaseRecipes.includes(r),
        )
        .flatMap(factoryPluginNames),
    );
    for (const recipe of sounds) {
      const names = factoryPluginNames(recipe);
      const thirdParty = names.filter((n) => factoryPackFor(n));
      // LV2-only: Oxidal's own effects and effects other LV2-only sounds use.
      if (recipe.engine === 'lv2')
        for (const name of names)
          expect(
            name.startsWith('Oxidal ') || elsewhere.has(name),
            `${recipe.id} ${name}`,
          ).toBe(true);
      // Hybrid: a capture and an effect pack. The TONE3000 tiers: captures
      // and Oxidal's own effects only, so they need tones and nothing else.
      else if (recipe.engine === 'hybrid')
        expect(thirdParty.length, recipe.id).toBeGreaterThan(0);
      else expect(thirdParty, recipe.id).toEqual([]);
    }
  });

  it('uses named voices built for the tier, inside the capture budget', () => {
    for (const recipe of oxidalEffectsShowcaseRecipes) {
      const roles = factoryRoles(recipe);
      expect(recipe.engine === 'lv2', recipe.id).toBe(roles.length === 0);
      for (const role of roles) {
        expect(isFactoryVoice(role), `${recipe.id} ${role}`).toBe(true);
        const voice = factoryVoices[role as keyof typeof factoryVoices];
        if (recipe.engine !== 'hybrid')
          expect(voice.tiers, `${recipe.id} ${role}`).toContain(
            recipe.engine === 'tone3000-a2-lite' ? 'a2-lite' : 'a2-full',
          );
      }
      if (recipe.engine !== 'lv2') {
        expect(instances(recipe), recipe.id).toBeGreaterThanOrEqual(1);
        expect(instances(recipe), recipe.id).toBeLessThanOrEqual(
          budget(recipe),
        );
      }
    }
  });

  it('has valid metadata and wording without proper names', () => {
    for (const recipe of oxidalEffectsShowcaseRecipes) {
      expect(validateFactoryMetadata(recipe), recipe.id).toEqual([]);
      const words = recipe.inspiration
        .split(/(?<=[.!?:])\s+/)
        .flatMap((sentence) => sentence.split(/\s+/).slice(1));
      expect(
        words.filter((w) => /^[A-Z][a-z]/.test(w)),
        recipe.id,
      ).toEqual([]);
    }
  });

  it('keeps the four core scenes in order with one small lead lift', () => {
    for (const recipe of oxidalEffectsShowcaseRecipes) {
      expect(recipe.scenes.length, recipe.id).toBeGreaterThanOrEqual(4);
      expect(recipe.scenes.length, recipe.id).toBeLessThanOrEqual(8);
      expect(recipe.scenes[2]!.name, recipe.id).toBe('Lead');
      const width =
        recipe.topology === 'routed'
          ? (recipe.route!.find((s) => 'paths' in s) as { paths: unknown[] })
              .paths.length
          : recipe.voices.length;
      const names = recipe.scenes.map((s) => s.name);
      expect(new Set(names).size, recipe.id).toBe(names.length);
      const distinct = recipe.scenes.map(
        (s) => `${s.mix.join()}|${JSON.stringify(s.controls ?? {})}`,
      );
      expect(new Set(distinct).size, recipe.id).toBe(distinct.length);
      const power = (s: FactoryRecipe['scenes'][number]) =>
        s.mix.reduce((sum, v) => sum + v * v, 0);
      for (const [i, scene] of recipe.scenes.entries()) {
        expect(scene.mix, recipe.id).toHaveLength(width);
        expect(Math.max(...scene.mix), recipe.id).toBeLessThanOrEqual(1);
        expect(Math.max(...scene.mix), recipe.id).toBeGreaterThan(0);
        // Routed scenes carry the lift in the mix; the others in the level.
        if (recipe.topology === 'routed') {
          const db = 10 * Math.log10(power(scene) / power(recipe.scenes[0]!));
          if (i === 2) expect(db, recipe.id).toBeGreaterThan(1);
          else expect(Math.abs(db), recipe.id).toBeLessThan(0.1);
        } else if (i === 2) {
          expect(scene.level, recipe.id).toBeGreaterThan(1);
          expect(scene.level, recipe.id).toBeLessThanOrEqual(1.2);
        } else expect(scene.level, recipe.id).toBe(1);
      }
    }
  });

  it('sets only real controls, to values inside their range', () => {
    for (const recipe of oxidalEffectsShowcaseRecipes) {
      expect(sceneControlProblems(recipe, plugins), recipe.id).toEqual([]);
      const keyed = new Map(
        blocks(recipe).flatMap((b) => (b.key ? [[b.key, b] as const] : [])),
      );
      const check = (plugin: string, symbol: string, value: number) => {
        const where = `${recipe.id} ${plugin} ${symbol}=${value}`;
        const port = portOf(plugin, symbol);
        expect(port, where).toBeDefined();
        expect(value, where).toBeGreaterThanOrEqual(port!.minimum!);
        expect(value, where).toBeLessThanOrEqual(port!.maximum!);
        if (port!.integer) expect(Number.isInteger(value), where).toBe(true);
      };
      // The blocks' own settings, for the four effects.
      for (const block of blocks(recipe))
        if (Object.values(oxidalEffectPlugins).includes(block.plugin))
          for (const [symbol, value] of Object.entries(block.controls ?? {}))
            check(block.plugin, symbol, value);
      // What the scenes set.
      for (const scene of recipe.scenes)
        for (const [key, values] of Object.entries(scene.controls ?? {})) {
          const block = keyed.get(key);
          expect(block, `${recipe.id} ${key}`).toBeDefined();
          for (const [symbol, value] of Object.entries(values))
            check(block!.plugin, symbol, value);
        }
      // The gated reverb's length stays inside what that mode uses.
      for (const scene of recipe.scenes) {
        const own = keyed.get('bloom')?.controls ?? {};
        const set = { ...own, ...scene.controls?.bloom };
        if (set.mode === 7)
          expect(set.decay, `${recipe.id} ${scene.name}`).toBeLessThanOrEqual(
            1.2,
          );
      }
    }
  });

  it('changes a mode or a time in some scene of every sound', () => {
    for (const recipe of oxidalEffectsShowcaseRecipes)
      expect(
        ['bloom', 'sustain', 'echo', 'motion', 'moment'].some(
          (key) =>
            blocks(recipe).some((b) => b.key === key) && changes(recipe, key),
        ),
        recipe.id,
      ).toBe(true);
  });

  it('builds every sound against the installed plugins', () => {
    for (const recipe of oxidalEffectsShowcaseRecipes) {
      expect(factoryMissingPlugins(recipe, plugins), recipe.id).toEqual([]);
      const bindings = Object.fromEntries(
        factoryRoles(recipe).map((role) => [role, source]),
      );
      const request = buildFactoryRecipe(
        recipe,
        plugins,
        bindings,
        'profile',
        crypto.randomUUID(),
      );
      const manifest = JSON.parse(request.manifest_json);
      expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
      const built = manifest.extensions[scenesKey(manifest)!].scenes;
      expect(built, recipe.id).toHaveLength(recipe.scenes.length);
      expect(manifest.tone3000.instances, recipe.id).toHaveLength(
        instances(recipe),
      );
    }
  });

  it('combines the effects in the service, rhythm-and-lead and genre sounds', () => {
    const own = Object.values(oxidalEffectPlugins);
    for (const recipe of sounds.slice(24)) {
      const used = factoryPluginNames(recipe).filter((n) => own.includes(n));
      expect(used.length, recipe.id).toBeGreaterThanOrEqual(3);
      // Sustain ahead of every drive and capture; Bloom last.
      const order = recipeEffects(recipe);
      const at = order.findIndex(
        (e) => 'plugin' in e && e.plugin === oxidalEffectPlugins.Sustain,
      );
      if (at >= 0) expect(at, recipe.id).toBe(0);
      const last = order.at(-1)!;
      expect('plugin' in last && last.plugin, recipe.id).toBe(
        oxidalEffectPlugins.Bloom,
      );
    }
    // The service rig: one version with a capture, one that needs no tones,
    // with a dotted-eighth and a quarter-note echo locked to the BPM.
    const [service, direct] = [byId('OX-25'), byId('OX-26')];
    expect(service.engine).toBe('tone3000-a2-lite');
    expect(direct.engine).toBe('lv2');
    expect(direct.scenes).toEqual(service.scenes);
    expect(service.scenes).toHaveLength(8);
    const echo = blocks(service).find((b) => b.key === 'echo')!;
    expect(echo.controls).toMatchObject({ sync: 1, division: 7 });
    expect(service.scenes.some((s) => s.controls?.echo?.division === 6)).toBe(
      true,
    );
    expect(service.scenes.some((s) => s.controls?.bloom?.freeze === 1)).toBe(
      true,
    );
    // Rhythm and lead: a crunch version with a capture and a clean one; the
    // lead scenes switch Sustain on and lengthen the echo and the reverb.
    for (const id of ['OX-27', 'OX-28']) {
      const recipe = byId(id);
      const own_ = (key: string) =>
        blocks(recipe).find((b) => b.key === key)!.controls!;
      const lead = recipe.scenes[2]!.controls!;
      expect(own_('sustain').on, id).toBe(0);
      expect(lead.sustain!.on, id).toBe(1);
      expect(lead.echo!.time, id).toBeGreaterThan(own_('echo').time!);
      expect(lead.bloom!.decay, id).toBeGreaterThan(own_('bloom').decay!);
    }
    expect(byId('OX-27').engine).not.toBe('lv2');
    expect(byId('OX-28').engine).toBe('lv2');
  });

  it('walks through Moment on one caught loop', () => {
    const [recipe] = oxidalMomentSounds as [FactoryRecipe];
    expect(recipe.id).toBe('OX-43');
    expect(recipe.engine).toBe('lv2');
    expect(factoryPluginNames(recipe)).toContain('Oxidal Moment (Stereo)');
    expect(
      factoryPluginNames(recipe).every((n) => n.startsWith('Oxidal ')),
    ).toBe(true);
    expect(recipe.scenes).toHaveLength(8);
    // The first scene listens; every other scene keeps the loop it caught.
    const [listen, ...caught] = recipe.scenes;
    expect(listen!.controls?.moment?.catch ?? 0).toBe(0);
    for (const scene of caught)
      expect(scene.controls?.moment?.catch, scene.name).toBe(1);
    const set = (symbol: string) =>
      new Set(caught.map((s) => s.controls?.moment?.[symbol]));
    // All three loop modes and all three wet modes are heard.
    expect([...set('loopmode')].sort()).toEqual([1, 2, undefined]);
    expect([...set('wetmode')].sort()).toEqual([1, 2, undefined]);
  });

  it('has one setup for every genre', () => {
    expect(Object.keys(oxidalGenreSet).sort()).toEqual(
      [...factoryGenres].sort(),
    );
    const ids = Object.values(oxidalGenreSet);
    expect(new Set(ids).size).toBe(ids.length);
    for (const genre of factoryGenres) {
      const recipe = byId(oxidalGenreSet[genre]);
      expect(recipe, genre).toBeDefined();
      expect(recipe.genres, genre).toContain(genre);
    }
    // Every sound after the two rigs is some genre's setup.
    for (const recipe of sounds.slice(28))
      expect(ids, recipe.id).toContain(recipe.id);
    expect(
      ids.filter((id) => byId(id).engine === 'lv2').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('pushes the unit with the limit rigs', () => {
    const [lite, full] = limits as [FactoryRecipe, FactoryRecipe];
    // Hybrid: the boost ahead of the amps comes from an effect pack.
    expect(lite.engine).toBe('hybrid');
    expect(full.engine).toBe('hybrid');
    expect(instances(lite)).toBe(tone3000CaptureBudget['tone3000-a2-lite']);
    expect(instances(full)).toBe(tone3000CaptureBudget['tone3000-a2-full']);
    for (const recipe of limits) {
      expect(recipe.complexity).toBe('complex');
      expect(recipe.topology).toBe('routed');
      expect(recipe.scenes).toHaveLength(8);
      // Sustain, drive, the captures, then Motion, Echo and Bloom last.
      const order = recipeEffects(recipe).map((e) =>
        'native' in e ? 'capture' : e.plugin,
      );
      expect(order.filter((o) => o !== 'capture')).toEqual([
        oxidalEffectPlugins.Sustain,
        'GxTubeScreamer',
        oxidalEffectPlugins.Motion,
        oxidalEffectPlugins.Echo,
        oxidalEffectPlugins.Bloom,
      ]);
      expect(order.indexOf('capture')).toBe(2);
      for (const key of ['sustain', 'motion', 'echo', 'bloom']) {
        expect(changes(recipe, key), `${recipe.id} ${key}`).toBe(true);
        // Every scene sets the effect, so no scene depends on the last one.
        for (const scene of recipe.scenes)
          expect(scene.controls?.[key], `${recipe.id} ${key}`).toBeDefined();
      }
      for (const key of ['motion', 'echo', 'bloom'])
        expect(
          new Set(recipe.scenes.map((s) => s.controls![key]!.mode)).size,
          `${recipe.id} ${key}`,
        ).toBeGreaterThanOrEqual(6);
      expect(
        new Set(recipe.scenes.map((s) => s.controls!.echo!.time)).size,
      ).toBe(8);
    }
  });

  it('offers a set list: the limit rig, then a sound for each effect', () => {
    const list: readonly string[] = oxidalEffectsSetList;
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.length).toBeLessThanOrEqual(8);
    expect(new Set(list).size).toBe(list.length);
    expect(list[0]).toBe('OX-LIMIT');
    for (const id of list) expect(byId(id), id).toBeDefined();
    for (const effect of effects)
      expect(
        list.some((id) => oxidalEffectsFeatured[effect].includes(id)),
        effect,
      ).toBe(true);
    // Everything after the limit rig plays without tones.
    for (const id of list.slice(1)) expect(byId(id).engine, id).toBe('lv2');

    const worship: readonly string[] = oxidalWorshipSetList;
    expect(worship[0]).toBe('OX-25');
    expect(worship).toHaveLength(4);
    expect(new Set(worship).size).toBe(4);
    for (const id of worship) {
      expect(byId(id), id).toBeDefined();
      // One capture size for the whole list, or no captures.
      expect(['lv2', 'tone3000-a2-lite'], id).toContain(byId(id).engine);
    }
  });
});
