import type { ReactNode } from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { Description } from '../components/ui/text';
import { SettingGroup, SettingRow } from './settings-page';

/** Device power controls; the caller confirms availability and pending work.
 * The pattern never sends a command when opening or closing the review.
 */
export function DevicePower({
  action,
  busy = false,
  disabled = false,
  notice,
  error,
  onRequest,
  onCancel,
  onConfirm,
}: {
  action: 'reboot' | 'shutdown' | null;
  busy?: boolean;
  disabled?: boolean;
  notice?: ReactNode;
  error?: string;
  onRequest: (action: 'reboot' | 'shutdown') => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <SettingGroup title="Power">
        <Description>
          Save your edits first. These controls stop audio and close the
          connection.
        </Description>
        {notice}
        {error && !action && <Description role="alert">{error}</Description>}
        <SettingRow label="Restart">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            aria-label="Restart device"
            onClick={() => onRequest('reboot')}
          >
            Restart…
          </Button>
        </SettingRow>
        <SettingRow
          label="Shut down"
          caption="Wait for the device to power down before unplugging."
        >
          <Button
            size="sm"
            variant="destructive"
            disabled={disabled || busy}
            aria-label="Shut down device"
            onClick={() => onRequest('shutdown')}
          >
            Shut down…
          </Button>
        </SettingRow>
      </SettingGroup>
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) onCancel();
        }}
      >
        <DialogContent
          size="sm"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogHeader
            title={
              action === 'reboot' ? 'Restart device?' : 'Shut down device?'
            }
            closable={!busy}
          />
          <DialogBody>
            <Description>
              Audio will stop. Save any edits you want to keep before
              continuing.
            </Description>
            {error && <Description role="alert">{error}</Description>}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant={action === 'shutdown' ? 'destructive' : 'default'}
              disabled={disabled || busy}
              onClick={onConfirm}
            >
              {busy
                ? 'Sending request…'
                : `Confirm ${action === 'reboot' ? 'restart' : 'shutdown'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
