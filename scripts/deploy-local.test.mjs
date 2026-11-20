import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

test('binary build-only packages its rebuilt adapter with every worker without contacting a device', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oxidal-binary-build-only-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'bin'));
    for (const name of ['deploy-local.mjs', 'process.mjs'])
      copyFileSync(
        new URL(name, import.meta.url),
        join(directory, 'scripts', name),
      );
    const calls = join(directory, 'docker-calls');
    writeFileSync(
      join(directory, 'bin/docker'),
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.OXIDAL_TEST_DOCKER_CALLS, JSON.stringify(args) + '\\n');
if (args.includes('native/tone3000/build.py')) {
  const output = path.join(process.cwd(), '.local/deploy-local/tone3000');
  fs.mkdirSync(output, {recursive:true});
  fs.writeFileSync(path.join(output, 'liboxidal_tone3000.so'), 'new checked adapter');
}
if (args.includes('--workspace')) {
  const output = path.join(process.cwd(), '.local/deploy-local/target/bins/release');
  fs.mkdirSync(output, {recursive:true});
  for (const name of ['oxidald', 'oxidal-audio-worker', 'oxidal-graph-worker', 'oxidal-rig-worker', 'oxidal-native-worker']) fs.writeFileSync(path.join(output, name), name);
}
`,
      { mode: 0o755 },
    );
    for (const name of ['ssh', 'scp'])
      writeFileSync(join(directory, 'bin', name), '#!/bin/sh\nexit 81\n', {
        mode: 0o755,
      });
    const result = spawnSync(
      process.execPath,
      [join(directory, 'scripts/deploy-local.mjs'), 'bins', '--build-only'],
      {
        env: {
          ...process.env,
          PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
          OXIDAL_TEST_DOCKER_CALLS: calls,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(calls, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const prepare = commands.findIndex((args) =>
      args.includes('native/tone3000/build.py'),
    );
    const workers = commands.findIndex((args) => args.includes('--workspace'));
    assert.ok(
      prepare >= 0 && workers > prepare,
      'Build the adapter before linking its workers',
    );
    assert.ok(
      commands[workers].includes(
        'OXIDAL_TONE3000_LIB_DIR=/src/.local/deploy-local/tone3000',
      ),
    );
    const archive = join(directory, '.local/deploy-local/oxidal-bins.tgz');
    const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(
      listed.stdout
        .trim()
        .split('\n')
        .filter((name) => !name.endsWith('/'))
        .sort(),
      [
        './liboxidal_tone3000.so',
        './oxidal-audio-worker',
        './oxidal-graph-worker',
        './oxidal-native-worker',
        './oxidal-rig-worker',
        './oxidald',
      ],
    );
    assert.equal(
      readFileSync(
        join(directory, '.local/deploy-local/bins/liboxidal_tone3000.so'),
        'utf8',
      ),
      'new checked adapter',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Build-only must never install a privileged helper on the device.
 * @see docs/development.md
 */
for (const [part, invalid, install = false, badStage = false] of [
  ['helper', false],
  ['device-service', false],
  ['device-service', true],
  ['device-service', false, true],
  ['device-service', false, true, true],
])
  test(`${part} ${install ? 'requests explicit administration' : 'build-only'} ${invalid ? 'rejects a wrong architecture' : badStage ? 'rejects unsafe staging' : 'prepares reviewable files'}`, () => {
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
      const dockerCalled = join(directory, 'docker-called');
      writeFileSync(
        join(directory, 'bin/docker'),
        '#!/bin/sh\ntouch "$OXIDAL_HELPER_DOCKER_MARKER"\nexit 0\n',
        { mode: 0o755 },
      );
      if (part === 'device-service') {
        const release = join(
          directory,
          '.local/deploy-local/target/bins/release',
        );
        mkdirSync(release, { recursive: true });
        const executable = Buffer.alloc(64);
        executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
        executable.writeUInt16LE(3, 16);
        executable.writeUInt16LE(invalid ? 62 : 183, 18);
        writeFileSync(join(release, 'oxidal-device-service'), executable);
      }
      for (const name of ['ssh', 'scp'])
        writeFileSync(
          join(directory, 'bin', name),
          '#!/usr/bin/env node\nconst fs = require("node:fs"); fs.appendFileSync(process.env.OXIDAL_HELPER_CONTACT_MARKER, JSON.stringify({tool: process.argv[1], args: process.argv.slice(2)}) + "\\n"); if (process.argv.some((arg) => arg.includes("mktemp -d"))) process.stdout.write(process.env.OXIDAL_HELPER_FAKE_STAGE + "\\n"); process.exit(process.env.OXIDAL_HELPER_ALLOW_FAKE_CONTACT === "1" ? 0 : 81);\n',
          { mode: 0o755 },
        );
      const result = spawnSync(
        process.execPath,
        [
          join(directory, 'scripts/deploy-local.mjs'),
          part,
          ...(install ? [] : ['--build-only']),
        ],
        {
          env: {
            ...process.env,
            PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
            OXIDAL_HELPER_CONTACT_MARKER: contacted,
            OXIDAL_HELPER_DOCKER_MARKER: dockerCalled,
            OXIDAL_HELPER_ALLOW_FAKE_CONTACT: install ? '1' : '0',
            OXIDAL_HELPER_FAKE_STAGE: badStage
              ? '/etc'
              : '/tmp/oxidal-deploy.fixture123',
          },
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, invalid || badStage ? 1 : 0, result.stderr);
      assert.equal(
        existsSync(contacted),
        install,
        'Only the explicit administrator case can contact the fake device',
      );
      assert.equal(existsSync(dockerCalled), part === 'device-service');
      if (badStage) {
        assert.match(result.stderr, /private administrative staging/);
        const calls = readFileSync(contacted, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.equal(
          calls.length,
          1,
          'Unsafe staging must stop before copy or sudo',
        );
        return;
      }
      if (invalid) {
        assert.match(result.stderr, /Expected a bounded Linux ARM64/);
        return;
      }
      if (part === 'device-service') {
        const archive = join(
          directory,
          '.local/deploy-local/oxidal-device-service.tgz',
        );
        const digest = createHash('sha256')
          .update(readFileSync(archive))
          .digest('hex');
        if (!install) assert.ok(result.stdout.includes(digest));
        const listed = spawnSync('tar', ['-tzf', archive], {
          encoding: 'utf8',
        });
        assert.equal(listed.status, 0, listed.stderr);
        assert.deepEqual(
          listed.stdout
            .trim()
            .split('\n')
            .filter((name) => !name.endsWith('/')),
          ['./oxidal-device-service'],
        );
      }
      if (install) {
        const calls = readFileSync(contacted, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const administration = calls.find((call) => call.args.includes('-t'));
        assert.ok(
          administration,
          'The administrator command needs an interactive session',
        );
        const command = administration.args.at(-1);
        assert.ok(
          command.includes(
            'sudo /usr/local/sbin/oxidal-development-deploy device-service ',
          ),
        );
        assert.match(command, /device-service [a-f0-9]{64}/);
        assert.ok(
          command.includes(
            'install -d -m 0700 -o root -g root /run/oxidal-deploy',
          ),
        );
        assert.ok(
          command.includes(
            'install -m 0600 -o root -g root /tmp/oxidal-deploy.fixture123/oxidal-device-service.tgz /run/oxidal-deploy/oxidal-device-service.tgz',
          ),
        );
        assert.ok(
          calls.some(
            (call) =>
              call.args.at(-1) === '/tmp/oxidal-deploy.fixture123/' ||
              call.args.at(-1).endsWith(':/tmp/oxidal-deploy.fixture123/'),
          ),
        );
        assert.doesNotMatch(command, /sudo -n[^&]*device-service/);
      } else {
        assert.match(result.stdout, /Prepared /);
      }

      assert.deepEqual(
        readFileSync(
          join(directory, '.local/deploy-local/development_deploy.py'),
        ),
        readFileSync(helper),
      );
      const sudoers = readFileSync(
        join(
          directory,
          '.local/deploy-local/oxidal-development-deploy.sudoers',
        ),
        'utf8',
      );
      assert.match(sudoers, /NOPASSWD:/);
      assert.doesNotMatch(sudoers, /device-service|admin \*/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
