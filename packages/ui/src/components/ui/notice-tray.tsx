import {
  CheckCircle,
  Info,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react';

import { cn } from '../../lib/cn';
import { Button } from './button';
import { dismissNotice, useNotices } from './notices';

const ICONS = {
  error: WarningCircle,
  warning: Warning,
  info: Info,
  success: CheckCircle,
} as const;

/**
 * Where every app-wide notice and toast appears: floating under the sticky
 * strip at the top right, above everything, never pushing the page. Errors
 * first, then newest. Each has an optional action and a close button.
 * `placement="inline"` renders the same list in flow, for stories and for
 * pages that want their notices in a fixed spot.
 */
export function NoticeTray({
  placement = 'floating',
  className,
}: {
  placement?: 'floating' | 'inline';
  className?: string;
}) {
  const notices = useNotices();
  if (!notices.length) return null;
  return (
    <div
      data-slot="notice-tray"
      className={cn(
        'pointer-events-none grid w-full max-w-md gap-2',
        placement === 'floating' &&
          'fixed top-[calc(var(--safe-top)+3.5rem)] right-page z-tray',
        className,
      )}
    >
      {notices.map((notice) => {
        const Icon = ICONS[notice.tone];
        return (
          <div
            key={`${notice.id}-${notice.text}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            data-tone={notice.tone}
            className={cn(
              'pointer-events-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border border-l-4 border-border bg-raised py-1.5 pr-1.5 pl-3 text-sm text-foreground shadow-raised',
              notice.tone === 'error' && 'border-l-foreground',
              notice.tone === 'warning' && 'border-l-wire',
              notice.tone === 'success' && 'border-l-brand',
              notice.tone === 'info' && 'border-l-border',
            )}
          >
            <Icon
              aria-hidden="true"
              weight={notice.tone === 'error' ? 'fill' : 'regular'}
              className="size-4 shrink-0"
            />
            <span className="py-1.5">{notice.text}</span>
            <span className="flex items-center gap-1">
              {notice.action && (
                <Button size="sm" variant="outline" onClick={notice.action.run}>
                  {notice.action.label}
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Close: ${notice.text}`}
                onClick={() => dismissNotice(notice)}
              >
                <X />
              </Button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
