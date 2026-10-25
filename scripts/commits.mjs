import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { run } from './process.mjs';

/** Enforce the owner's semantic title-only commit convention.
 * @see docs/architecture.md
 */
export function validateCommit(message) {
  const text = message.trimEnd();
  if (
    text.includes('\n') ||
    text.length > 100 ||
    !/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9/-]*\))?!?: \S.{0,}$/.test(
      text,
    )
  ) {
    throw new Error(
      'Use one Conventional Commit title, at most 100 characters, with no body.',
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const action = process.argv[2];
  if (action === 'install') {
    const existing = spawnSync(
      'git',
      ['config', '--local', '--get', 'core.hooksPath'],
      { encoding: 'utf8' },
    );
    if (existing.status === 0 && existing.stdout.trim() !== '.githooks')
      throw new Error(
        'Existing hooksPath preserved; chain the Oxidal commit-msg validator into it.',
      );
    run('git', ['config', '--local', 'core.hooksPath', '.githooks']);
  } else if (action === 'file')
    validateCommit(readFileSync(process.argv[3], 'utf8'));
  else if (action === 'range') {
    const range = process.argv[3];
    if (!range) throw new Error('Commit range is required');
    const result = spawnSync('git', ['log', '--format=%B%x00', range], {
      encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr);
    for (const message of result.stdout
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean))
      validateCommit(message);
  } else throw new Error('Expected install, file, or range');
}
