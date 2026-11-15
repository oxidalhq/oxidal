import { useCallback, useState, type ReactNode } from 'react';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from './button';
import { DialogFooter } from './dialog';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** The action word, such as "Delete" or "Stop and play". */
  confirm: string;
  cancel?: string;
}

/**
 * An Oxidal dialog in place of the browser's confirm box. `ask` resolves to
 * true when the action is chosen; render `dialog` once in the component.
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
  const dialog = request && (
    <AdjustmentDialog title={request.title} onCancel={() => close(false)}>
      <div className="media-dialog-form">
        {request.body && <p>{request.body}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {request.cancel ?? 'Cancel'}
          </Button>
          <Button onClick={() => close(true)}>{request.confirm}</Button>
        </DialogFooter>
      </div>
    </AdjustmentDialog>
  );
  return { ask, dialog };
}
