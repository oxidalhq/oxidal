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
  await page.getByLabel('Display mode').selectOption(mode);
  if (previousSection)
    await section
      .getByRole('tab', { name: previousSection, exact: true })
      .click();
  else
    await navigation
      .getByRole('button', { name: previous, exact: true })
      .click();
}
