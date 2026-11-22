import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { RelativeAdjustment as TouchAdjust } from '@oxidal/design-system/components/number-field';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { confirmedControlDisplay } from '../../rigControls';
import { key } from './mixedRigViewModel';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Adjustment dialog for one continuous control, previewed live until Done.
 * @see docs/interface.md
 */
export function ControlAdjustDialog({ rig, vm }: RigViewProps) {
  const { busy, edit, error, finish, latest: latestRef, queue, setEdit } = rig;
  const { disabled, scale, state } = vm;
  return (
    <>
      {edit && (
        <AdjustmentDialog
          title={edit.control.label}
          onCancel={() => {
            if (!busy) void finish(true);
          }}
        >
          <TouchAdjust
            label={edit.control.label}
            value={scale?.normalized(edit.value) ?? edit.value}
            baseline={
              scale?.normalized(edit.control.value) ?? edit.control.value
            }
            min={scale ? 0 : edit.control.minimum}
            max={scale ? 1 : edit.control.maximum}
            step={0.001}
            snap={scale?.snap}
            nudge={scale?.nudge}
            disabled={disabled}
            onChange={(v) => {
              const value = scale?.native(v) ?? v;
              latestRef.current = value;
              setEdit({ ...edit, value });
              queue.current?.preview(value);
            }}
            format={
              edit.control.target.kind === 'native'
                ? (value) => {
                    const confirmed =
                      state.control?.controls.find(
                        (item) => key(item) === key(edit.control),
                      ) ?? edit.control;
                    return confirmedControlDisplay(
                      confirmed.display,
                      (scale?.native(value) ?? value) !== confirmed.value,
                    );
                  }
                : (scale?.format ?? String)
            }
          />
          <ActionRow>
            <Button disabled={busy} onClick={() => void finish(false)}>
              Done
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              Cancel
            </Button>
          </ActionRow>
          {error && <p role="alert">{error}</p>}
        </AdjustmentDialog>
      )}
    </>
  );
}
