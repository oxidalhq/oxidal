import { CaretDown } from '@phosphor-icons/react';
import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTrigger,
} from '@oxidal/design-system/components/sheet';

import {
  type MidiPosition,
  recallOccurrence,
  type SetOrder,
  setOrder,
} from '../../api';
import { friendlyError } from '../../lib/friendlyError';

export function StageSetList({
  disabled,
  position,
  onRecall,
}: {
  disabled: boolean;
  position: MidiPosition | null;
  onRecall: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [order, setShown] = useState<SetOrder | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);

  async function load() {
    const request = ++generation.current;
    setShown(null);
    setError('');
    try {
      const next = await setOrder();
      if (request === generation.current) setShown(next);
    } catch (cause) {
      if (request === generation.current)
        setError(friendlyError(cause, 'read the Set list'));
    }
  }

  async function recall(id: string) {
    if (!order || pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await recallOccurrence(id, order.revision);
      setOpen(false);
      onRecall();
    } catch (cause) {
      setError(friendlyError(cause, 'recall this Set-list entry'));
      setShown(null);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function changeOpen(next: boolean) {
    if (pending.current) return;
    setOpen(next);
    if (next) void load();
    else generation.current++;
  }
  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Set list
          {position?.index != null
            ? `: ${position.index + 1}/${position.length}`
            : ''}
          <CaretDown aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent onOpenChange={changeOpen} aria-describedby={undefined}>
        <SheetHeader title="Set list" />
        <SheetBody>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <Button variant="outline" onClick={() => void load()}>
                Refresh Set list
              </Button>
            </>
          ) : !order ? (
            <p role="status">Reading the Set list…</p>
          ) : order.entries.length ? (
            <ol
              aria-label="Set-list entries"
              className="grid list-none gap-2 p-0"
            >
              {order.entries.map((row, index) => (
                <li key={row.entry.id}>
                  <Button
                    variant="outline"
                    disabled={busy || disabled}
                    className="w-full justify-start"
                    aria-current={
                      row.entry.id === position?.occurrence?.entry.id
                        ? 'true'
                        : undefined
                    }
                    onClick={() => void recall(row.entry.id)}
                  >
                    {index + 1} · {row.name}
                  </Button>
                </li>
              ))}
            </ol>
          ) : (
            <p>There are no entries in the Set list.</p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
