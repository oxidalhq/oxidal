import { Minus, Plus } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { NumberField } from '@oxidal/design-system/components/number-field';
import { Switch } from '@oxidal/design-system/components/switch';

import type { VenueBand, VenueSettings } from '../../api';
import {
  BANDS,
  clamp,
  formatDb,
  formatHz,
  formatHzShort,
  GAIN_LIMIT,
  isPass,
  stepHz,
  stepQ,
  TRIM_MAX,
  TRIM_MIN,
} from '../../lib/venueEq';

/**
 * One value with step buttons either side, the compact TouchAdjust-style field
 * the venue editor uses at every width (and the only way to edit on e-paper).
 */
function StepField({
  label,
  value,
  disabled,
  onStep,
}: {
  label: string;
  value: ReactNode;
  disabled: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <div className="grid min-w-0 gap-1 [&>span]:text-xs [&>span]:small-caps [&>span]:text-muted-foreground">
      <span>{label}</span>
      <div
        className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-md border border-border bg-card [&>output]:min-w-0 [&>output]:overflow-hidden [&>output]:text-center [&>output]:font-mono [&>output]:tabular-nums"
        role="group"
        aria-label={label}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Lower ${label}`}
          disabled={disabled}
          onClick={() => onStep(-1)}
        >
          <Minus aria-hidden="true" weight="bold" />
        </Button>
        {typeof value === 'string' ? (
          <output aria-label={`${label} value`}>{value}</output>
        ) : (
          value
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Raise ${label}`}
          disabled={disabled}
          onClick={() => onStep(1)}
        >
          <Plus aria-hidden="true" weight="bold" />
        </Button>
      </div>
    </div>
  );
}

/**
 * The band selector and the selected band's fields: On, frequency, gain and Q
 * or slope as the band has them, then output trim. Every change is one
 * finished edit (`onChange`), sent at once.
 * @see docs/media.md
 */
export function BandEditor({
  eq,
  selected,
  locked,
  onSelect,
  slow,
  onChange,
  onTrim,
}: {
  eq: VenueSettings;
  selected: number;
  slow: boolean;
  locked: boolean;
  onSelect: (index: number) => void;
  onChange: (index: number, change: Partial<VenueBand>) => void;
  onTrim: (trimDb: number) => void;
}) {
  const band = eq.bands[selected]!;
  const info = BANDS[selected]!;
  const pass = isPass(selected);
  return (
    <>
      <div
        className="grid min-w-0 grid-cols-7 gap-1 [&_small]:text-[0.625rem] [&_small]:whitespace-nowrap [&>button]:flex-col [&>button]:gap-0 [&>button]:px-0 [&>button]:py-1 [&>button[aria-pressed=true]]:bg-foreground [&>button[aria-pressed=true]]:text-background [&>button[data-off]]:border-dashed"
        role="group"
        aria-label="Bands"
      >
        {eq.bands.map((item, index) => (
          <Button
            key={BANDS[index]!.short}
            variant="outline"
            aria-pressed={selected === index}
            data-off={!item.enabled || undefined}
            onClick={() => onSelect(index)}
          >
            {BANDS[index]!.short}
            {item.enabled ? (
              <small>
                <span className="max-[599px]:hidden">
                  {formatHz(item.freqHz)}
                </span>
                <span className="min-[600px]:hidden">
                  {formatHzShort(item.freqHz)}
                </span>
              </small>
            ) : (
              <small>off</small>
            )}
            <span className="sr-only">{BANDS[index]!.name}</span>
          </Button>
        ))}
      </div>
      <div
        className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10.5rem),1fr))] items-end gap-3"
        aria-label={`${info.name} settings`}
        role="group"
      >
        <label className="flex min-h-control min-w-0 items-center gap-3 self-end pb-1 text-sm font-medium">
          {info.name}
          <Switch
            aria-label={`${info.name} on`}
            checked={band.enabled}
            disabled={locked}
            onCheckedChange={(enabled) => onChange(selected, { enabled })}
          />
        </label>
        <StepField
          label="Frequency"
          value={formatHz(band.freqHz)}
          disabled={locked}
          onStep={(direction) =>
            onChange(selected, {
              freqHz: stepHz(selected, band.freqHz, direction),
              enabled: true,
            })
          }
        />
        {pass ? (
          <div className="grid min-w-0 gap-1 [&>span]:text-xs [&>span]:small-caps [&>span]:text-muted-foreground">
            <span>Slope</span>
            <div
              className="flex flex-wrap [&>button]:flex-1"
              role="group"
              aria-label="Slope"
            >
              {[false, true].map((steep) => (
                <Button
                  key={String(steep)}
                  size="sm"
                  variant={!!band.steep === steep ? 'default' : 'outline'}
                  aria-pressed={!!band.steep === steep}
                  aria-label={steep ? '24 dB per octave' : '12 dB per octave'}
                  disabled={locked}
                  onClick={() => onChange(selected, { steep, enabled: true })}
                >
                  {steep ? '24' : '12 dB/oct'}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <StepField
            label="Gain"
            value={
              slow ? (
                formatDb(band.gainDb ?? 0)
              ) : (
                <NumberField
                  size="sm"
                  label={info.name + ' gain'}
                  value={band.gainDb ?? 0}
                  min={-GAIN_LIMIT}
                  max={GAIN_LIMIT}
                  step={0.5}
                  unit="dB"
                  digits={1}
                  disabled={locked}
                  onChange={(gainDb) =>
                    onChange(selected, { gainDb, enabled: true })
                  }
                />
              )
            }
            disabled={locked}
            onStep={(direction) =>
              onChange(selected, {
                gainDb: clamp(
                  (band.gainDb ?? 0) + direction * 0.5,
                  -GAIN_LIMIT,
                  GAIN_LIMIT,
                ),
                enabled: true,
              })
            }
          />
        )}
        {info.kind === 'bell' && (
          <StepField
            label="Q"
            value={(band.q ?? 1).toFixed(2)}
            disabled={locked}
            onStep={(direction) =>
              onChange(selected, {
                q: stepQ(band.q ?? 1, direction),
                enabled: true,
              })
            }
          />
        )}
      </div>
      <div className="grid max-w-56 min-w-0 items-end gap-3">
        <StepField
          label="Output trim"
          value={formatDb(eq.trimDb)}
          disabled={locked}
          onStep={(direction) =>
            onTrim(clamp(eq.trimDb + direction * 0.5, TRIM_MIN, TRIM_MAX))
          }
        />
      </div>
    </>
  );
}
