import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from './button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from './dialog';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The action word, such as "Delete" or "Stop and play". */
  confirm: string;
  cancel?: string;
  /** The action removes something; the button uses danger ink. */
  destructive?: boolean;
}

/**
 * A question with two answers in place of the browser's confirm box.
 * `ask` resolves to true when the action is chosen; render `dialog` once.
 * Cancel is always the safe answer and is where focus starts.
 */
export function useConfirm() {
  const [request, setRequest] = useState<
    (ConfirmOptions & { token: symbol }) | null
  >(null);
  const pending = useRef<{
    token: symbol;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);
  const ask = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (!mounted.current) {
          resolve(false);
          return;
        }
        pending.current?.resolve(false);
        const token = Symbol('confirmation');
        pending.current = { token, resolve };
        setRequest({ ...options, token });
      }),
    [],
  );
  const close = (ok: boolean) => {
    // A prior render may still receive input while its replacement commits.
    if (!request || pending.current?.token !== request.token) return;
    pending.current.resolve(ok);
    pending.current = null;
    setRequest(null);
  };
  const dialog = (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => !open && close(false)}
    >
      {request && (
        <DialogContent size="sm">
          <DialogHeader title={request.title} />
          {request.body && (
            <DialogBody>
              <p className="m-0 text-sm text-muted-foreground">
                {request.body}
              </p>
            </DialogBody>
          )}
          <DialogFooter>
            <Button variant="outline" autoFocus onClick={() => close(false)}>
              {request.cancel ?? 'Cancel'}
            </Button>
            <Button
              variant={request.destructive ? 'destructive' : 'default'}
              onClick={() => close(true)}
            >
              {request.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
  return { ask, dialog };
}
