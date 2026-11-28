import { expect, type Page } from '@playwright/test';

/**
 * Draw the chain as the tree for this test. The Rig draws a map by default; a
 * few tests check the tree's own structure (its nodes, paths and folds).
 */
export async function useTreeChain(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem('oxidal.rig.chain-view.2', JSON.stringify('tree')),
  );
}

export type Destination = 'Rig' | 'Guitars' | 'Library' | 'Levels' | 'Settings';

/** The floating capsule at the top of every screen. */
function capsule(page: Page) {
  return page.getByRole('navigation', { name: 'Main menu', exact: true });
}

/**
 * Open the floating capsule, as reaching for it does: its pages, search,
 * the device health and (on the Rig) Tuner, Save and More appear. A bubble
 * opens the same way.
 */
export async function openCapsule(page: Page) {
  const nav = capsule(page);
  await expect(nav).toBeVisible();
  await expect(async () => {
    const bubble = nav.getByRole('button', { name: /^Show menu/ });
    if (await bubble.isVisible()) await bubble.click({ timeout: 2000 });
    // A mouse rests on it; a touch screen or keyboard reaches it by focus.
    await nav.hover({ timeout: 2000 });
    await nav.getByRole('button', { name: 'Menu', exact: true }).focus();
    await expect(
      page.locator('[data-slot="floating-capsule"][data-phase="open"]'),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  // Let its parts finish opening before measuring or clicking them. Opening
  // can move the capsule from under a resting mouse; rest on it again.
  await page.waitForTimeout(400);
  await page.mouse.move(1, 1);
  await nav.hover();
  await expect(
    page.locator('[data-slot="floating-capsule"][data-phase="open"]'),
  ).toBeVisible();
}

/**
 * Go to a main screen. A phone uses its bottom navigation; wider screens use
 * the pages in the opened capsule.
 */
export async function goTo(page: Page, name: Destination) {
  // The screen switches between the capsule and the phone navigation when its
  // width crosses 768 px, so try again if it changes while we click.
  await expect(async () => {
    const tabs = page.getByRole('navigation', {
      name: 'Instrument navigation',
    });
    if (await tabs.isVisible()) {
      await tabs
        .getByRole('button', { name, exact: true })
        .click({ timeout: 3000 });
      return;
    }
    await openCapsule(page);
    const button = capsule(page).getByRole('button', { name, exact: true });
    // With a preset, a screen narrower than a laptop keeps the page names in
    // the ☰ menu.
    if (await button.isVisible()) await button.click({ timeout: 3000 });
    else await capsuleMenu(page, name);
  }).toPass({ timeout: 20000 });
}

/** The main screen now showing, read from whichever navigation the screen has. */
export async function currentDestination(page: Page): Promise<Destination> {
  const tabs = page.getByRole('navigation', { name: 'Instrument navigation' });
  const where = (await tabs.isVisible()) ? tabs : capsule(page);
  return (
    (await where.locator('[aria-current="page"]').first().textContent()) ?? ''
  ).trim() as Destination;
}

/** Visible on every screen size: the capsule. */
export function mainNavigation(page: Page) {
  return capsule(page);
}

/** Items in the capsule's ☰ menu: Display mode, Protect, Restart audio and the rest. */
export async function capsuleMenu(page: Page, item: string | RegExp) {
  await capsule(page)
    .getByRole('button', { name: 'Menu', exact: true })
    .click();
  await page.getByRole('menuitem', { name: item }).click();
}

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
  const previous = await currentDestination(page);
  const previousSection =
    previous === 'Settings'
      ? await page.locator('#settings-section-title').innerText()
      : null;
  await goTo(page, 'Settings');
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
  else await goTo(page, previous);
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

/** Stops audio: the button is in the bar on some screens and in More on the Rig. */
export async function stopAudio(page: Page) {
  const direct = page.getByRole('button', { name: 'Stop audio', exact: true });
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  await moreActions(page);
  await page
    .getByRole('dialog', { name: 'Preset actions' })
    .getByRole('button', { name: 'Stop audio', exact: true })
    .click();
}

/**
 * More preset actions: in the opened capsule on wider screens, in the Rig's
 * row on a phone.
 */
async function moreActions(page: Page) {
  const more = page.getByRole('button', { name: 'More preset actions' });
  if (!(await more.isVisible().catch(() => false))) await openCapsule(page);
  await more.click();
}

/**
 * Save a copy of the playing preset with scenes: the chain bar's Save waits
 * for a change, so the copy is in More (Preset actions) whether or not
 * anything changed. Opens More and returns the button.
 */
export async function saveCopyButton(page: Page) {
  await moreActions(page);
  return page
    .getByRole('dialog', { name: 'Preset actions' })
    .getByRole('button', { name: /^Save a copy/ });
}

/**
 * A Rig action that lives in the opened capsule on a wide screen (Save
 * copy, Preset actions, Edit, Tuner, More) and in the Rig's row on a phone.
 */
export async function rigButton(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  // A closed capsule keeps these laid out but faded and out of reach (and
  // hidden from the accessibility tree until it opens).
  const inCapsule = await page
    .getByRole('button', { name, exact: true, includeHidden: true })
    .first()
    .evaluate((el) => !!el.closest('[data-slot="floating-capsule"]'), null, {
      timeout: 10000,
    })
    .catch(() => false);
  if (inCapsule) await openCapsule(page);
  return button;
}

/** Opens or closes a kept-open tool (Backing, Tuner, Venue EQ, Chord sheet) from the capsule's ☰ menu. */
export async function openTool(page: Page, title: string) {
  await page
    .getByRole('navigation', { name: 'Main menu', exact: true })
    .getByRole('button', { name: 'Menu', exact: true })
    .click();
  await page
    .getByRole('menuitemcheckbox', { name: title, exact: true })
    .click();
}

/** Perform's board (Rig pads, Four or Ten switches): in the opened capsule. */
export async function chooseBoard(page: Page, name: string) {
  await openCapsule(page);
  await page
    .getByRole('combobox', { name: 'On-screen controller layout' })
    .click();
  await page.getByRole('option', { name }).click();
  await page.mouse.move(5, 500);
}

/** Library › Mine shows the chosen preset in a panel beside the list from 1280 px (C2). */
export function mineHasPanel(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1280;
}

/**
 * Runs one of a Mine preset's actions: from its row's ⋯ menu, or on wide
 * screens from the details panel after choosing the row.
 */
export async function minePresetAction(
  page: Page,
  name: string,
  action: string,
) {
  if (!mineHasPanel(page)) {
    await page
      .getByRole('button', { name: `More for ${name}`, exact: true })
      .click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
    return;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page
    .getByRole('button', { name: new RegExp(`^Details:\\s*${escaped}(\\s|$)`) })
    .first()
    .click();
  const panel = page.getByRole('complementary', { name: 'Preset details' });
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
  await panel.getByRole('button', { name: action, exact: true }).click();
}

/** Library › TONE3000 opens on the TONE3000 browser; imported preset files have their own tab. */
export async function openImportedTone3000(page: Page) {
  const tab = page.getByRole('radio', { name: /^Imported presets/ });
  if ((await tab.getAttribute('aria-checked')) !== 'true') await tab.click();
}
