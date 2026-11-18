import * as React from 'react';

import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Switch } from '../components/ui/switch';
import { Caption } from '../components/ui/text';

export type SceneChangeSettings = {
  mode: 'trails' | 'blend';
  fadeMs: number;
  /** Let the preset you leave ring out under the next one. */
  presetTrails: boolean;
};

const FADES = [
  ['0', 'Cut'],
  ['30', '30 ms'],
  ['120', '120 ms'],
  ['500', 'Swell'],
] as const;

/**
 * How a change sounds (H-2). **Trails**: the scene you leave stops getting
 * guitar, so its delays and reverbs ring out. **Blend**: the whole scene you
 * leave fades out under the new one. The fade is how long the new scene
 * takes to come in. **Between presets** does the same for a preset change,
 * because the next preset is already warm in memory.
 */
export function SceneChange({
  value,
  onChange,
}: {
  value: SceneChangeSettings;
  onChange: (value: SceneChangeSettings) => void;
}) {
  const id = React.useId();
  return (
    <div
      data-slot="scene-change"
      className="grid gap-3 rounded-lg border border-border bg-card p-3"
    >
      <div className="grid gap-1.5">
        <span className="small-caps text-xs text-muted-foreground">
          When scenes change
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            value={value.mode}
            onValueChange={(mode) =>
              mode && onChange({ ...value, mode: mode as 'trails' | 'blend' })
            }
            aria-label="When scenes change"
          >
            <Segment value="trails">Trails</Segment>
            <Segment value="blend">Blend</Segment>
          </SegmentedControl>
          <SegmentedControl
            size="sm"
            value={String(value.fadeMs)}
            onValueChange={(fade) =>
              fade && onChange({ ...value, fadeMs: Number(fade) })
            }
            aria-label="Fade"
          >
            {FADES.map(([v, label]) => (
              <Segment key={v} value={v}>
                {label}
              </Segment>
            ))}
          </SegmentedControl>
        </div>
        <Caption className="text-xs">
          {value.mode === 'trails'
            ? 'The scene you leave stops getting guitar; its delays and reverbs ring out.'
            : 'The whole scene you leave fades out under the new one.'}{' '}
          {value.fadeMs === 0
            ? 'The new scene comes in at once.'
            : `The new scene comes in over ${value.fadeMs} ms.`}
        </Caption>
      </div>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={id} className="grid gap-0.5">
          <span className="text-sm font-semibold">
            Trails between presets too
          </span>
          <Caption as="span" className="text-xs">
            The preset you leave rings out while the next one plays. The next
            preset is already warm in memory, so there is no gap.
          </Caption>
        </label>
        <Switch
          id={id}
          checked={value.presetTrails}
          onCheckedChange={(presetTrails) =>
            onChange({ ...value, presetTrails })
          }
        />
      </div>
    </div>
  );
}
