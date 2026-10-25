import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVersions, nextVersion } from './release.mjs';
import { validateCommit } from './commits.mjs';

test('release bump policy handles fixes, features and pre-1.0 breaking changes', () => {
  assert.equal(nextVersion('0.1.0', ['fix(core): repair routing']), '0.1.1');
  assert.equal(nextVersion('0.1.0', ['feat(ui): add mapping editor']), '0.2.0');
  assert.equal(
    nextVersion('0.1.0', ['feat(core)!: change command contract']),
    '0.2.0',
  );
  assert.equal(nextVersion('1.2.3', ['fix(core)!: change protocol']), '2.0.0');
  assert.equal(nextVersion('0.1.0', ['docs: explain local setup']), '0.1.0');
});
test('release metadata is consistent and generated titles fit the commit rule', () => {
  assert.match(checkVersions()['.'], /^\d+\.\d+\.\d+$/);
  for (const component of ['core', 'ui', 'os'])
    validateCommit(`chore(main): release ${component} 0.2.0`);
});
