import { type ReactNode, useCallback, useState } from 'react';

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
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const ask = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ ...options, resolve })),
    [],
  );
  const close = (ok: boolean) => {
    request?.resolve(ok);
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
