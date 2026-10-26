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
