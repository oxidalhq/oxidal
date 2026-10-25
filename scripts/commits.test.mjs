import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommit } from './commits.mjs';

test('accepts semantic titles including automated release titles', () => {
  for (const title of [
    'feat(control): synchronize MIDI and web',
    'fix!: change protocol',
    'chore(main): release oxidal 0.2.0\n',
  ])
    assert.doesNotThrow(() => validateCommit(title));
});
test('rejects bodies, untyped titles, and overlong titles', () => {
  for (const title of [
    'Update stuff',
    'feat: add service\n\nA body',
    `feat: ${'x'.repeat(100)}`,
  ])
    assert.throws(() => validateCommit(title));
});
