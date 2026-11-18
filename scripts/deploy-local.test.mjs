import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/** Build-only must never install a privileged helper on the device.
 * @see docs/development.md
 */
test('helper build-only prepares reviewable files without contacting the Pi', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oxidal-helper-build-only-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'os/scripts'), { recursive: true });
    mkdirSync(join(directory, 'bin'));
    for (const name of ['deploy-local.mjs', 'process.mjs'])
      copyFileSync(
        new URL(name, import.meta.url),
        join(directory, 'scripts', name),
      );
    const helper = new URL(
      '../os/scripts/development_deploy.py',
      import.meta.url,
    );
    copyFileSync(helper, join(directory, 'os/scripts/development_deploy.py'));
    const contacted = join(directory, 'contacted');
    for (const name of ['ssh', 'scp'])
      writeFileSync(
        join(directory, 'bin', name),
        '#!/bin/sh\ntouch "$OXIDAL_HELPER_CONTACT_MARKER"\nexit 81\n',
        { mode: 0o755 },
      );
    const result = spawnSync(
      process.execPath,
      [join(directory, 'scripts/deploy-local.mjs'), 'helper', '--build-only'],
      {
        env: {
          ...process.env,
          PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          OXIDAL_HELPER_CONTACT_MARKER: contacted,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      existsSync(contacted),
      false,
      'No SSH or copy is permitted in helper build-only',
    );
    assert.match(result.stdout, /Prepared /);
    assert.deepEqual(
      readFileSync(
        join(directory, '.local/deploy-local/development_deploy.py'),
      ),
      readFileSync(helper),
    );
    const sudoers = readFileSync(
      join(directory, '.local/deploy-local/oxidal-development-deploy.sudoers'),
      'utf8',
    );
    assert.match(sudoers, /NOPASSWD:/);
    assert.doesNotMatch(sudoers, /device-service|admin \*/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
