import type { ReactNode } from 'react';

import { type MenuItem,RowMenu } from '../RowMenu';

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
    <li className="media-row" data-cued={cued || undefined} aria-label={name}>
      <span className="media-row-num">{num}</span>
      <div className="media-row-main">
        <span className="media-row-name">
          {name}
          {state}
        </span>
        <span className="media-row-sub">{sub}</span>
      </div>
      <div className="media-row-actions">
        {actions}
        {menu && <RowMenu name={name} items={menu} variant="outline" />}
      </div>
    </li>
  );
}
