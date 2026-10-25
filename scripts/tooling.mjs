import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, run, rustEnv } from './process.mjs';

const cargo = (...args) =>
  run('rustup', ['run', '1.95.0', 'cargo', ...args], { env: rustEnv() });
const workspace = ['--manifest-path', 'Cargo.toml'];
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
  run('pnpm', ['exec', 'playwright', 'install', 'chromium'], {
    cwd: join(root, 'apps/web'),
  });
} else if (mode === 'check' || mode === 'core-check') {
  run('python3', ['scripts/check_repository.py']);
  cargo('fmt', ...workspace, '--all', '--check');
  cargo(
    'clippy',
    '--locked',
    ...workspace,
    '--workspace',
    '--all-targets',
    '--',
    '-D',
    'warnings',
  );
  cargo('test', '--locked', ...workspace, '--workspace');
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
  }
} else if (mode === 'dev' || mode === 'preview' || mode === 'e2e-server') {
  cargo('build', '--locked', ...workspace, '--bin', 'oxidald');
  const mappingPath =
    mode === 'e2e-server'
      ? join(mkdtempSync(join(tmpdir(), 'oxidal-e2e-')), 'mappings.json')
      : join(root, '.local/mappings.json');
  const env = {
    ...process.env,
    OXIDAL_SIMULATOR: '1',
    OXIDAL_MAPPING_PATH: mappingPath,
    OXIDAL_UI_DIR: join(root, 'apps/web/dist'),
  };
  const children = [
    spawn(join(root, 'target/debug/oxidald'), [], {
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
