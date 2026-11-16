import { SpeakerSlash, Headphones } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Slider } from '../components/ui/slider';
import { Toggle } from '../components/ui/toggle';

export type StemRole =
  'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other';

export type StemControls = { level: number; muted: boolean; solo: boolean };

const LABELS: Record<StemRole, string> = {
  vocals: 'Vocals',
  drums: 'Drums',
  bass: 'Bass',
  guitar: 'Guitar',
  piano: 'Piano',
  other: 'Other',
};

/**
 * One stem: a fader for its level (−60 to +6 dB), Mute and Solo toggles
 * and the role name. `heard` is false when another stem's solo or this
 * one's mute silences it; the strip dims and says so.
 */
export function StemStrip({
  role,
  controls,
  heard = true,
  disabled = false,
  onChange,
  onCommit,
  className,
}: {
  role: StemRole;
  controls: StemControls;
  heard?: boolean;
  disabled?: boolean;
  onChange: (next: StemControls) => void;
  onCommit?: () => void;
  className?: string;
}) {
  const label = LABELS[role];
  return (
    <div
      data-slot="stem-strip"
      data-role={role}
      data-heard={heard || undefined}
      className={cn(
        'grid h-full w-16 grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-2',
        className,
      )}
    >
      <Slider
        orientation="vertical"
        label={label}
        min={-60}
        max={6}
        step={0.5}
        value={[controls.level]}
        onValueChange={([level]) =>
          onChange({ ...controls, level: level ?? controls.level })
        }
        onValueCommit={onCommit}
        readout={controls.level <= -60 ? '−∞' : controls.level.toFixed(0)}
        disabled={disabled}
        className={cn(
          !heard && '[&_[data-slot=slider]>span]:text-muted-foreground',
        )}
      />
      <div className="grid gap-1">
        <Toggle
          size="sm"
          aria-label={`Mute ${label}`}
          pressed={controls.muted}
          disabled={disabled}
          onPressedChange={(muted) => onChange({ ...controls, muted })}
          className="h-8 w-12 px-0"
        >
          <SpeakerSlash />
        </Toggle>
        <Toggle
          size="sm"
          aria-label={`Solo ${label}`}
          pressed={controls.solo}
          disabled={disabled}
          onPressedChange={(solo) => onChange({ ...controls, solo })}
          className="h-8 w-12 px-0"
        >
          <Headphones />
        </Toggle>
      </div>
    </div>
  );
}

/** The strips in a row; scrolls sideways on phones. */
export function StemMixer({
  stems,
  disabled = false,
  onChange,
  onCommit,
  className,
}: {
  stems: Partial<Record<StemRole, StemControls>>;
  disabled?: boolean;
  onChange: (role: StemRole, next: StemControls) => void;
  onCommit?: () => void;
  className?: string;
}) {
  const roles = Object.keys(stems) as StemRole[];
  const anySolo = roles.some((role) => stems[role]?.solo);
  return (
    <div
      data-slot="stem-mixer"
      role="group"
      aria-label="Stems"
      className={cn('flex h-64 gap-3 overflow-x-auto px-1 pb-1', className)}
    >
      {roles.map((role) => {
        const controls = stems[role]!;
        return (
          <StemStrip
            key={role}
            role={role}
            controls={controls}
            heard={!controls.muted && (!anySolo || controls.solo)}
            disabled={disabled}
            onChange={(next) => onChange(role, next)}
            onCommit={onCommit}
          />
        );
      })}
    </div>
  );
}
