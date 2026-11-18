import { Minus, Plus } from '@phosphor-icons/react';

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
import { Button } from '../ui/button';

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
  value: string;
  disabled: boolean;
  onStep: (direction: -1 | 1) => void;
}) {
  return (
    <div className="venue-field">
      <span>{label}</span>
      <div className="venue-step" role="group" aria-label={label}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Lower ${label}`}
          disabled={disabled}
          onClick={() => onStep(-1)}
        >
          <Minus aria-hidden="true" weight="bold" />
        </Button>
        <output aria-label={`${label} value`}>{value}</output>
        <Button
          variant="ghost"
          size="icon"
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
  onChange,
  onTrim,
}: {
  eq: VenueSettings;
  selected: number;
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
      <div className="venue-bands" role="group" aria-label="Bands">
        {eq.bands.map((item, index) => (
          <Button
            key={BANDS[index]!.short}
            variant="outline"
            aria-pressed={selected === index}
            aria-label={`${BANDS[index]!.name}${item.enabled ? '' : ', off'}`}
            data-off={!item.enabled || undefined}
            onClick={() => onSelect(index)}
          >
            {BANDS[index]!.short}
            {item.enabled ? (
              <small>
                <span className="venue-hz-long">{formatHz(item.freqHz)}</span>
                <span className="venue-hz-short">
                  {formatHzShort(item.freqHz)}
                </span>
              </small>
            ) : (
              <small>off</small>
            )}
          </Button>
        ))}
      </div>
      <div
        className="venue-fields"
        aria-label={`${info.name} settings`}
        role="group"
      >
        <div className="venue-field">
          <span>{info.name}</span>
          <Button
            variant={band.enabled ? 'default' : 'outline'}
            aria-pressed={band.enabled}
            aria-label={`${info.name} on`}
            disabled={locked}
            onClick={() => onChange(selected, { enabled: !band.enabled })}
          >
            {band.enabled ? 'On' : 'Off'}
          </Button>
        </div>
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
          <div className="venue-field">
            <span>Slope</span>
            <div className="venue-slope" role="group" aria-label="Slope">
              {[false, true].map((steep) => (
                <Button
                  key={String(steep)}
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
            value={formatDb(band.gainDb ?? 0)}
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
      <div className="venue-fields">
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
