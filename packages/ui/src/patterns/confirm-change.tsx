import { CircleNotch } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';

/**
 * A change that could cut you off (a new network, a new audio setting)
 * has to be kept from the new state within a time limit, or the device
 * goes back on its own. Asked in a dialog in front of everything: it cannot
 * be dismissed by clicking outside, because doing nothing already means
 * "go back". While the change is still being applied, it says so.
 */
export function ConfirmChange({
  open,
  title,
  body,
  applying,
  secondsLeft,
  totalSeconds,
  keepLabel,
  disabled = false,
  keepDisabled = false,
  canGoBackWhileApplying = false,
  recovery,
  onKeep,
  onGoBack,
}: {
  open: boolean;
  title: string;
  /** What changed and what happens if nothing is confirmed. */
  body: React.ReactNode;
  /** The change is still being applied ("Restarting audio…"). */
  applying?: string;
  secondsLeft: number;
  totalSeconds: number;
  keepLabel: string;
  disabled?: boolean;
  keepDisabled?: boolean;
  /** Network rollback remains available while activation is in progress. */
  canGoBackWhileApplying?: boolean;
  recovery?: React.ReactNode;
  onKeep: () => void;
  onGoBack: () => void;
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        size="sm"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader title={title} closable={false} />
        <DialogBody className="grid gap-3">
          {applying ? (
            <p role="status" className="m-0 flex items-center gap-2 text-sm">
              <CircleNotch aria-hidden="true" className="size-4 animate-spin" />
              {applying}
            </p>
          ) : (
            <>
              <div className="text-sm">{body}</div>
              <div className="grid gap-1">
                <Progress
                  value={(secondsLeft / totalSeconds) * 100}
                  label="Time left to keep it"
                />
                <Caption role="timer" aria-live="off" className="text-xs">
                  Goes back on its own in {secondsLeft} s
                </Caption>
              </div>
            </>
          )}
          {recovery}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onGoBack}
            disabled={
              disabled || (Boolean(applying) && !canGoBackWhileApplying)
            }
          >
            Go back now
          </Button>
          <Button
            onClick={onKeep}
            disabled={disabled || keepDisabled || Boolean(applying)}
          >
            {keepLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
