import { setDisplayMode } from './display';
import { test, expect } from '@playwright/test';
import type { DebugState, DebugCommand } from '../src/api';
test('debug requires enablement, executes once, cancels and keeps commands out of storage', async ({
  page,
}) => {
  const state: DebugState = {
    available: true,
    enabled: false,
    remaining_seconds: 0,
    identity: 'oxidal-debug (uid 999)',
    directory: '/run/oxidal-debug',
    job: null,
    message: '',
  };
  const commands: DebugCommand[] = [];
  await page.route('**/api/v1/debug', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON() as DebugCommand;
      commands.push(command);
      if (command.type === 'enable') {
        state.enabled = true;
        state.remaining_seconds = 299;
      }
      if (command.type === 'disable') {
        state.enabled = false;
        state.remaining_seconds = 0;
      }
      if (command.type === 'run') {
        state.job = {
          id: 'a'.repeat(32),
          phase: 'running',
          output: '<script>sample output</script>',
          exit_code: null,
          elapsed_ms: 20,
        };
      }
      if (command.type === 'cancel' && state.job) state.job.phase = 'cancelled';
    }
    await route.fulfill({ json: state });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Maintenance', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Debug console' });
  await panel.getByText('Debug console', { exact: true }).click();
  await expect(panel.getByLabel('Command', { exact: true })).toBeDisabled();
  await panel
    .getByRole('button', { name: 'Enable debug mode for 5 minutes' })
    .click();
  await panel
    .getByLabel('Command', { exact: true })
    .fill('printf private-test');
  await panel.getByRole('button', { name: 'Run command', exact: true }).click();
  await expect(panel.getByLabel('Command', { exact: true })).toHaveValue('');
  await expect(panel.getByLabel('Command output')).toHaveText(
    '<script>sample output</script>',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Maintenance', exact: true })
    .click();
  await panel.getByText('Debug console', { exact: true }).click();
  await panel
    .getByRole('button', { name: 'Cancel command', exact: true })
    .click();
  await expect(panel.getByText(/cancelled/)).toBeVisible();
  expect(commands.filter((c) => c.type === 'run')).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'private-test',
  );
  await panel.getByRole('button', { name: 'Disable debug mode' }).click();
  await expect(panel.getByLabel('Command', { exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('interactive terminal reconnects without replaying input and stays usable after rotation', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const commands: import('../src/api').TerminalCommand[] = [];
  let session: import('../src/api').TerminalState['session'] = null;
  let loseInputReply = false;
  let output = new TextEncoder().encode('oxidal:/tmp$ ');
  await page.route('**/api/v1/terminal/unprivileged', async (route) => {
    const command = route
      .request()
      .postDataJSON() as import('../src/api').TerminalCommand;
    commands.push(command);
    if (command.type === 'start')
      session = {
        id: command.id,
        running: true,
        exit_code: null,
        next_input: 0,
        start: 0,
        cursor: 0,
        dropped: false,
        bytes: [],
      };
    if (command.type === 'input' && session) {
      expect(command.sequence).toBe(session.next_input);
      session.next_input += 1;
      output = new Uint8Array([...output, ...command.bytes]);
      if (loseInputReply) {
        loseInputReply = false;
        await route.abort();
        return;
      }
    }
    if (command.type === 'end') session = null;
    const cursor = command.type === 'read' ? command.cursor : 0;
    await route.fulfill({
      json: {
        available: true,
        identity: 'oxidal-debug',
        directory: '/run/oxidal-terminal',
        session: session
          ? {
              ...session,
              start: cursor,
              cursor: output.length,
              bytes: Array.from(output.slice(cursor)),
            }
          : null,
      },
    });
  });
  async function open() {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .getByRole('tablist', { name: 'Settings sections' })
      .getByRole('tab', { name: 'Maintenance', exact: true })
      .click();
    await page.getByText('Interactive terminal', { exact: true }).click();
  }
  await page.goto('/');
  if (testInfo.project.name === 'boox-air3c')
    await setDisplayMode(page, 'epaper');
  await open();
  const panel = page.getByRole('region', { name: 'Web terminal' });
  await panel
    .getByRole('button', { name: 'Start terminal', exact: true })
    .click();
  await expect(panel.getByRole('status')).toContainText('running');
  const input = panel.locator('.xterm-helper-textarea');
  await input.focus();
  await page.keyboard.type('echo private-terminal-test');
  await expect
    .poll(
      () =>
        commands
          .filter((c) => c.type === 'input')
          .flatMap((c) => (c.type === 'input' ? c.bytes : [])).length,
    )
    .toBe(26);
  await panel.getByRole('button', { name: 'Ctrl-C', exact: true }).click();
  await expect
    .poll(() => commands.some((c) => c.type === 'input' && c.bytes.includes(3)))
    .toBe(true);
  const count = commands.filter((c) => c.type === 'input').length;
  await page.reload();
  await open();
  await expect(panel.getByRole('status')).toContainText('running');
  expect(commands.filter((c) => c.type === 'start')).toHaveLength(1);
  expect(commands.filter((c) => c.type === 'input')).toHaveLength(count);
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain('private-terminal-test');
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: viewport.height,
    height: viewport.width,
  });
  await expect
    .poll(() => commands.filter((c) => c.type === 'resize').length)
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel
    .getByLabel('Interactive terminal', { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(panel.locator('.xterm-rows')).toContainText(
    'private-terminal-test',
  );
  await page.screenshot({
    path: testInfo.outputPath('terminal.png'),
    fullPage: true,
  });
  loseInputReply = true;
  await input.focus();
  await page.keyboard.type('x');
  await expect(panel.getByRole('alert')).toBeVisible();
  const attempts = commands.filter((c) => c.type === 'input').length;
  await panel
    .getByRole('button', { name: 'Reconnect terminal', exact: true })
    .click();
  await expect(panel.getByRole('status')).toContainText('running');
  expect(commands.filter((c) => c.type === 'input')).toHaveLength(attempts);
  await panel.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Start terminal', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Rig', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Web terminal' })).toHaveCount(
    0,
  );
  expect(pageErrors).toEqual([]);
});

test('administrator terminal is explicit and mode changes never start a shell', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const starts: string[] = [];
  await page.route('**/api/v1/terminal/*', async (route) => {
    const mode = route.request().url().split('/').at(-1)!;
    const command = route.request().postDataJSON();
    if (command.type === 'start') starts.push(mode);
    await route.fulfill({
      json: {
        available: true,
        identity: mode === 'admin' ? 'oxidal-admin' : 'oxidal-debug',
        directory:
          mode === 'admin' ? '/home/oxidal-admin' : '/run/oxidal-terminal',
        session: null,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('tablist', { name: 'Settings sections' })
    .getByRole('tab', { name: 'Maintenance', exact: true })
    .click();
  await page.getByText('Interactive terminal', { exact: true }).click();
  const panel = page.getByRole('region', { name: 'Web terminal' });
  await panel.getByLabel('Terminal access').click();
  await page
    .getByRole('option', { name: 'Administrator · password sudo' })
    .click();
  await expect(panel.getByRole('status')).toContainText('oxidal-admin');
  await expect(panel).toContainText('Use sudo and the admin password');
  expect(starts).toEqual([]);
  await panel
    .getByRole('button', { name: 'Start terminal', exact: true })
    .click();
  await expect.poll(() => starts).toEqual(['admin']);
  await panel.getByLabel('Terminal access').click();
  await page.getByRole('option', { name: 'Unprivileged', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('oxidal-debug');
  expect(starts).toEqual(['admin']);
  expect(pageErrors).toEqual([]);
});
