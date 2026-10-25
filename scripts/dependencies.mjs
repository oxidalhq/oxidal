import { join, delimiter } from 'node:path';
import { root, run, rustEnv } from './process.mjs';

const env = rustEnv();
env.PATH = `${join(root, '.tools/bin')}${delimiter}${env.PATH}`;
run('cargo-deny', ['--manifest-path', 'Cargo.toml', 'check'], { env });
run('cargo-machete', ['.'], { env });
run('pnpm', ['audit', '--audit-level', 'high']);
