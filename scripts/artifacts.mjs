import { createHash } from 'node:crypto';
import {
  mkdirSync,
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { root, run, rustEnv } from './process.mjs';
import { checkVersions } from './release.mjs';

// @see docs/architecture.md
const versions = checkVersions();
const buildEnv = rustEnv();
// Encoded flags support spaces in checkout paths without shell interpretation.
if (buildEnv.RUSTFLAGS && !buildEnv.CARGO_ENCODED_RUSTFLAGS)
  throw new Error(
    'Use CARGO_ENCODED_RUSTFLAGS for custom artifact build flags.',
  );
buildEnv.CARGO_ENCODED_RUSTFLAGS = [
  ...(buildEnv.CARGO_ENCODED_RUSTFLAGS?.split('\x1f') ?? []),
  '--remap-path-prefix',
  `${homedir()}=/build/user`,
  '--remap-path-prefix',
  `${root}=/build/oxidal`,
].join('\x1f');
run(
  'cargo',
  [
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    'Cargo.toml',
    '--bin',
    'oxidald',
  ],
  { env: buildEnv },
);
run('pnpm', ['--dir', 'apps/web', 'build']);
const target = `${process.platform}-${process.arch}`;
const output = join(root, '.local/artifacts');
mkdirSync(output, { recursive: true });
const staging = join(output, `oxidal-${target}`);
mkdirSync(staging, { recursive: true });
copyFileSync(join(root, 'target/release/oxidald'), join(staging, 'oxidald'));
if (
  /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(
    readFileSync(join(staging, 'oxidald')).toString('latin1'),
  )
)
  throw new Error('Native artifact contains an unremapped private build path.');
cpSync(join(root, 'apps/web/dist'), join(staging, 'ui'), { recursive: true });
cpSync(join(root, 'os/config'), join(staging, 'os/config'), {
  recursive: true,
});
cpSync(join(root, 'os/manifests'), join(staging, 'os/manifests'), {
  recursive: true,
});
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const manifest = {
  format: 1,
  versions,
  target,
  source_revision: git('rev-parse', 'HEAD'),
  working_tree: git('status', '--porcelain') ? 'dirty' : 'clean',
  hardware_qualified: false,
  content:
    'native host preview plus web assets and OS recipe; not a flashable Pi image',
  engine_available: false,
};
writeFileSync(
  join(staging, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const archive = `oxidal-${target}.tar.gz`;
run('tar', ['-czf', join(output, archive), '-C', output, `oxidal-${target}`]);
const checksum = createHash('sha256')
  .update(readFileSync(join(output, archive)))
  .digest('hex');
writeFileSync(join(output, 'SHA256SUMS'), `${checksum}  ${archive}\n`);
console.log(
  `Packaged ${archive}; sha256 ${checksum}. No publication performed.`,
);
