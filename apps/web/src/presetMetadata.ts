import type { LibraryCatalog, PresetDetails } from './api';
type Entry = Pick<LibraryCatalog['items'][number], 'kind' | 'id' | 'name'>;
export const detailsKey = (entry: Pick<Entry, 'kind' | 'id'>) =>
  `${entry.kind}:${entry.id}`;
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
    [name, details?.description ?? '', ...(details?.categories ?? [])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
}
