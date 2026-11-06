import type { Page } from '@playwright/test';

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
  const section = page.getByRole('tablist', { name: 'Settings sections' });
  const previousSection =
    previous === 'Settings'
      ? await section.locator('[aria-selected="true"]').innerText()
      : null;
  await navigation
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await section.getByRole('tab', { name: 'Display', exact: true }).click();
  const labels = {
    default: 'Default',
    stage: 'Night',
    sunlight: 'Sunlight',
    epaper: 'E-paper',
  } as const;
  await page.getByLabel('Display mode').click();
  await page.getByRole('option', { name: labels[mode], exact: true }).click();
  if (previousSection)
    await section
      .getByRole('tab', { name: previousSection, exact: true })
      .click();
  else
    await navigation
      .getByRole('button', { name: previous, exact: true })
      .click();
}

/** Library → Sounds, then NAM captures or cabinet IRs (Sprint 07). */
export async function openSounds(page: Page, format: 'nam' | 'ir') {
  await page.getByRole('tab', { name: 'Sounds', exact: true }).click();
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
  await page.getByRole('button', { name: 'New preset', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'New preset' })
    .getByRole('button', {
      name:
        kind === 'effects' ? 'Effects chain composer' : 'TONE3000 chain editor',
      exact: true,
    })
    .click();
}
