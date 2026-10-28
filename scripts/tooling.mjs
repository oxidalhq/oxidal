import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { root, run, rustEnv } from './process.mjs';

const cargo = (...args) =>
  run('rustup', ['run', '1.95.0', 'cargo', ...args], { env: rustEnv() });
const workspace = ['--manifest-path', 'Cargo.toml'];
// Portable builds keep ALSA optional; native Linux checks and previews exercise the real backend.
const audioFeatures =
  process.platform === 'linux' ? ['--features', 'oxidal-api/alsa'] : [];
const nativeLibrary =
  process.env.OXIDAL_TONE3000_LIB_DIR ??
  join(
    root,
    '.local/tone3000',
    process.platform === 'linux' ? 'build-linux' : 'build',
  );
const targetDir = resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
const mode = process.argv[2];
if (mode === 'bootstrap') {
  cargo('fetch', '--locked', ...workspace);
  cargo(
    'install',
    '--locked',
    '--root',
    '.tools',
    'cargo-deny',
    '--version',
    '0.20.2',
  );
  cargo(
    'install',
    '--locked',
    '--root',
    '.tools',
    'cargo-machete',
    '--version',
    '0.9.2',
  );
  run('pnpm', ['exec', 'playwright', 'install', 'chromium', 'webkit'], {
    cwd: join(root, 'apps/web'),
  });
} else if (mode === 'lv2-check') {
  if (process.platform !== 'linux')
    throw new Error(
      'LV2 qualification requires Linux with liblilv-dev, lv2-dev and swh-lv2.',
    );
  const env = {
    ...rustEnv(),
    OXIDAL_LV2_EXTERNAL_DIR:
      process.env.OXIDAL_LV2_EXTERNAL_DIR ?? '/usr/lib/lv2',
  };
  run(
    'cargo',
    [
      'clippy',
      '--locked',
      '-p',
      'oxidal-lv2',
      '--features',
      'qualification',
      '--all-targets',
      '--',
      '-D',
      'warnings',
    ],
    { env },
  );
  run(
    'cargo',
    ['test', '--locked', '-p', 'oxidal-lv2', '--features', 'qualification'],
    { env },
  );
  const resourceKeys = [
    'OXIDAL_LV2_STATE_BUNDLE',
    'OXIDAL_LV2_STATE_URI',
    'OXIDAL_LV2_STATE_MODEL',
    'OXIDAL_LV2_STATE_KEY',
  ];
  if (resourceKeys.some((key) => process.env[key])) {
    if (!resourceKeys.every((key) => process.env[key]))
      throw new Error(
        'Resource-plugin qualification needs bundle, URI, model and state key.',
      );
    run(
      'cargo',
      [
        'test',
        '--locked',
        '-p',
        'oxidal-lv2',
        '--features',
        'qualification',
        '--test',
        'native',
        'external_resource_plugin_state_restores_after_asset_relocation',
        '--',
        '--ignored',
        '--nocapture',
      ],
      { env },
    );
  }
  run(
    'cargo',
    [
      'build',
      '--locked',
      '-p',
      'oxidal-lv2',
      '--features',
      'qualification',
      '--bin',
      'oxidal-graph-worker',
    ],
    { env },
  );
  run(
    'cargo',
    [
      'test',
      '--locked',
      '-p',
      'oxidal-api',
      '--features',
      'alsa',
      '--test',
      'graph_playback',
      '--',
      '--ignored',
      '--test-threads=1',
    ],
    {
      env: {
        ...env,
        OXIDAL_GRAPH_QUALIFY_NULL: '1',
        OXIDAL_TEST_GRAPH_WORKER: join(targetDir, 'debug/oxidal-graph-worker'),
        LV2_PATH: env.OXIDAL_LV2_EXTERNAL_DIR,
      },
    },
  );
  run('pnpm', ['test:e2e', '--grep', 'graph authoring'], {
    cwd: join(root, 'apps/web'),
    env: {
      ...env,
      OXIDAL_GRAPH_QUALIFY_NULL: '1',
      OXIDAL_EXPERIMENTAL_GRAPH: '1',
      LV2_PATH: env.OXIDAL_LV2_EXTERNAL_DIR,
    },
  });
} else if (mode === 'native-check') {
  run('python3', ['native/tone3000/build.py']);
  const env = {
    ...rustEnv(),
    OXIDAL_TONE3000_LIB_DIR: nativeLibrary,
    OXIDAL_TONE3000_FACTORY_DIR: join(
      root,
      '.local/tone3000/source/resources/factory-presets',
    ),
    OXIDAL_TONE3000_TEST_MODEL: join(
      root,
      '.local/tone3000/source/test/files/a2-amp-test.nam',
    ),
    OXIDAL_QUALIFICATION_DATA: mkdtempSync(join(tmpdir(), 'oxidal-native-')),
  };
  run(
    'cargo',
    [
      'clippy',
      '--locked',
      '--workspace',
      '--features',
      process.platform === 'linux'
        ? 'oxidal-tone3000/audio-qualification,oxidal-api/alsa,oxidal-engine/qualification'
        : 'oxidal-tone3000/native',
      '--all-targets',
      '--',
      '-D',
      'warnings',
    ],
    { env },
  );
  run(
    'cargo',
    [
      'run',
      '--locked',
      '-p',
      'oxidal-tone3000',
      '--features',
      'native',
      '--example',
      'qualify',
    ],
    { env },
  );
  if (process.platform === 'linux') {
    run(
      'cargo',
      [
        'build',
        '--locked',
        '-p',
        'oxidal-engine',
        '--features',
        'qualification',
        '--bin',
        'oxidal-rig-worker',
      ],
      { env },
    );
    env.OXIDAL_TEST_RIG_WORKER = join(targetDir, 'debug/oxidal-rig-worker');
    run(
      'cargo',
      [
        'test',
        '--locked',
        '-p',
        'oxidal-engine',
        '--features',
        'qualification',
      ],
      { env },
    );
    // Reuse the authored embedded fixture and isolated data root from the native
    // qualifier; no downloaded test scripts or extra provider credentials.
    run(
      'cargo',
      [
        'run',
        '--locked',
        '-p',
        'oxidal-engine',
        '--features',
        'native',
        '--example',
        'qualify_mixed',
      ],
      { env },
    );
    const audioEnv = {
      ...env,
      OXIDAL_AUDIO_QUALIFY_NULL: '1',
      OXIDAL_TEST_AUDIO_WORKER: join(targetDir, 'debug/oxidal-audio-worker'),
      OXIDAL_TEST_NATIVE_WORKER: join(targetDir, 'debug/oxidal-native-worker'),
      OXIDAL_NATIVE_TEST_MODELS: join(
        env.OXIDAL_QUALIFICATION_DATA,
        'audition-models',
      ),
      OXIDAL_NATIVE_TEST_PRESET: join(
        env.OXIDAL_QUALIFICATION_DATA,
        'a2-preset.t3kpreset',
      ),
    };
    run(
      'cargo',
      [
        'build',
        '--locked',
        '-p',
        'oxidal-tone3000',
        '--features',
        'audio-qualification',
        '--bins',
      ],
      { env: audioEnv },
    );
    run(
      'cargo',
      [
        'test',
        '--locked',
        '-p',
        'oxidal-api',
        '--features',
        'alsa',
        '--test',
        'rig_playback',
        '--',
        '--ignored',
      ],
      {
        env: {
          ...audioEnv,
          OXIDAL_RIG_QUALIFY_NULL: '1',
          OXIDAL_TEST_RIG_WORKER: env.OXIDAL_TEST_RIG_WORKER,
          OXIDAL_TEST_BUNDLE_ROOT: join(
            env.OXIDAL_QUALIFICATION_DATA,
            'worker-rigs',
          ),
          OXIDAL_TEST_RIG_REVISION_FILE: join(
            env.OXIDAL_QUALIFICATION_DATA,
            'mixed-preset-revision',
          ),
        },
      },
    );
    run(
      'cargo',
      [
        'test',
        '--locked',
        '-p',
        'oxidal-api',
        '--features',
        'alsa',
        '--test',
        'playback',
        '--',
        '--ignored',
      ],
      { env: audioEnv },
    );
  }
  run('pnpm', ['test:e2e', '--grep', 'native editor|playback lifecycle'], {
    env: {
      ...env,
      OXIDAL_NATIVE_EDITOR: '1',
      ...(process.platform === 'linux'
        ? { OXIDAL_EXPERIMENTAL_AUDIO: '1', OXIDAL_AUDIO_QUALIFY_NULL: '1' }
        : {}),
      OXIDAL_NATIVE_TEST_MODELS: join(
        env.OXIDAL_QUALIFICATION_DATA,
        'audition-models',
      ),
      OXIDAL_NATIVE_TEST_PRESET: join(
        env.OXIDAL_QUALIFICATION_DATA,
        'a2-preset.t3kpreset',
      ),
    },
  });
  if (process.platform === 'linux') {
    run('pnpm', ['test:e2e', '--grep', 'mixed rig authoring'], {
      env: {
        ...env,
        OXIDAL_EXPERIMENTAL_RIG: '1',
        OXIDAL_EXPERIMENTAL_GRAPH: '1',
        OXIDAL_GRAPH_QUALIFY_NULL: '1',
        OXIDAL_RIG_QUALIFY_NULL: '1',
        OXIDAL_MIXED_TEST_ROOT: env.OXIDAL_QUALIFICATION_DATA,
        OXIDAL_NATIVE_TEST_MODELS: join(
          env.OXIDAL_QUALIFICATION_DATA,
          'audition-models',
        ),
      },
    });
  }
} else if (mode === 'check' || mode === 'core-check') {
  run('python3', ['scripts/check_repository.py']);
  cargo('fmt', ...workspace, '--all', '--check');
  cargo(
    'clippy',
    '--locked',
    ...workspace,
    '--workspace',
    ...audioFeatures,
    '--all-targets',
    '--',
    '-D',
    'warnings',
  );
  cargo('test', '--locked', ...workspace, '--workspace', ...audioFeatures);
  if (mode === 'check') {
    run('python3', [
      '-m',
      'unittest',
      'discover',
      '-s',
      'scripts',
      '-p',
      'test_*.py',
    ]);
    run('node', ['scripts/config-check.mjs']);
    run('pnpm', ['presets:check']);
    run('pnpm', ['format:check']);
    run('pnpm', ['lint:tooling']);
    run('pnpm', ['contract:check']);
    run('pnpm', ['--dir', 'apps/web', 'check']);
    run('sh', ['os/scripts/check.sh']);
    run('node', [
      '--test',
      'scripts/markdown.test.mjs',
      'scripts/commits.test.mjs',
      'scripts/release.test.mjs',
    ]);
    run('node', ['scripts/dependencies.mjs']);
    run('pnpm', ['test:e2e']);
    if (
      ['darwin', 'linux'].includes(process.platform) &&
      existsSync(join(root, '.local/tone3000/source'))
    ) {
      run('node', ['scripts/tooling.mjs', 'native-check']);
    } else {
      console.log(
        'Native TONE3000 qualification not run: use pnpm native:check on a supported macOS/Linux build host. Live audio remains pending.',
      );
    }
  }
} else if (mode === 'dev' || mode === 'preview' || mode === 'e2e-server') {
  cargo(
    'build',
    '--locked',
    ...workspace,
    '--bin',
    'oxidald',
    ...audioFeatures,
  );
  if (process.env.OXIDAL_NATIVE_EDITOR === '1') {
    run(
      'cargo',
      [
        'build',
        '--locked',
        '-p',
        'oxidal-tone3000',
        '--features',
        'native',
        '--bin',
        'oxidal-native-worker',
      ],
      {
        env: {
          ...rustEnv(),
          OXIDAL_TONE3000_LIB_DIR: nativeLibrary,
        },
      },
    );
  }
  if (process.env.OXIDAL_EXPERIMENTAL_AUDIO === '1') {
    if (process.platform !== 'linux')
      throw new Error('Experimental playback requires Linux ALSA.');
    const qualify = process.env.OXIDAL_AUDIO_QUALIFY_NULL === '1';
    if (qualify && mode !== 'e2e-server')
      throw new Error('Null fixture is only enabled by the E2E server.');
    run(
      'cargo',
      [
        'build',
        '--locked',
        '-p',
        'oxidal-tone3000',
        '--features',
        qualify ? 'audio-qualification' : 'audio-worker',
        '--bin',
        'oxidal-audio-worker',
      ],
      {
        env: { ...rustEnv(), OXIDAL_TONE3000_LIB_DIR: nativeLibrary },
      },
    );
  }
  if (process.env.OXIDAL_EXPERIMENTAL_GRAPH === '1') {
    if (process.platform !== 'linux')
      throw new Error('Graph playback requires Linux ALSA.');
    const qualify = process.env.OXIDAL_GRAPH_QUALIFY_NULL === '1';
    if (qualify && mode !== 'e2e-server')
      throw new Error('Null fixture is only enabled by the E2E server.');
    run(
      'cargo',
      [
        'build',
        '--locked',
        '-p',
        'oxidal-lv2',
        '--features',
        qualify ? 'qualification' : 'worker',
        '--bin',
        'oxidal-graph-worker',
      ],
      { env: rustEnv() },
    );
  }
  if (process.env.OXIDAL_EXPERIMENTAL_RIG === '1') {
    if (process.platform !== 'linux')
      throw new Error('Mixed playback requires Linux ALSA.');
    const qualify = process.env.OXIDAL_RIG_QUALIFY_NULL === '1';
    if (qualify && mode !== 'e2e-server')
      throw new Error('Null fixture is only enabled by the E2E server.');
    run(
      'cargo',
      [
        'build',
        '--locked',
        '-p',
        'oxidal-engine',
        '--features',
        qualify ? 'qualification' : 'worker',
        '--bin',
        'oxidal-rig-worker',
      ],
      { env: { ...rustEnv(), OXIDAL_TONE3000_LIB_DIR: nativeLibrary } },
    );
  }
  const mappingPath =
    mode === 'e2e-server'
      ? join(mkdtempSync(join(tmpdir(), 'oxidal-e2e-')), 'mappings.json')
      : join(root, '.local/mappings.json');
  if (
    mode === 'e2e-server' &&
    (process.env.OXIDAL_AUDIO_QUALIFY_NULL === '1' ||
      process.env.OXIDAL_RIG_QUALIFY_NULL === '1') &&
    process.env.OXIDAL_NATIVE_TEST_MODELS
  ) {
    cpSync(
      process.env.OXIDAL_NATIVE_TEST_MODELS,
      join(dirname(mappingPath), 'presets/audition-models'),
      { recursive: true },
    );
  }
  const env = {
    ...process.env,
    OXIDAL_SIMULATOR: '1',
    ...(process.env.OXIDAL_EXPERIMENTAL_RIG === '1'
      ? { OXIDAL_RIG_WORKER: join(targetDir, 'debug/oxidal-rig-worker') }
      : {}),
    ...(process.env.OXIDAL_EXPERIMENTAL_GRAPH === '1'
      ? { OXIDAL_GRAPH_WORKER: join(targetDir, 'debug/oxidal-graph-worker') }
      : {}),
    ...(process.env.OXIDAL_EXPERIMENTAL_AUDIO === '1'
      ? { OXIDAL_AUDIO_WORKER: join(targetDir, 'debug/oxidal-audio-worker') }
      : {}),
    ...(process.env.OXIDAL_NATIVE_EDITOR === '1'
      ? {
          OXIDAL_NATIVE_WORKER: join(targetDir, 'debug/oxidal-native-worker'),
          OXIDAL_QUALIFICATION_DATA: mkdtempSync(
            join(tmpdir(), 'oxidal-editor-'),
          ),
        }
      : {}),
    OXIDAL_MAPPING_PATH: mappingPath,
    OXIDAL_PRESET_DIR: join(dirname(mappingPath), 'presets'),
    OXIDAL_UI_DIR: join(root, 'apps/web/dist'),
  };
  const children = [
    spawn(join(targetDir, 'debug/oxidald'), [], {
      cwd: root,
      stdio: 'inherit',
      env,
    }),
  ];
  if (mode === 'dev')
    children.push(
      spawn('pnpm', ['--dir', 'apps/web', 'dev'], {
        cwd: root,
        stdio: 'inherit',
        detached: true,
      }),
    );
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (child.spawnargs[0] === 'pnpm' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          /* Already stopped. */
        }
      } else child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(code), 1000).unref();
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  for (const child of children) {
    child.on('error', (error) => {
      console.error(error);
      stop(1);
    });
    child.on('exit', (code) => stop(code ?? 1));
  }
} else {
  throw new Error(`Unknown tooling operation: ${mode}`);
}
