import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = fileURLToPath(new URL('../', import.meta.url));
const command = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  .scripts['format:staged'];
const input = '# Controls\n\n|Name|Value|\n|-|-|\n|Gain|50|\n';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'oxidal-markdown-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    ...process.env,
    PATH: `${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH}`,
  };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ])
    delete env[key];
  const run = (program, args) => {
    const result = spawnSync(program, args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.name', 'Formatting fixture']);
  run('git', ['config', 'user.email', 'fixture@users.noreply.github.com']);
  run('git', ['config', 'core.hooksPath', '.no-hooks']);
  run('git', ['commit', '--allow-empty', '-qm', 'chore: create fixture']);
  writeFileSync(
    join(cwd, '.prettierrc.json'),
    JSON.stringify({ proseWrap: 'preserve' }),
  );
  return {
    cwd,
    run,
    stage: (name, text) => {
      writeFileSync(join(cwd, name), text);
      run('git', ['add', '--', name]);
    },
    apply: () => run('sh', ['-c', command]),
  };
}

test('staged Markdown tables are formatted automatically, including shell-sensitive filenames', async (t) => {
  const f = fixture(t);
  const name = 'notes $(touch marker).md';
  f.stage(name, input);
  f.apply();
  const expected = await format(input, {
    parser: 'markdown',
    proseWrap: 'preserve',
  });
  assert.equal(f.run('git', ['show', `:${name}`]), expected);
  assert.equal(readFileSync(join(f.cwd, name), 'utf8'), expected);
  assert.equal(existsSync(join(f.cwd, 'marker')), false);
});

test('partially staged Markdown never includes unstaged prose in the index', async (t) => {
  const f = fixture(t);
  f.stage('partial.md', input);
  writeFileSync(
    join(f.cwd, 'partial.md'),
    `${input}\nUnstaged private draft.\n`,
  );
  f.apply();
  const expected = await format(input, {
    parser: 'markdown',
    proseWrap: 'preserve',
  });
  assert.equal(f.run('git', ['show', ':partial.md']), expected);
  assert.match(
    readFileSync(join(f.cwd, 'partial.md'), 'utf8'),
    /Unstaged private draft/,
  );
  assert.match(
    f.run('git', ['diff', '--', 'partial.md']),
    /Unstaged private draft/,
  );
});
