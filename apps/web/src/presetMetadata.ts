import type { LibraryCatalog, PresetDetails } from './api';
type Entry = Pick<LibraryCatalog['items'][number], 'kind' | 'id' | 'name'>;
export const detailsKey = (entry: Pick<Entry, 'kind' | 'id'>) =>
  `${entry.kind}:${entry.id}`;
export function presetSearchText(
  name: string,
  details: PresetDetails | undefined,
) {
  return [
    name,
    details?.description ?? '',
    ...(details?.categories ?? []),
  ].join(' ');
}
export function detailsMatch(
  name: string,
  details: PresetDetails | undefined,
  query: string,
  category = '',
) {
  return (
    (!category ||
      !!details?.categories.some(
        (c) => c.toLocaleLowerCase() === category.toLocaleLowerCase(),
      )) &&
    presetSearchText(name, details)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
}
