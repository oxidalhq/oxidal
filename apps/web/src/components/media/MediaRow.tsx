import type { ReactNode } from 'react';

import { ListRow } from '@oxidal/design-system/components/list-row';

import { type MenuItem, RowMenu } from '../RowMenu';

/**
 * One session-media file in a list: number, name with its state, a detail
 * line, inline actions and a More menu. Backing tracks use it today; DI,
 * reamps, takes and loops reuse it later.
 * @see docs/media.md
 */
export function MediaRow({
  num,
  name,
  state,
  sub,
  cued = false,
  actions,
  menu,
}: {
  num: ReactNode;
  name: string;
  state?: ReactNode;
  sub: ReactNode;
  cued?: boolean;
  actions?: ReactNode;
  menu?: MenuItem[];
}) {
  return (
    <li aria-label={name}>
      <ListRow
        data-cued={cued || undefined}
        className="gap-y-1 data-[cued]:bg-secondary max-[599px]:grid-cols-[auto_minmax(0,1fr)] max-[599px]:[&>span:last-child]:col-start-2 max-[599px]:[&>span:last-child]:flex-wrap"
        leading={
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {num}
          </span>
        }
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="wrap-anywhere whitespace-normal">{name}</span>
            {state}
          </span>
        }
        caption={sub}
        trailing={
          <>
            {actions}
            {menu && <RowMenu name={name} items={menu} variant="outline" />}
          </>
        }
      />
    </li>
  );
}
