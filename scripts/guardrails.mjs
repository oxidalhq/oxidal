import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { root, rustEnv } from './process.mjs';

/** Prove each configured gate rejects a representative broken fixture, then remove it.
 * @see docs/architecture.md
 */
function rejects(
  name,
  relative,
  source,
  command,
  args,
  cwd = root,
  env = process.env,
) {
  const path = join(root, relative);
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  writeFileSync(path, source);
  try {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    if (result.error || result.status === null || result.status === 0)
      throw new Error(
        `${name} did not reject its fixture: ${result.error ?? result.stdout}`,
      );
    console.log(`PASS: ${name} rejected fixture (exit ${result.status})`);
  } finally {
    unlinkSync(path);
  }
}
const ui = join(root, 'apps/web');
rejects(
  'ESLint',
  'apps/web/src/guardrail-lint.ts',
  'const unusedControl = 1;\n',
  'pnpm',
  ['exec', 'eslint', 'src/guardrail-lint.ts', '--max-warnings', '0'],
  ui,
);
rejects(
  'TypeScript',
  'apps/web/src/guardrail-type.ts',
  'export const invalidControl: number = "wrong";\n',
  'pnpm',
  ['exec', 'tsc', '--noEmit'],
  ui,
);
rejects(
  'Knip',
  'apps/web/src/guardrail-unused.ts',
  'export const unreferencedControl = 1;\n',
  'pnpm',
  ['knip'],
  ui,
);
rejects(
  'Prettier',
  'apps/web/guardrail-format.json',
  '{"bad":     true}',
  'pnpm',
  ['exec', 'prettier', '--check', 'guardrail-format.json'],
  ui,
);
rejects(
  'Clippy',
  'crates/oxidal-api/src/bin/guardrail-lint.rs',
  'fn main() { let values = Vec::<u8>::new(); if values.len() == 0 { println!("bad"); } }\n',
  'cargo',
  [
    'clippy',
    '--locked',
    '--manifest-path',
    'Cargo.toml',
    '--bin',
    'guardrail-lint',
    '--',
    '-D',
    'warnings',
  ],
  root,
  rustEnv(),
);
rejects(
  'Rustfmt',
  'crates/oxidal-api/src/bin/guardrail-format.rs',
  'fn main(){println!("unformatted");}\n',
  'cargo',
  ['fmt', '--manifest-path', 'Cargo.toml', '--all', '--check'],
  root,
  rustEnv(),
);
console.log(
  'PASS: fixtures removed; invalid graph/commands, OS roots, commits and versions have separate negative unit/integration tests.',
);
