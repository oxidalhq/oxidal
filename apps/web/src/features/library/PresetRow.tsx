import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleNotch, DotsThree, Play } from '@phosphor-icons/react';
import { Button } from '../../components/ui/button';

export type RowAction =
  | { label: string; onSelect: () => void; disabled?: boolean }
  | { label: string; href: string; download?: boolean };

/**
 * One preset row everywhere in Library (7.2): the name and a one-line summary,
 * a distinct Play button, Details, and a menu for occasional actions. The
 * row's blank area never changes audio.
 * @see docs/interface.md
 */
export function PresetRow({
  name,
  meta,
  playing = false,
  loading = false,
  disabled = false,
  onPlay,
  onDetails,
  actions = [],
  extra,
  testId,
}: {
  name: string;
  meta: string;
  playing?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPlay?: () => void;
  onDetails?: () => void;
  actions?: RowAction[];
  extra?: ReactNode;
  testId?: string;
}) {
  return (
    <li className="library-row preset-row" data-testid={testId}>
      <div className="preset-row-text min-w-0">
        <span className="library-name">{name}</span>
        <span className="library-meta">
          {playing && <span className="library-playing">Playing</span>}
          {loading ? (
            <>
              <CircleNotch aria-hidden="true" className="animate-spin" />{' '}
              Starting…
            </>
          ) : (
            meta
          )}
        </span>
      </div>
      <div className="preset-row-actions">
        {extra}
        {onPlay && (
          <Button
            variant={playing ? 'default' : 'outline'}
            disabled={disabled || loading}
            aria-pressed={playing}
            aria-label={`Play ${name}`}
            onClick={onPlay}
          >
            <Play aria-hidden="true" weight="fill" />
            {playing ? 'Playing' : 'Play'}
          </Button>
        )}
        {onDetails && (
          <Button
            variant="ghost"
            aria-label={`Details: ${name}`}
            onClick={onDetails}
          >
            Details
          </Button>
        )}
        {actions.length > 0 && <RowMenu name={name} actions={actions} />}
      </div>
    </li>
  );
}

function RowMenu({ name, actions }: { name: string; actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="row-menu" ref={root}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <DotsThree aria-hidden="true" weight="bold" />
      </Button>
      {open && (
        <div className="row-menu-list" role="menu" aria-label={name}>
          {actions.map((action) =>
            'href' in action ? (
              <a
                key={action.label}
                role="menuitem"
                href={action.href}
                download={action.download}
                onClick={() => setOpen(false)}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setOpen(false);
                  action.onSelect();
                }}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
