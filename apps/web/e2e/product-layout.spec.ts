import { expect, test } from '@playwright/test';

import { expectWorkspaceSection, workspaceSectionPicker } from './display';
import { horizontalProblems } from './horizontal-layout';

const library = [
  ['mine', 'Mine'],
  ['oxidal', 'Oxidal sounds'],
  ['tone3000', 'TONE3000'],
  ['setlist', 'Set list'],
  ['tones', 'Tones and IRs'],
  ['backing', 'Backing tracks'],
  ['stems', 'Stems'],
  ['di', 'DI and reamps'],
  ['songbook', 'Songbook'],
] as const;
const settings = [
  ['audio', 'Audio'],
  ['connections', 'Network'],
  ['accounts', 'Accounts'],
  ['midi', 'MIDI'],
  ['effects', 'Effects'],
  ['display', 'Display'],
  ['device', 'Device'],
  ['maintenance', 'Maintenance'],
  ['about', 'About'],
] as const;
const surfaces = [
  { route: 'rig', heading: 'No preset playing' },
  { route: 'guitars', heading: 'Your guitars' },
  { route: 'levels', heading: 'Levels' },
  ...library.map(([id, section]) => ({
    route: `library/${id}`,
    section,
    area: 'Library' as const,
  })),
  ...(['Overview', 'Loudness', 'Diagnostics'] as const).map((section) => ({
    route: `levels/${section.toLowerCase()}`,
    section,
    area: 'Levels' as const,
  })),
  ...settings.map(([id, heading]) => ({ route: `settings/${id}`, heading })),
];

for (const mode of ['default', 'stage', 'sunlight', 'epaper'] as const)
  for (const orientation of ['portrait', 'landscape'] as const)
    test(`product layout · ${mode} · ${orientation}`, async ({
      page,
    }, testInfo) => {
      const viewport = testInfo.project.use.viewport!;
      const short = Math.min(viewport.width, viewport.height);
      const long = Math.max(viewport.width, viewport.height);
      await page.setViewportSize(
        orientation === 'portrait'
          ? { width: short, height: long }
          : { width: long, height: short },
      );
      await page.addInitScript((display) => {
        localStorage.setItem('oxidal.display', display);
        // Layout inspection does not request a wake lock or fullscreen.
        localStorage.setItem('oxidal.keepAwake', 'false');
      }, mode);

      const findings: { route: string; problems: string[] }[] = [];
      const errors: string[] = [];
      const onError = (error: Error) => errors.push(error.message);
      page.on('pageerror', onError);
      for (const surface of surfaces)
        await test.step(surface.route, async () => {
          errors.length = 0;
          try {
            await page.goto(`/#${surface.route}`);
            const main = page.getByRole('main');
            await expect(main).toBeVisible();
            if ('section' in surface)
              await expectWorkspaceSection(page, surface.area, surface.section);
            else if (surface.route.startsWith('settings/'))
              await expect(main.locator('#settings-section-title')).toHaveText(
                surface.heading,
              );
            else
              await expect(
                main.getByRole('heading', {
                  name: surface.heading,
                  exact: true,
                  level: surface.route === 'guitars' ? 2 : 1,
                }),
              ).toBeVisible();
            await expect
              .poll(() =>
                page.evaluate(
                  () => document.documentElement.dataset.display ?? 'default',
                ),
              )
              .toBe(mode);
            await expect(
              page.getByText('Connecting to Oxidal…', { exact: true }),
            ).toHaveCount(0);
            // A mounted page can still show an old snapshot while its feeds
            // reconnect. Inspect the connected product, not that transient.
            await expect(
              page.getByRole('complementary', {
                name: 'DSP and system resources',
              }),
            ).toHaveAttribute('data-connected', 'true');
            await page.evaluate(async () => {
              await document.fonts.ready;
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              );
            });
            const problems = await page.evaluate(horizontalProblems);
            problems.push(
              ...(await page.evaluate(() => {
                const result: string[] = [];
                const touch = matchMedia(
                  '(pointer: coarse), (width < 600px)',
                ).matches;
                for (const element of document.querySelectorAll<HTMLElement>(
                  'button, input, select, textarea, summary, [role=slider]',
                )) {
                  if (!element.checkVisibility()) continue;
                  const rect = element.getBoundingClientRect();
                  if (!rect.width || !rect.height) continue;
                  const name = (
                    element.getAttribute('aria-label') ||
                    element.textContent ||
                    element.tagName
                  )
                    .trim()
                    .slice(0, 90);
                  // Checkbox/switch hit areas belong to their labels. Shared compact
                  // controls retain their designated sizes on wide pointer layouts.
                  const labelledToggle = element.matches(
                    'input[type=checkbox], input[type=radio], [role=switch]',
                  );
                  let minimum = element.matches(
                    '[data-size=sm], [data-size=icon-sm]',
                  )
                    ? 35.5
                    : 43.5;
                  if (!touch) {
                    if (
                      element.matches(
                        '[data-slot=setting-group] [data-slot=collapsible-trigger]',
                      )
                    )
                      minimum = 35.5;
                    if (
                      element.matches(
                        '[data-slot=segmented][data-size=md] [data-slot=segment]',
                      )
                    )
                      minimum = 37.5;
                    if (
                      element.matches(
                        '[data-slot=segmented][data-size=sm] [data-slot=segment]',
                      )
                    )
                      minimum = 31.5;
                  }
                  if (!labelledToggle && rect.height < minimum)
                    result.push(`${name}: ${Math.round(rect.height)}px high`);
                }
                return result;
              })),
            );
            problems.push(...errors.map((message) => `Page error: ${message}`));
            if (problems.length)
              findings.push({ route: surface.route, problems });
          } catch (error) {
            findings.push({ route: surface.route, problems: [String(error)] });
          }
          if (findings.at(-1)?.route === surface.route)
            await testInfo.attach(surface.route.replaceAll('/', '-'), {
              body: await page.screenshot({ fullPage: true }),
              contentType: 'image/png',
            });
        });
      page.off('pageerror', onError);
      await testInfo.attach('layout-findings', {
        body: JSON.stringify(
          {
            project: testInfo.project.name,
            mode,
            orientation,
            viewport: page.viewportSize(),
            surfaces: surfaces.length,
            findings,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      expect(
        findings,
        'See per-surface screenshots and layout-findings',
      ).toEqual([]);
    });

test('Library and Levels sections stay reachable by touch and keyboard on the Fold cover', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'fold-cover', 'Fold cover touch layout');

  await page.goto('/#library/mine');
  const library = workspaceSectionPicker(page, 'Library');
  await expect(library).toContainText('Mine');
  await library.tap();
  await page.getByRole('option', { name: 'Tones and IRs', exact: true }).tap();
  await expectWorkspaceSection(page, 'Library', 'Tones and IRs');

  await library.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('option', { name: 'Songbook' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expectWorkspaceSection(page, 'Library', 'Songbook');
  await expect(page).toHaveURL(/#library\/songbook$/);
  await page.reload();
  await expectWorkspaceSection(page, 'Library', 'Songbook');

  await page.setViewportSize({ width: 882, height: 344 });
  const directory = page.getByRole('navigation', { name: 'Library sections' });
  await expectWorkspaceSection(page, 'Library', 'Songbook');
  await directory.getByRole('button', { name: 'DI and reamps' }).press('Enter');
  await expectWorkspaceSection(page, 'Library', 'DI and reamps');
  await page.setViewportSize({ width: 344, height: 882 });
  await expect(library).toContainText('DI and reamps');
  expect(await page.evaluate(horizontalProblems)).toEqual([]);

  await page.goto('/#levels/loudness');
  const levels = workspaceSectionPicker(page, 'Levels');
  await expectWorkspaceSection(page, 'Levels', 'Loudness');
  await expect(
    page.getByRole('button', { name: 'Open browser audition' }),
  ).toBeVisible();
  await levels.tap();
  await page.getByRole('option', { name: 'Diagnostics', exact: true }).tap();
  await expectWorkspaceSection(page, 'Levels', 'Diagnostics');
  await page.reload();
  await expectWorkspaceSection(page, 'Levels', 'Diagnostics');
  await expect(
    page.getByRole('region', { name: 'Audio and system monitoring' }),
  ).toBeVisible();
  expect(await page.evaluate(horizontalProblems)).toEqual([]);
});
