import { useState } from 'react';
import type { AudioState } from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { TouchAdjust } from './TouchAdjust';
import './ChainView.css';

/** Prepared engine/model setting: draft a value, then Apply (audio restarts). */
export function SettingDialog({
  control,
  step,
  busy,
  stale,
  onCancel,
  onApply,
  detail,
}: {
  /** One-line explanation of what the setting does. */
  detail?: string;
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
      <div className="setting-dialog">
        {detail && <p className="caption">{detail}</p>}
        {control.toggle ? (
          <button
            type="button"
            role="switch"
            className="led-toggle"
            aria-checked={value === 1}
            aria-label={control.label}
            disabled={busy}
            onClick={() => setValue((old) => (old === 1 ? 0 : 1))}
          >
            <span className="chain-led" aria-hidden="true" />
            {value === 1 ? 'On' : 'Off'}
          </button>
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
        {control.toggle && (
          <p className="caption">Audio restarts briefly when applied.</p>
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
      </div>
    </AdjustmentDialog>
  );
}
