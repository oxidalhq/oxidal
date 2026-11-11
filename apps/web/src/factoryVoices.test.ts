import { expect, it } from 'vitest';
import { factoryVoiceIds, factoryVoices } from './factoryVoices.ts';

/**
 * @see docs/factory-collection.md
 */
it('records tone ids, titles and tiers for the TONE3000 showcase voices', () => {
  const showcase = factoryVoiceIds.filter((id) => factoryVoices[id].tiers);
  expect(showcase.length).toBeGreaterThanOrEqual(25);
  for (const id of showcase) {
    const voice = factoryVoices[id];
    expect(voice.title?.length, id).toBeGreaterThan(2);
    expect(voice.tiers!.length).toBeGreaterThan(0);
    expect(voice.captures[0]!.tone).toBeGreaterThan(0);
  }
  expect(factoryVoices['match-brave'].captures[0]!.tone).toBe(80592);
  for (const ir of ['ir-deluxe', 'ir-mesa-os', 'ir-ampeg-810'] as const)
    expect(factoryVoices[ir].kind).toBe('ir');
});

it('keeps voice characters free of product names', () => {
  const marks =
    /fender|marshall|vox|mesa|roland|ampeg|darkglass|boss|ibanez|soldano|peavey|friedman|diezel|tube screamer|jcm|ac30|dumble|centaur|sansamp|jhs/i;
  for (const id of factoryVoiceIds)
    if (factoryVoices[id].tiers && id !== 'plexi-crunch')
      expect(factoryVoices[id].character, id).not.toMatch(marks);
});
