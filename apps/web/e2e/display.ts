import { expect, type Page } from '@playwright/test';

type Workspace = 'Settings' | 'Library' | 'Levels';

export function workspaceSectionPicker(page: Page, workspace: Workspace) {
  return page.getByRole('combobox', {
    name: `${workspace} section`,
    exact: true,
  });
}

function workspaceDirectory(page: Page, workspace: Workspace) {
  return page.getByRole('navigation', {
    name: `${workspace} sections`,
    exact: true,
  });
}

/** The same section layout uses a compact picker or a wide-screen directory. */
export async function selectWorkspaceSection(
  page: Page,
  workspace: Workspace,
  label: string,
) {
  const picker = workspaceSectionPicker(page, workspace);
  const directory = workspaceDirectory(page, workspace);
  await expect(picker.or(directory)).toBeVisible();
  if (await picker.isVisible()) {
    await picker.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  } else {
    await directory.getByRole('button', { name: label, exact: true }).click();
  }
}

export async function expectWorkspaceSection(
  page: Page,
  workspace: Workspace,
  label: string,
) {
  const picker = workspaceSectionPicker(page, workspace);
  const directory = workspaceDirectory(page, workspace);
  await expect(picker.or(directory)).toBeVisible();
  if (await picker.isVisible()) await expect(picker).toContainText(label);
  else
    await expect(
      directory.getByRole('button', { name: label, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
}

export async function selectSettingsSection(page: Page, label: string) {
  await selectWorkspaceSection(page, 'Settings', label);
}

export async function expectSettingsSection(page: Page, label: string) {
  await expect(page.locator('#settings-section-title')).toHaveText(label);
  await expect(page.locator('#settings-section-title')).toBeVisible();
  await expectWorkspaceSection(page, 'Settings', label);
}

export async function setDisplayMode(
  page: Page,
  mode: 'default' | 'stage' | 'sunlight' | 'epaper',
) {
  const navigation = page.getByRole('navigation', {
    name: 'Instrument navigation',
  });
  const previous = await navigation
    .locator('[aria-current="page"]')
    .innerText();
  const previousSection =
    previous === 'Settings'
      ? await page.locator('#settings-section-title').innerText()
      : null;
  await navigation
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await selectSettingsSection(page, 'Display');
  const labels = {
    default: 'Default',
    stage: 'Night',
    sunlight: 'Sunlight',
    epaper: 'E-paper',
  } as const;
  await page
    .getByRole('radiogroup', { name: 'Display mode', exact: true })
    .getByRole('radio', { name: labels[mode], exact: true })
    .click();
  if (previousSection) await selectSettingsSection(page, previousSection);
  else
    await navigation
      .getByRole('button', { name: previous, exact: true })
      .click();
}

/** Library → Tones and IRs, then NAM captures or cabinet IRs (Sprint 07). */
export async function openSounds(page: Page, format: 'nam' | 'ir') {
  await selectWorkspaceSection(page, 'Library', 'Tones and IRs');
  await page
    .getByRole('radiogroup', { name: 'Sound type' })
    .getByRole('radio', {
      name: format === 'nam' ? 'NAM captures' : 'Cabinet IRs',
      exact: true,
    })
    .click();
}

/** Library → New preset → one of the advanced composers kept for parity. */
export async function openComposer(page: Page, kind: 'effects' | 'tone3000') {
  await expect(
    page.getByRole('region', { name: 'Library', exact: true }),
  ).toBeVisible();
  // Library can restore the open composer before its device readback arrives.
  const existing = page.getByRole('region', {
    name: kind === 'effects' ? 'Effects authoring' : 'Native preset editor',
    exact: true,
  });
  const create = page.getByRole('button', { name: 'New preset', exact: true });
  await expect(existing.or(create)).toBeVisible();
  if (await existing.isVisible()) return;
  await create.click();
  await page
    .getByRole('dialog', { name: 'New preset' })
    .getByRole('button', {
      name:
        kind === 'effects' ? 'Effects chain composer' : 'TONE3000 chain editor',
      exact: true,
    })
    .click();
}
