import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { Button } from '../ui/button';

export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      disabled?: boolean;
    }
  | { label: string; href: string; download: true }
  | 'separator';

/**
 * A small action menu: arrow keys move, Esc closes and returns focus, a
 * click outside closes it.
 */
function MoreMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="media-more">
      <Button
        ref={trigger}
        variant="outline"
        size="icon"
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <DotsThree aria-hidden="true" weight="bold" />
      </Button>
      {open && (
        <div
          ref={menu}
          className="media-menu"
          role="menu"
          aria-label={`More for ${name}`}
          onKeyDown={(event) => {
            const entries = [
              ...(menu.current?.querySelectorAll<HTMLElement>(
                '[role="menuitem"]:not([aria-disabled="true"])',
              ) ?? []),
            ];
            const index = entries.indexOf(
              document.activeElement as HTMLElement,
            );
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              entries[
                (index + step + entries.length) % entries.length
              ]?.focus();
            } else if (event.key === 'Tab') setOpen(false);
          }}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <hr key={`separator-${index}`} />
            ) : 'href' in item ? (
              <a
                key={item.label}
                role="menuitem"
                href={item.href}
                download
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  close();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

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
        {menu && <MoreMenu name={name} items={menu} />}
      </div>
    </li>
  );
}
