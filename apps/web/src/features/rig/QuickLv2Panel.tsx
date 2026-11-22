import { useState } from 'react';

import { Slider } from '@oxidal/design-system/components/slider';
import { controlLabel } from '@oxidal/design-system/lib/plugin';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import {
  PluginAdjustValue,
  type PluginControl,
} from '@oxidal/design-system/patterns/plugin-panel';
import { BlockQuickEditor } from '@oxidal/design-system/widgets/block-editor';
import { VisualControl } from '@oxidal/design-system/widgets/visual-control';

import type { RigControl } from '../../api';
import type { quickEffectLayout } from '../../lv2PluginPanel';

type QuickEffectLayout = NonNullable<ReturnType<typeof quickEffectLayout>>;

function QuickSlider({
  control,
  step,
  disabled,
  onCommit,
}: {
  control: PluginControl;
  step: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number>();
  return (
    <Slider
      label={controlLabel(control)}
      value={[draft ?? control.value]}
      min={control.min}
      max={control.max}
      step={step}
      readout={
        draft === undefined
          ? control.display
          : `${Number(draft.toPrecision(5))}${control.unit ? ` ${control.unit}` : ''}`
      }
      disabled={disabled}
      onValueChange={([value]) => setDraft(value)}
      onValueCommit={([value]) => {
        setDraft(undefined);
        if (value !== undefined && value !== control.value) onCommit(value);
      }}
      onPointerCancel={() => setDraft(undefined)}
    />
  );
}

/** The live editor for the principal settings of an Oxidal effect. @see docs/lv2.md */
export function QuickLv2Panel({
  id,
  name,
  layout,
  controls,
  bypass,
  disabled,
  onControl,
  onGesture,
  onToggle,
  onAdjust,
  onAll,
}: {
  id: string;
  name: string;
  layout: QuickEffectLayout;
  controls: PluginControl[];
  bypass: RigControl;
  disabled: boolean;
  onControl: (symbol: string, value: number) => void;
  onGesture: (values: [string, number][]) => void;
  onToggle: (on: boolean) => void;
  onAdjust: (symbol: string) => void;
  onAll: () => void;
}) {
  const narrow = useVerticalRig();
  const ranges = new Map(
    controls
      .filter((control) => !control.hidden && control.kind === 'range')
      .map((control) => [control.symbol, control]),
  );
  const visible = controls.filter((control) => !control.hidden);
  const main: readonly string[] = layout.main;
  const block = {
    id,
    label: name,
    kind: layout.role === 'mod' ? ('mod' as const) : ('time' as const),
    role: layout.role,
    on: bypass.value !== 1,
    controls: [
      ...main,
      ...visible
        .map((control) => control.symbol)
        .filter((symbol) => !main.includes(symbol)),
    ].flatMap((symbol) => {
      const control = visible.find((item) => item.symbol === symbol);
      return control
        ? [
            {
              id: symbol,
              label: controlLabel(control),
              value: control.value,
              min: control.min,
              max: control.max,
              step: control.integer ? 1 : (control.max - control.min) / 1000,
              unit: control.unit,
              main: main.includes(symbol) && control.kind === 'range',
            },
          ]
        : [];
    }),
  };
  return (
    <BlockQuickEditor
      block={block}
      layout={narrow ? 'sheet' : 'popover'}
      onControl={onControl}
      onToggle={onToggle}
      onAll={onAll}
      disabled={disabled}
      visual={
        <VisualControl
          kind={block.kind}
          role={block.role}
          controls={block.controls.filter((control) => ranges.has(control.id))}
          onControl={onControl}
          onCommit={onGesture}
          disabled={disabled}
          className="h-20 rounded-lg border border-border bg-background px-2 py-1 text-foreground"
        />
      }
      renderSlider={(control) => (
        <QuickSlider
          control={ranges.get(control.id)!}
          step={control.step ?? 1}
          disabled={disabled}
          onCommit={(value) => onControl(control.id, value)}
        />
      )}
      renderValue={(control) => (
        <PluginAdjustValue
          control={ranges.get(control.id)!}
          disabled={disabled}
          onAdjust={onAdjust}
        />
      )}
    />
  );
}
