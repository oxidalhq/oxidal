import { useState } from 'react';
import type { AudioState } from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { TouchAdjust } from './TouchAdjust';
import { DialogFooter } from './components/ui/dialog';
import { formatDefault } from './engineHelp';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { Switch } from './components/ui/switch';
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
  const choices =
    control.target === 'osFactor'
      ? ['2x', '4x', '8x']
      : control.target === 'pitchWindow'
        ? ['20 ms', '30 ms', '40 ms', '60 ms']
        : control.target.endsWith(':slimSize')
          ? ['Lite', 'Full']
          : null;
  return (
    <AdjustmentDialog
      title={control.label}
      onCancel={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="setting-dialog">
        {detail && <p className="caption">{detail}</p>}
        {choices ? (
          <ToggleGroup
            type="single"
            aria-label={control.label}
            value={String(Math.round(value * (choices.length - 1)))}
            disabled={busy || stale}
            onValueChange={(choice) => {
              if (choice) setValue(Number(choice) / (choices.length - 1));
            }}
          >
            {choices.map((label, index) => (
              <ToggleGroupItem key={label} value={String(index)}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : control.toggle ? (
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>{value === 1 ? 'On' : 'Off'}</span>
            <Switch
              checked={value === 1}
              aria-label={control.label}
              disabled={busy || stale}
              onCheckedChange={(checked) => setValue(checked ? 1 : 0)}
            />
          </label>
        ) : (
          <TouchAdjust
            label="Prepared setting value"
            value={value}
            baseline={control.value}
            min={0}
            max={1}
            step={step ?? 0.01}
            disabled={busy || stale}
            onChange={setValue}
            format={(v) =>
              control.target.endsWith(':slimSize') && (v === 0 || v === 1)
                ? v === 0
                  ? 'Lite'
                  : 'Full'
                : (formatDefault(control.target, v) ??
                  `${(v * 100).toFixed(1)}% of range`)
            }
            commitHint="Audio restarts when applied."
          />
        )}
        {(control.toggle || choices) && (
          <p className="caption">Audio restarts briefly when applied.</p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={busy || !Number.isFinite(value) || stale}
            onClick={() => void onApply(value)}
          >
            Apply
          </Button>
        </DialogFooter>
      </div>
    </AdjustmentDialog>
  );
}
