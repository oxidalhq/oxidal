import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { root } from './process.mjs';

const read = (path) => readFileSync(join(root, path), 'utf8');
const requirePolicy = (value, message) => {
  if (!value) throw new Error(message);
};
const node = read('.node-version').trim();
requirePolicy(process.versions.node === node, `Use pinned Node ${node}`);
requirePolicy(
  JSON.parse(read('package.json')).packageManager === 'pnpm@10.32.1',
  'pnpm pin drift',
);
requirePolicy(
  read('rust-toolchain.toml').includes('channel = "1.95.0"'),
  'Rust pin drift: update tooling and CI together',
);
for (const file of readdirSync(join(root, '.github/workflows'))) {
  const workflow = parse(read(`.github/workflows/${file}`));
  requirePolicy(
    !workflow.on?.pull_request_target,
    'Do not execute untrusted code with privileged PR workflows',
  );
  for (const [name, job] of Object.entries(workflow.jobs)) {
    requirePolicy(
      job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30,
      `${file}/${name}: bounded timeout required`,
    );
    for (const step of job.steps ?? []) {
      if (step.uses)
        requirePolicy(
          /@[a-f0-9]{40}$/.test(step.uses),
          `${file}: immutable action pin required`,
        );
    }
  }
}
console.log('Toolchain and CI policy checks passed.');
