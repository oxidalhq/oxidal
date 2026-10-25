import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import { rustEnv } from './process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(
  'rustup',
  [
    'run',
    '1.95.0',
    'cargo',
    'run',
    '--locked',
    '--quiet',
    '--manifest-path',
    'Cargo.toml',
    '--bin',
    'export-schema',
  ],
  { cwd: root, encoding: 'utf8', env: rustEnv() },
);
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const schema = JSON.parse(result.stdout);
const types = await compile(schema, 'Contract', {
  bannerComment:
    '/* Generated from Rust. Run pnpm contract:generate; do not edit. */',
  additionalProperties: false,
  unknownAny: false,
});
const outputs = {
  'apps/web/src/generated/contract.schema.json': `${JSON.stringify(schema, null, 2)}\n`,
  'apps/web/src/generated/contract.ts': types,
};
for (const [path, content] of Object.entries(outputs)) {
  const absolute = new URL(`../${path}`, import.meta.url);
  if (process.argv.includes('--check')) {
    if ((await readFile(absolute, 'utf8').catch(() => '')) !== content) {
      throw new Error(`Contract drift: ${path}. Run pnpm contract:generate.`);
    }
  } else {
    await mkdir(new URL('.', absolute), { recursive: true });
    await writeFile(absolute, content);
  }
}
console.log(
  process.argv.includes('--check')
    ? 'Contract matches Rust.'
    : 'Contract generated from Rust.',
);
