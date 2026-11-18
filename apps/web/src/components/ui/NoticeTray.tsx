import { X } from '@phosphor-icons/react';

import { Button } from './button';
import { dismissNotice, useNotices } from './notices';

/** The floating notice stack; place it once, in the resource strip. */
export function NoticeTray() {
  const notices = useNotices();
  return (
    <div className="notice-tray" aria-label="Notices">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="notice-tray-item"
          data-tone={notice.tone}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          {notice.action && (
            <Button variant="outline" onClick={notice.action.run}>
              {notice.action.label}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Close: ${notice.text}`}
            onClick={() => dismissNotice(notice)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  );
}
