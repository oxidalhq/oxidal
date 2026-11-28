import { ArrowsLeftRight, PushPin, SidebarSimple } from '@phosphor-icons/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '../components/ui/button';
import { Eyebrow } from '../components/ui/text';
import { cn } from '../lib/cn';
import { useRemembered } from '../lib/use-remembered';

/**
 * A panel beside the main work that can be minimised to a thin strip, peeked
 * at over the work, pinned open, and moved to the other side. Its choices are
 * remembered by this browser, not by the preset. A minimised strip shows a
 * short status (the set list position, the track time) so the panel does not
 * need opening to check it.
 * @see docs/interface.md
 */

type Mode = 'min' | 'pinned';
type Side = 'left' | 'right';

export function SideRail({
  id,
  title,
  icon,
  status,
  side: initialSide,
  defaultMode = 'min',
  children,
  className,
}: {
  /** Names what the browser remembers for this panel. */
  id: string;
  title: string;
  icon: ReactNode;
  /** A few characters under the icon while minimised. */
  status?: string;
  side: Side;
  defaultMode?: Mode;
  children: ReactNode;
  className?: string;
}) {
  const [mode, setMode] = useRemembered<Mode>(`oxidal.rail.${id}`, defaultMode);
  const [side, setSide] = useRemembered<Side>(
    `oxidal.rail.${id}.side`,
    initialSide,
  );
  const [peek, setPeek] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPeek(false), []);

  // A peeked panel closes when the player works elsewhere, or presses Escape.
  useEffect(() => {
    if (!peek) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [peek, close]);

  const border = side === 'left' ? 'border-r' : 'border-l';
  const panel = (shadow: boolean) => (
    <aside
      aria-label={title}
      className={cn(
        'flex min-h-0 w-80 shrink-0 flex-col border-border bg-background',
        border,
        shadow && 'shadow-xl',
      )}
    >
      <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-1">
        <Eyebrow>{title}</Eyebrow>
        <span className="flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${title} to the ${side === 'left' ? 'right' : 'left'}`}
            onClick={() => setSide(side === 'left' ? 'right' : 'left')}
          >
            <ArrowsLeftRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={mode === 'pinned'}
            aria-label={
              mode === 'pinned' ? `Unpin ${title}` : `Pin ${title} open`
            }
            onClick={() => {
              setMode(mode === 'pinned' ? 'min' : 'pinned');
              setPeek(false);
            }}
          >
            <PushPin weight={mode === 'pinned' ? 'fill' : 'regular'} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Minimise ${title}`}
            onClick={() => {
              setMode('min');
              setPeek(false);
            }}
          >
            <SidebarSimple mirrored={side === 'right'} />
          </Button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );

  if (mode === 'pinned')
    return (
      <div
        data-slot="side-rail"
        data-side={side}
        data-mode="pinned"
        className={cn(
          'flex min-h-0',
          side === 'right' && 'order-last',
          className,
        )}
      >
        {panel(false)}
      </div>
    );

  return (
    <div
      ref={root}
      data-slot="side-rail"
      data-side={side}
      data-mode={peek ? 'peek' : 'min'}
      className={cn(
        'relative flex min-h-0',
        side === 'right' && 'order-last',
        className,
      )}
    >
      <div className="flex w-12 shrink-0 flex-col items-center gap-3 py-3">
        <button
          type="button"
          aria-label={`Open ${title}${status ? ` ${status}` : ''}`}
          aria-expanded={peek}
          onClick={() => setPeek((p) => !p)}
          className="flex min-h-touch w-10 flex-col items-center justify-center gap-0.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-5"
        >
          {icon}
          {status && (
            <span className="font-mono text-[10px] tabular-nums">{status}</span>
          )}
        </button>
      </div>
      {peek && (
        <div
          className={cn(
            'absolute top-0 bottom-0 z-20 flex',
            side === 'left' ? 'left-12' : 'right-12',
          )}
        >
          {panel(true)}
        </div>
      )}
    </div>
  );
}
