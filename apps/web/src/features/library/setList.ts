import {
  libraryCatalog,
  type LibraryCatalog,
  type LibraryUpdate,
} from '../../api';
import { finishEffectsOnly } from './oxidal/finish';
import { builtName } from './oxidal/oxidalSounds.model';
import { lv2ShowcaseRecipes } from '../../recipes/lv2Showcase';

/**
 * Set list membership, the starter set list and Duplicate: the explicit
 * membership the daemon keeps in its library catalog. Presets in Mine are in
 * the set list unless taken out; Oxidal sounds join by reference.
 * @see docs/presets/format.md
 */
export type CatalogItem = LibraryCatalog['items'][number];
type Entry = Pick<CatalogItem, 'kind' | 'id'>;

/**
 * The starter set list: nine effects-only Oxidal sounds, one per core genre,
 * in a playable order. Referenced, never copied. They use no captures; the
 * effect packs they need are installed when the player asks for the starter.
 */
const STARTER_RECIPES = [
  'L09', // Two Rooms
  'L05', // Pocket Wire
  'L06', // Dust Road
  'L10', // Offbeat
  'L11', // Ducked Lead
  'L01', // Slow Weather
  'L03', // Reed Circuit
  'L04', // Low Lantern
  'L07', // Broken Radio
] as const;

/** The starter sounds as shipped, in starter order. */
export const starterRecipes = () =>
  STARTER_RECIPES.flatMap((id) => {
    const recipe = lv2ShowcaseRecipes.find((r) => r.id === id);
    return recipe ? [recipe] : [];
  });

/** The starter presets saved on this unit, in starter order. */
function starterEntries(catalog: LibraryCatalog): CatalogItem[] {
  return STARTER_RECIPES.flatMap((id) => {
    const recipe = lv2ShowcaseRecipes.find((r) => r.id === id);
    if (!recipe) return [];
    const name = builtName(recipe);
    const item = catalog.items.find(
      (i) =>
        i.kind === 'rig' &&
        i.origin === 'oxidal_example' &&
        !i.superseded &&
        (i.source_name === name || i.source_name === recipe.name),
    );
    return item ? [item] : [];
  });
}

/** One library edit against the latest catalog; a stale revision is read
 * again once, because these edits do not depend on what changed. */
async function edit(
  entry: Entry | null,
  action: LibraryUpdate['action'],
): Promise<LibraryCatalog> {
  for (let attempt = 0; ; attempt++) {
    const catalog = await libraryCatalog();
    try {
      return await libraryCatalog({
        expected_revision: catalog.revision,
        ...(entry ? { entry_kind: entry.kind, id: entry.id } : {}),
        action,
      });
    } catch (cause) {
      if (attempt > 0 || !/changed; refresh/i.test(String(cause))) throw cause;
    }
  }
}

export const setListMember = (entry: Entry, member: boolean) =>
  edit(entry, { kind: 'set_list', member });

/** Append the installed starter presets after the existing entries (S-20). */
async function addStarter(): Promise<{
  catalog: LibraryCatalog;
  added: number;
  before: number;
  missing: number;
}> {
  const current = await libraryCatalog();
  const entries = starterEntries(current);
  const members = (c: LibraryCatalog) =>
    c.items.filter((i) => i.in_set_list).length;
  const catalog = await edit(null, {
    kind: 'starter',
    entries: entries.map(({ kind, id }) => ({ kind, id })),
  });
  return {
    catalog,
    added: members(catalog) - members(current),
    before: members(current),
    missing: STARTER_RECIPES.length - entries.length,
  };
}

/**
 * The whole starter in one step: install the effect packs its sounds need,
 * save the sounds, then append them to the set list.
 */
export async function setUpStarter(progress: (label: string) => void) {
  await finishEffectsOnly(starterRecipes(), progress);
  progress('Adding to the set list…');
  const result = await addStarter();
  if (!result.added && result.missing === STARTER_RECIPES.length)
    throw new Error('The starter sounds could not be saved on this unit.');
  return result;
}

/** "Not now": the starter is not offered again on this unit. */
export const declineStarter = () =>
  edit(null, { kind: 'starter', entries: [] });

/** "Name copy" in Mine, not in the set list. Resolves to the copy. */
export async function duplicatePreset(
  entry: Entry,
): Promise<{ catalog: LibraryCatalog; copy: CatalogItem }> {
  const catalog = await edit(entry, { kind: 'duplicate' });
  const copy = catalog.items.find(
    (i) => i.kind === catalog.created?.kind && i.id === catalog.created?.id,
  );
  if (!copy) throw new Error('The copy was saved but could not be found.');
  return { catalog, copy };
}

/** Plain-language result of Add starter set list. */
export function starterMessage(result: {
  added: number;
  before: number;
  missing: number;
}): string {
  const missing = result.missing
    ? ` ${result.missing} starter preset${result.missing === 1 ? ' is' : 's are'} not on this unit yet.`
    : '';
  if (!result.added)
    return `The starter set list is already in your set list.${missing}`;
  return result.before
    ? `Added ${result.added} after your ${result.before} existing entries. Nothing was replaced.${missing}`
    : `Starter set list added: ${result.added} presets.${missing}`;
}
