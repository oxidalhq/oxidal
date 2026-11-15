import { expect, it, vi } from 'vitest';
import { suggestedSetMessage, suggestedSets } from './setList';

vi.mock('../../api', () => ({ libraryCatalog: vi.fn() }));

it('says what a suggested set added and which sounds still need tones or packs', () => {
  expect(suggestedSetMessage('worship', { added: 3, waiting: [] })).toBe(
    'Worship service: added 3 to the end of your set list.',
  );
  expect(
    suggestedSetMessage('effects', { added: 0, waiting: ['Everything On'] }),
  ).toBe(
    'Oxidal effects tour is already in your set list. Not added yet, they need tones or packs first: Everything On. Get them in Oxidal sounds.',
  );
  expect(suggestedSets.worship.ids[0]).toBe('OX-25');
});
