import { expect, test } from '@playwright/test';

test('first run opens setup and every step reaches its working destination', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page).toHaveURL(/#settings\/essentials$/);
  await expect(
    page.getByRole('heading', { name: "Welcome. Let's get you playing." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath('first-run.png'),
    fullPage: true,
  });
  const steps = [
    ['Put Oxidal on your Wi-Fi', /#settings\/connections$/, 'Network'],
    ['Connect your audio interface', /#settings\/audio$/, 'Audio'],
    ['Set your input level', /#guitars$/, 'Your guitars'],
    ['Pair your foot controller', /#settings\/midi$/, 'MIDI'],
    ['Get a tone', /#library\/oxidal$/, 'Oxidal sounds'],
  ] as const;
  for (const [title, url, destination] of steps) {
    await page.goto('/#settings/essentials');
    await page
      .getByRole('button', { name: `Open: ${title}`, exact: true })
      .click();
    await expect(page).toHaveURL(url);
    await expect(
      destination === 'Oxidal sounds'
        ? page.getByRole('tab', { name: destination, selected: true })
        : page.getByRole('heading', { name: destination, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(url);
  }
  await page.goto('/#settings/essentials');
  await page.getByRole('button', { name: 'Go to Rig', exact: true }).click();
  await expect(page).toHaveURL(/#rig$/);
});

test('first run preserves an explicit library link on a new browser', async ({
  page,
}) => {
  await page.goto('/#library/oxidal');
  await expect(page).toHaveURL(/#library\/oxidal$/);
  await expect(
    page.getByRole('heading', { name: "Welcome. Let's get you playing." }),
  ).toHaveCount(0);
});
