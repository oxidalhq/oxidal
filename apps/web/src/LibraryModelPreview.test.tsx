import { expect, it } from 'vitest';
import { modelSourceLink, modelToneId } from './modelProvenance';
import type { LocalModel } from './api';
const model: LocalModel = {
  id: 'asset',
  name: 'Amp.nam',
  title: 'Amp',
  format: 'nam',
  sha256: 'a'.repeat(64),
};
it('links only explicit TONE3000 identities and preserves third-party placeholders', () => {
  expect(
    modelToneId({
      ...model,
      nam: { trainer: 'TONE3000', author: 'Independent maker' },
    }),
  ).toBeNull();
  expect(modelToneId({ ...model, nam: { source_tone_id: 42 } })).toBe(42);
  expect(
    modelToneId({
      ...model,
      nam: { source_url: 'https://www.tone3000.com/tones/42' },
    }),
  ).toBe(42);
  expect(
    modelToneId({
      ...model,
      nam: { source_url: 'https://evil.example/tones/42' },
    }),
  ).toBeNull();
  expect(
    modelSourceLink({
      ...model,
      nam: { source_url: 'https://www.tone3000.com/tones/my-cab' },
    }),
  ).toBe('https://www.tone3000.com/tones/my-cab');
  expect(
    modelSourceLink({ ...model, nam: { source_url: 'javascript:alert(1)' } }),
  ).toBeNull();
});
