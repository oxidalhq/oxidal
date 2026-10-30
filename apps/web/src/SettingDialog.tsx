import { useState } from 'react';
import type { AudioState } from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { TouchAdjust } from './TouchAdjust';

/** Prepared engine/model setting: draft a value, then Apply (audio restarts). */
export function SettingDialog({
  control,
  step,
  busy,
  stale,
  onCancel,
  onApply,
}: {
  control: AudioState['controls'][number];
  step?: number;
  busy: boolean;
  stale: boolean;
  onCancel: () => void;
  onApply: (value: number) => Promise<unknown>;
}) {
  const [value, setValue] = useState(control.value);
  return (
    <AdjustmentDialog
      title={control.label}
      onCancel={() => {
        if (!busy) onCancel();
      }}
    >
      {control.toggle ? (
        <Button
          role="switch"
          aria-checked={value === 1}
          aria-label={control.label}
          variant={value === 1 ? 'default' : 'outline'}
          disabled={busy}
          onClick={() => setValue((old) => (old === 1 ? 0 : 1))}
        >
          {value === 1 ? 'On' : 'Off'}
        </Button>
      ) : (
        <TouchAdjust
          label="Prepared setting value"
          value={value}
          baseline={control.value}
          min={0}
          max={1}
          step={step ?? 0.01}
          disabled={busy}
          onChange={setValue}
          format={(v) =>
            control.target.endsWith(':slimSize') && (v === 0 || v === 1)
              ? v === 0
                ? 'Lite'
                : 'Full'
              : `${(v * 100).toFixed(1)}%`
          }
          commitHint="Audio restarts when applied."
        />
      )}
      <div className="action-row">
        <Button
          disabled={busy || !Number.isFinite(value) || stale}
          onClick={() => void onApply(value)}
        >
          Apply
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </AdjustmentDialog>
  );
}
