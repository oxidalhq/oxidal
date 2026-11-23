import { expect, it } from 'vitest';

import { factoryVoiceIds, factoryVoices } from './factoryVoices.ts';

/**
 * @see docs/factory-collection.md
 */
it('records tone ids and tiers for the TONE3000 showcase voices', () => {
  const showcase = factoryVoiceIds.filter((id) => factoryVoices[id].tiers);
  expect(showcase.length).toBeGreaterThanOrEqual(25);
  for (const id of showcase) {
    const voice = factoryVoices[id];
    expect(voice.tiers!.length).toBeGreaterThan(0);
    expect(voice.captures[0]!.tone).toBeGreaterThan(0);
  }
  expect(factoryVoices['match-brave'].captures[0]!.tone).toBe(80592);
  for (const ir of ['ir-deluxe', 'ir-mesa-os', 'ir-ampeg-810'] as const)
    expect(factoryVoices[ir].kind).toBe('ir');
});

it('stores no provider title and keeps voice characters free of product names', () => {
  const marks =
    /fender|marshall|vox|mesa|roland|ampeg|darkglass|boss|ibanez|soldano|peavey|friedman|diezel|tube screamer|jcm|ac30|dumble|centaur|sansamp|jhs|plexi|blackface|rectifier|\b800\b/i;
  for (const id of factoryVoiceIds) {
    // A label falls back to the voice's own description of the sound.
    expect(factoryVoices[id], id).not.toHaveProperty('title');
    expect(factoryVoices[id].character, id).not.toMatch(marks);
  }
});

it('gives every older recipe role a concrete first-use capture', () => {
  for (const role of ['clean', 'crunch', 'heavy', 'bass'] as const) {
    expect(factoryVoices[role].captures[0]?.tone).toBeGreaterThan(0);
    expect(factoryVoices[role].captures[0]?.model).toBeGreaterThan(0);
  }
});
