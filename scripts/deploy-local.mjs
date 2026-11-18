#!/usr/bin/env node
/**
 * One-command deployment to a private development Pi image.
 *
 *   pnpm deploy:local                 # splitter runtime, binaries and UI
 *   pnpm deploy:local ui              # only the web UI
 *   pnpm deploy:local bins splitter   # any combination of parts
 *   pnpm deploy:local lv2             # Oxidal's own Rust effect bundles
 *   pnpm deploy:local certificate     # original public CA, never private keys
 *   pnpm deploy:local helper          # once per image: install the newer helper
 *   pnpm deploy:local --build-only    # build and pack without touching the Pi
 *
 * Binaries and the splitter runner are built for Linux ARM64 in Docker
 * (rust:1.95-bookworm runs natively on Apple Silicon). Each part is copied to
 * the Pi's fixed /tmp path and installed by the image's checksum-bound
 * `oxidal-development-deploy` helper, which needs no password for these
 * listed modes. Set OXIDAL_PI to choose the SSH target and
 * OXIDAL_SPLITTER_MODELS for the four model files listed in
 * thirdparty/oxidal-splitter/SHA256SUMS.models. Certificate installation requires
 * OXIDAL_ACCESS_DIR pointing to the original device setup folder.
 *
 * @see os/README.md
 * @see docs/media.md
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { root, run } from './process.mjs';

const host = process.env.OXIDAL_PI ?? 'oxidal-admin@oxidal.local';
const buildOnly = process.argv.includes('--build-only');
const parts = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const wanted = new Set(parts.length ? parts : ['splitter', 'bins', 'ui']);
for (const part of wanted)
  if (
    !['splitter', 'bins', 'ui', 'lv2', 'certificate', 'helper'].includes(part)
  )
    throw new Error(
      `Unknown part "${part}". Use ui, bins, splitter, lv2, certificate or helper.`,
    );

const work = join(root, '.local/deploy-local');
const splitterDir = join(root, 'thirdparty/oxidal-splitter');
const image = 'oxidal-pi-build:rust-1.95-bookworm';
const helper = '/usr/local/sbin/oxidal-development-deploy';
const features = [
  'oxidal-api/alsa',
  'oxidal-tone3000/audio-worker',
  'oxidal-lv2/worker',
  'oxidal-engine/worker',
].join(',');
const binaries = [
  'oxidald',
  'oxidal-audio-worker',
  'oxidal-graph-worker',
  'oxidal-rig-worker',
  'oxidal-native-worker',
];
/** Oxidal's own Rust effects, as the helper's LV2_EFFECTS lists them. */
const effects = ['bloom', 'sustain', 'echo', 'motion', 'moment'];
mkdirSync(join(work, 'target'), { recursive: true });

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const step = (text) => console.log(`\n== ${text}`);
const ssh = (command, options = {}) => run('ssh', [host, command], options);
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Verify every "digest  name" line of a SHA256SUMS file inside `dir`. */
function verifySums(sums, dir) {
  for (const line of readFileSync(sums, 'utf8').split('\n')) {
    const [digest, name] = line.trim().split(/\s+/);
    if (!digest) continue;
    const path = join(dir, name);
    if (!existsSync(path)) throw new Error(`Missing ${path}`);
    if (sha256(path) !== digest) throw new Error(`Checksum mismatch: ${path}`);
  }
}

/** A deterministic, macOS-metadata-free gzip tarball of `dir`. */
function pack(dir, archive) {
  const mac = process.platform === 'darwin';
  run(
    'tar',
    [
      ...(mac ? ['--no-mac-metadata', '--no-xattrs'] : []),
      '-czf',
      archive,
      '-C',
      dir,
      '.',
    ],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } },
  );
  return sha256(archive);
}

function install(mode, archive) {
  const digest = sha256(archive);
  if (buildOnly) {
    console.log(`Built ${archive} (${digest})`);
    return;
  }
  step(`Installing ${mode} on ${host}`);
  run('scp', ['-q', archive, `${host}:/tmp/oxidal-${mode}.tgz`]);
  ssh(`sudo -n ${helper} ${mode} ${digest}`);
}

function dockerImage() {
  if (capture('docker', ['image', 'inspect', image])) return;
  step(`Building the ${image} build image`);
  run('docker', ['build', '-t', image, '-'], {
    input: [
      'FROM rust:1.95-bookworm',
      'RUN apt-get update && apt-get install -y --no-install-recommends \\',
      '  libasound2-dev pkg-config liblilv-dev lv2-dev cmake clang \\',
      '  && rm -rf /var/lib/apt/lists/*',
      '',
    ].join('\n'),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

function docker(args, env = {}) {
  run('docker', [
    'run',
    '--rm',
    '--platform',
    'linux/arm64',
    '-v',
    `${root}:/src`,
    '-v',
    `${join(work, 'target')}:/target`,
    '-v',
    'oxidal-pi-cargo-registry:/usr/local/cargo/registry',
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    '-w',
    '/src',
    image,
    ...args,
  ]);
}

if (wanted.has('helper')) {
  step('Installing the deploy helper (asks for the Pi admin password once)');
  const sudoers = join(work, 'oxidal-development-deploy.sudoers');
  writeFileSync(
    sudoers,
    '# Private development image: scoped Oxidal application deploy only.\n' +
      `oxidal-admin ALL=(root) NOPASSWD: ${helper} bins *, ${helper} ui *, ${helper} splitter *, ${helper} lv2 *, ${helper} certificate *\n`,
  );
  run('scp', [
    '-q',
    join(root, 'os/scripts/development_deploy.py'),
    sudoers,
    `${host}:/tmp/`,
  ]);
  run('ssh', [
    '-t',
    host,
    'sudo visudo -cf /tmp/oxidal-development-deploy.sudoers' +
      ` && sudo install -m 0755 -o root -g root /tmp/development_deploy.py ${helper}` +
      ' && sudo install -m 0440 -o root -g root /tmp/oxidal-development-deploy.sudoers /etc/sudoers.d/oxidal-development-deploy' +
      ' && rm -f /tmp/development_deploy.py /tmp/oxidal-development-deploy.sudoers' +
      ' && echo "Deploy helper updated."',
  ]);
}

if (!buildOnly) {
  step(`Checking SSH and the deploy helper on ${host}`);
  ssh('true');
}
if (
  !buildOnly &&
  wanted.has('splitter') &&
  spawnSync('ssh', [
    host,
    `grep -q "'splitter'" ${helper} && sudo -n -l | grep -q "${helper} splitter"`,
  ]).status !== 0
)
  throw new Error(
    'The Pi helper cannot install the splitter yet. Run `pnpm deploy:local helper` once, then deploy again.',
  );

if (
  !buildOnly &&
  wanted.has('lv2') &&
  spawnSync('ssh', [
    host,
    `grep -q "'lv2'" ${helper} && sudo -n -l | grep -q "${helper} lv2"`,
  ]).status !== 0
)
  throw new Error(
    'The Pi helper cannot install effects yet. Run `pnpm deploy:local helper` once, then deploy again.',
  );

if (wanted.has('certificate')) {
  const access = process.env.OXIDAL_ACCESS_DIR;
  if (!access)
    throw new Error(
      'Set OXIDAL_ACCESS_DIR to the original device setup folder.',
    );
  step('Verifying the original public CA against its server certificate');
  run('python3', [
    '-c',
    [
      'import importlib.util, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("deploy", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'access = pathlib.Path(sys.argv[2])',
      'ca = access / "ca.crt"',
      'if ca.stat().st_size > module.CERTIFICATE_MAX_BYTES: raise ValueError("Public CA is too large")',
      'module.certificate_files(ca.read_bytes(), access / "server.crt")',
    ].join('\n'),
    join(root, 'os/scripts/development_deploy.py'),
    access,
  ]);
  if (
    !buildOnly &&
    spawnSync('ssh', [
      host,
      `grep -q "'certificate'" ${helper} && sudo -n -l | grep -q "${helper} certificate"`,
    ]).status !== 0
  )
    throw new Error(
      'The Pi helper cannot install the public CA yet. Run `pnpm deploy:local helper` once, then deploy again.',
    );
  const stage = join(work, 'certificate');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  copyFileSync(join(access, 'ca.crt'), join(stage, 'ca.crt'));
  pack(stage, join(work, 'oxidal-certificate.tgz'));
  install('certificate', join(work, 'oxidal-certificate.tgz'));
}

if (wanted.has('splitter')) {
  const models =
    process.env.OXIDAL_SPLITTER_MODELS ?? join(splitterDir, 'models');
  step('Checking the pinned runtime and model files');
  verifySums(
    join(splitterDir, 'onnxruntime/SHA256SUMS'),
    join(splitterDir, 'onnxruntime'),
  );
  verifySums(join(splitterDir, 'SHA256SUMS.models'), models);
  dockerImage();
  step('Building the Linux ARM64 splitter runner');
  docker([
    'cargo',
    'build',
    '--locked',
    '--release',
    '--manifest-path',
    'thirdparty/oxidal-splitter/demucs-onnx/Cargo.toml',
    '--target-dir',
    '/target/splitter',
  ]);
  const stage = join(work, 'splitter');
  rmSync(stage, { recursive: true, force: true });
  for (const dir of ['bin', 'lib', 'models', 'notices'])
    mkdirSync(join(stage, dir), { recursive: true });
  const copy = (from, to) => copyFileSync(from, join(stage, to));
  copy(join(splitterDir, 'bin/demucs-onnx'), 'bin/demucs-onnx');
  copy(
    join(work, 'target/splitter/release/demucs-onnx'),
    'bin/demucs-onnx.real',
  );
  for (const name of [
    'libonnxruntime.so.1.23.2',
    'libonnxruntime_providers_shared.so',
  ])
    copy(join(splitterDir, 'onnxruntime/linux-aarch64', name), `lib/${name}`);
  for (const name of [
    'htdemucs.onnx',
    'htdemucs.json',
    'htdemucs_6s.onnx',
    'htdemucs_6s.json',
  ])
    copy(join(models, name), `models/${name}`);
  copy(join(splitterDir, 'SHA256SUMS.models'), 'models/SHA256SUMS');
  copy(join(splitterDir, 'demucs-onnx/LICENSE'), 'notices/demucs-onnx-LICENSE');
  copy(
    join(splitterDir, 'demucs-onnx/Cargo.lock'),
    'notices/demucs-onnx-Cargo.lock',
  );
  copy(
    join(splitterDir, 'onnxruntime/LICENSE'),
    'notices/ONNX-Runtime-LICENSE',
  );
  copy(
    join(splitterDir, 'onnxruntime/ThirdPartyNotices.txt'),
    'notices/ONNX-Runtime-ThirdPartyNotices.txt',
  );
  copy(
    join(splitterDir, 'model-source-and-licence.txt'),
    'notices/model-source-and-licence.txt',
  );
  run('chmod', ['0755', join(stage, 'bin/demucs-onnx')]);
  pack(stage, join(work, 'oxidal-splitter.tgz'));
  install('splitter', join(work, 'oxidal-splitter.tgz'));
}

if (wanted.has('bins')) {
  dockerImage();
  step('Fetching the Pi native adapter library for linking');
  const tone = join(work, 'tone3000');
  mkdirSync(tone, { recursive: true });
  if (!buildOnly || !existsSync(join(tone, 'liboxidal_tone3000.so')))
    run('scp', [
      '-q',
      `${host}:/opt/oxidal/lib/liboxidal_tone3000.so`,
      `${tone}/`,
    ]);
  step('Building Linux ARM64 binaries (all workers, appliance features)');
  docker(
    [
      'cargo',
      'build',
      '--release',
      '--locked',
      '--workspace',
      '--bins',
      '--features',
      features,
      '--target-dir',
      '/target/bins',
    ],
    {
      OXIDAL_TONE3000_LIB_DIR: '/src/.local/deploy-local/tone3000',
      OXIDAL_TONE3000_RELOCATABLE: '1',
    },
  );
  const stage = join(work, 'bins');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage);
  for (const name of binaries)
    copyFileSync(join(work, 'target/bins/release', name), join(stage, name));
  pack(stage, join(work, 'oxidal-bins.tgz'));
  install('bins', join(work, 'oxidal-bins.tgz'));
}

if (wanted.has('lv2')) {
  dockerImage();
  step('Building Linux ARM64 effect bundles');
  docker([
    'cargo',
    'build',
    '--release',
    '--locked',
    '--lib',
    ...effects.flatMap((effect) => ['-p', `oxidal-${effect}`]),
    '--target-dir',
    '/target/lv2',
  ]);
  const stage = join(work, 'lv2');
  rmSync(stage, { recursive: true, force: true });
  for (const effect of effects) {
    const bundle = join(stage, `oxidal-${effect}.lv2`);
    const crate = join(root, `crates/oxidal-${effect}`);
    mkdirSync(bundle, { recursive: true });
    copyFileSync(
      join(work, `target/lv2/release/liboxidal_${effect}.so`),
      join(bundle, `oxidal_${effect}.so`),
    );
    for (const file of ['manifest.ttl', `${effect}.ttl`])
      copyFileSync(join(crate, 'lv2', file), join(bundle, file));
    copyFileSync(join(crate, 'NOTICE'), join(bundle, 'NOTICE'));
  }
  pack(stage, join(work, 'oxidal-lv2.tgz'));
  install('lv2', join(work, 'oxidal-lv2.tgz'));
}

if (wanted.has('ui')) {
  step('Building the web UI');
  run('pnpm', ['--dir', 'apps/web', 'build']);
  pack(join(root, 'apps/web/dist'), join(work, 'oxidal-ui.tgz'));
  install('ui', join(work, 'oxidal-ui.tgz'));
}

if (buildOnly) process.exit(0);
step('Checking the running service');
if (wanted.has('lv2'))
  ssh(
    'curl -fsS --max-time 20 "http://127.0.0.1:3210/api/v1/plugins/lv2?sample_rate=48000"' +
      ` | grep -q "urn:oxidal:plugin:${effects.at(-1)}#stereo" && echo "Effects: the newest bundle is loaded."`,
  );
ssh(
  'for path in audio/devices media/split-options; do' +
    ' printf "%s: " "$path"; curl -fsS --max-time 10 "http://127.0.0.1:3210/api/v1/$path" | head -c 300; echo;' +
    ' done',
);
console.log(
  '\nDone. Audio devices should show backend_available true; split options list the installed modes.',
);
