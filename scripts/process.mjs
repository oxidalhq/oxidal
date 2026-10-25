import { spawnSync } from 'node:child_process';
import { dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
/** Use the pinned compiler even when Homebrew Rust precedes rustup on PATH.
 * @see docs/architecture.md
 */
export function rustEnv() {
  const compiler = spawnSync(
    'rustup',
    ['which', '--toolchain', '1.95.0', 'rustc'],
    { encoding: 'utf8' },
  );
  if (compiler.status !== 0)
    throw new Error('Install Rust 1.95.0 with rustup first.');
  const bin = dirname(compiler.stdout.trim());
  return {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    RUSTC: compiler.stdout.trim(),
    RUSTDOC: `${bin}/rustdoc`,
  };
}
/** Run a reproducible local/CI command and preserve failures.
 * @see docs/architecture.md
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})`);
}
