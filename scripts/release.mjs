import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { root } from './process.mjs';

/** Local preview of the documented pre-1.0 Conventional Commit version policy.
 * @see docs/architecture.md
 */
export function nextVersion(version, messages) {
  let level = 0;
  for (const message of messages) {
    if (/^[a-z]+(?:\([^)]*\))?!:/.test(message))
      level = Math.max(level, version.startsWith('0.') ? 2 : 3);
    else if (/^feat(?:\([^)]*\))?:/.test(message)) level = Math.max(level, 2);
    else if (/^(fix|perf)(?:\([^)]*\))?:/.test(message))
      level = Math.max(level, 1);
  }
  const [major, minor, patch] = version.split('.').map(Number);
  if (level === 3) return `${major + 1}.0.0`;
  if (level === 2) return `${major}.${minor + 1}.0`;
  if (level === 1) return `${major}.${minor}.${patch + 1}`;
  return version;
}

/** Ensure release-unit versions match the committed manifest before tagging.
 * @see docs/architecture.md
 */
export function checkVersions() {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const versions = JSON.parse(read('.release-please-manifest.json'));
  const core = /^version = "([^"]+)"$/m.exec(read('Cargo.toml'))?.[1];
  const ui = JSON.parse(read('apps/web/package.json')).version;
  const os = read('os/VERSION').trim();
  if (
    versions['.'] !== core ||
    versions['apps/web'] !== ui ||
    versions['os'] !== os ||
    JSON.parse(read('os/manifests/base.json')).version !== os
  )
    throw new Error('Release version drift');
  for (const match of read('Cargo.toml').matchAll(
    /oxidal-(?:graph|control) = \{[^\n]*version = "([^"]+)"/g,
  ))
    if (match[1] !== core)
      throw new Error('Internal Cargo dependency version drift');
  for (const entry of read('Cargo.lock').split('[[package]]')) {
    if (/name = "oxidal-/.test(entry)) {
      const version = /version = "([^"]+)"/.exec(entry)?.[1];
      if (version !== core) throw new Error('Cargo lockfile version drift');
    }
  }
  return versions;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv.includes('--dry-run'))
    throw new Error('Only local --dry-run is enabled.');
  const versions = checkVersions();
  const changes = spawnSync(
    'git',
    ['status', '--short', '--ignore-submodules'],
    { cwd: root, encoding: 'utf8' },
  );
  console.log(
    JSON.stringify(
      {
        mode: 'local-dry-run',
        versions,
        working_tree: changes.stdout.trim() ? 'uncommitted changes' : 'clean',
        release_prs: Object.keys(versions),
        publication: 'disabled',
        tagging: 'manual after review/qualification',
        note: 'Version PRs use release-please; this local check does not exercise GitHub APIs.',
      },
      null,
      2,
    ),
  );
}
