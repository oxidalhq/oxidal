import { resolve, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { root, run } from './process.mjs';

// Optional reference regeneration; normal CI uses committed independent golden vectors.
// @see docs/architecture.md
if (!process.argv[2] || !process.argv[3])
  throw new Error(
    'Usage: node scripts/nam-oracle.mjs <pinned-core> <pinned-eigen> [--write]',
  );
const reference = resolve(process.argv[2]);
const eigen = resolve(process.argv[3]);
const fixture = join(root, 'crates/oxidal-nam/tests/fixtures/parity.json');
const suite = JSON.parse(readFileSync(fixture, 'utf8'));
const pin = spawnSync('git', ['-C', reference, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
});
const dirty = spawnSync('git', ['-C', reference, 'status', '--porcelain'], {
  encoding: 'utf8',
});
if (
  pin.status !== 0 ||
  pin.stdout.trim() !== suite.reference.core_commit ||
  dirty.status !== 0 ||
  dirty.stdout.trim()
)
  throw new Error('Reference source must be clean and match the recorded pin.');
const output = join(root, '.local/nam-reference');
mkdirSync(join(root, '.local'), { recursive: true });
run('clang++', [
  '-std=c++20',
  '-O2',
  '-DNAM_SAMPLE_FLOAT',
  '-Wno-deprecated-anon-enum-enum-conversion',
  '-I',
  reference,
  '-I',
  join(reference, 'Dependencies/nlohmann'),
  '-I',
  eigen,
  'tools/nam-reference.cpp',
  ...['dsp.cpp', 'lstm.cpp', 'activations.cpp'].map((file) =>
    join(reference, 'NAM', file),
  ),
  '-o',
  output,
]);
const result = spawnSync(output, [fixture], {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
if (result.status !== 0) throw new Error(result.stderr);
const actual = JSON.parse(result.stdout);
for (let i = 0; i < suite.cases.length; i++) {
  const error = Math.max(
    ...suite.cases[i].expected.map((value, n) =>
      Math.abs(value - actual.cases[i].expected[n]),
    ),
  );
  if (error > suite.reference.absolute_tolerance)
    throw new Error(`Reference drift: ${suite.cases[i].name}: ${error}`);
  console.log(`${suite.cases[i].name}: maximum reference drift ${error}`);
}
if (process.argv.includes('--write')) writeFileSync(fixture, result.stdout);
