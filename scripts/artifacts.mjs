import { createHash } from 'node:crypto';
import {
  mkdirSync,
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { root, run, rustEnv } from './process.mjs';
import { checkVersions } from './release.mjs';

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
// @see docs/architecture.md
const versions = checkVersions();
const buildEnv = rustEnv();
const appliance = process.argv.includes('--appliance');
if (appliance && git('status', '--porcelain'))
  throw new Error(
    'Commit and clean the source tree before building an appliance bundle.',
  );
if (appliance && process.platform !== 'linux')
  throw new Error('Appliance bundles require a native Linux build host.');
if (appliance) {
  run('python3', ['native/tone3000/build.py'], { env: buildEnv });
  buildEnv.OXIDAL_TONE3000_LIB_DIR ??= join(
    root,
    '.local/tone3000/build-linux',
  );
  buildEnv.OXIDAL_TONE3000_RELOCATABLE = '1';
}
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
    ...(appliance
      ? [
          '--workspace',
          '--bins',
          '--features',
          'oxidal-api/alsa,oxidal-tone3000/audio-worker,oxidal-lv2/worker',
        ]
      : [
          '--bin',
          'oxidald',
          ...(process.platform === 'linux'
            ? ['--features', 'oxidal-api/alsa']
            : []),
        ]),
  ],
  { env: buildEnv },
);
run('pnpm', ['--dir', 'apps/web', 'build']);
const target = `${process.platform}-${process.arch}`;
const output =
  process.env.OXIDAL_ARTIFACT_DIR ?? join(root, '.local/artifacts');
mkdirSync(output, { recursive: true });
const name = `oxidal-${target}${appliance ? '-appliance' : ''}`;
const staging = join(output, name);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const binaries = appliance
  ? [
      'oxidald',
      'oxidal-device-service',
      'oxidal-native-worker',
      'oxidal-audio-worker',
      'oxidal-graph-worker',
    ]
  : ['oxidald'];
mkdirSync(join(staging, 'bin'), { recursive: true });
for (const binary of binaries) {
  const destination = join(staging, 'bin', binary);
  copyFileSync(
    join(
      process.env.CARGO_TARGET_DIR ?? join(root, 'target'),
      'release',
      binary,
    ),
    destination,
  );
  if (
    /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//.test(
      readFileSync(destination).toString('latin1'),
    )
  )
    throw new Error(
      'Native artifact contains an unremapped private build path.',
    );
}
if (appliance) {
  mkdirSync(join(staging, 'lib'), { recursive: true });
  copyFileSync(
    join(buildEnv.OXIDAL_TONE3000_LIB_DIR, 'liboxidal_tone3000.so'),
    join(staging, 'lib/liboxidal_tone3000.so'),
  );
  cpSync(
    join(root, 'native/tone3000/sources.json'),
    join(staging, 'native-sources.json'),
  );
  cpSync(
    join(buildEnv.OXIDAL_TONE3000_LIB_DIR, 'qualification-build.json'),
    join(staging, 'native-build.json'),
  );
}
cpSync(join(root, 'apps/web/dist'), join(staging, 'ui'), { recursive: true });
cpSync(join(root, 'os/config'), join(staging, 'os/config'), {
  recursive: true,
});
cpSync(join(root, 'os/manifests'), join(staging, 'os/manifests'), {
  recursive: true,
});
cpSync(join(root, 'os/scripts/provision.py'), join(staging, 'os/provision.py'));
const files = {};
function inventory(folder, prefix = '') {
  for (const entry of readdirSync(folder)) {
    const file = join(folder, entry);
    const key = prefix + entry;
    if (statSync(file).isDirectory()) inventory(file, `${key}/`);
    else
      files[key] = createHash('sha256')
        .update(readFileSync(file))
        .digest('hex');
  }
}
inventory(staging);
const manifest = {
  format: 2,
  files,
  versions,
  target,
  source_revision: git('rev-parse', 'HEAD'),
  working_tree: git('status', '--porcelain') ? 'dirty' : 'clean',
  hardware_qualified: false,
  content: appliance
    ? 'Linux appliance bundle with isolated native and LV2 playback; hardware unqualified'
    : 'native host preview plus web assets; not a flashable Pi image',
  engine_available: appliance,
};
writeFileSync(
  join(staging, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
const archive = `${name}.tar.gz`;
run('tar', ['-czf', join(output, archive), '-C', output, name]);
const checksum = createHash('sha256')
  .update(readFileSync(join(output, archive)))
  .digest('hex');
writeFileSync(join(output, 'SHA256SUMS'), `${checksum}  ${archive}\n`);
console.log(
  `Packaged ${archive}; sha256 ${checksum}. No publication performed.`,
);
