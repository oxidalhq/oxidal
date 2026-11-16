import * as React from 'react';
import { ArrowsClockwise, Faders } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { Badge, Led } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { NumberField } from '@/components/ui/number-field';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Caption, Label, Title } from '@/components/ui/text';
import { Toggle } from '@/components/ui/toggle';
import { BlockVisual } from './block-visuals';
import type { ChainBlockModel } from './chain';

export type BlockControl = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** The first `main` controls show first and in the quick strip. */
  main?: boolean;
  /** Group heading in the full editor (Tone, Time, Mix…). */
  group?: string;
};

export type BlockModel = ChainBlockModel & {
  /** Narrower than kind, for the drawing and the layout: delay, reverb, drive, gate. */
  role?: string;
  controls: BlockControl[];
  /** For amps and cabs: the model or impulse response, chosen from a list. */
  source?: { label: string; value: string; options: ComboboxOption[] };
};

/**
 * The quick editor for one block: its drawing at the top, its main controls
 * as values you drag, the model or IR picker for amps and cabs, bypass, and
 * "All controls" for the sheet. On laptops it is a popover anchored to the
 * block in the chain; on phones it is a bottom sheet. This is where
 * complex blocks (delay, cab, reverb) must stay simple: the drawing shows
 * what the values do, so the words can stay short.
 */
export function BlockQuickEditor({
  block,
  onControl,
  onToggle,
  onSource,
  onAll,
  layout = 'popover',
  className,
}: {
  block: BlockModel;
  onControl: (control: string, value: number) => void;
  onToggle: (on: boolean) => void;
  onSource?: (value: string | null) => void;
  onAll: () => void;
  /**
   * `sheet` (phones) draws the main values as full-width sliders with
   * readouts, so a thumb sets them without the keyboard taking the screen;
   * `popover` (laptops) draws drag-or-type fields in two columns.
   */
  layout?: 'popover' | 'sheet';
  className?: string;
}) {
  const values = Object.fromEntries(block.controls.map((c) => [c.id, c.value]));
  const main = block.controls.filter((c) => c.main).slice(0, 4);
  return (
    <div data-slot="block-quick-editor" className={cn('grid gap-3', className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
        <Led kind={block.kind} on={block.on} />
        <div className="grid min-w-0">
          <Title as="h2" size="sm" className="truncate">
            {block.label}
          </Title>
          <Caption as="span" className="small-caps text-xs">
            {block.caption ?? block.kind}
          </Caption>
        </div>
        <Toggle
          size="sm"
          pressed={block.on}
          onPressedChange={onToggle}
          aria-label={`${block.label} on`}
        >
          {block.on ? 'On' : 'Off'}
        </Toggle>
      </div>
      <div
        className={cn(
          'rounded-lg border border-border bg-background px-2 py-1 text-foreground',
          !block.on && 'text-muted-foreground',
        )}
      >
        <BlockVisual
          kind={block.kind}
          role={block.role}
          values={values}
          className="h-14 w-full"
        />
      </div>
      {block.source && onSource && (
        <div className="grid gap-1">
          <Label as="span" className="small-caps text-xs text-muted-foreground">
            {block.source.label}
          </Label>
          <Combobox
            label={block.source.label}
            options={block.source.options}
            value={block.source.value}
            onChange={onSource}
            placeholder={`Search ${block.source.label.toLowerCase()}…`}
          />
        </div>
      )}
      {layout === 'sheet' ? (
        <div className="grid gap-4">
          {main.map((control) => (
            <Slider
              key={control.id}
              label={control.label}
              min={control.min}
              max={control.max}
              step={control.step ?? 0.5}
              value={[control.value]}
              onValueChange={([value]) =>
                value !== undefined && onControl(control.id, value)
              }
              readout={`${control.value.toFixed(control.step && control.step >= 1 ? 0 : 1)}${control.unit ? ` ${control.unit}` : ''}`}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {main.map((control) => (
            <div key={control.id} className="grid gap-0.5">
              <Label
                as="span"
                className="small-caps text-xs text-muted-foreground"
              >
                {control.label}
              </Label>
              <NumberField
                size="sm"
                className="w-full"
                label={`${block.label} ${control.label}`}
                value={control.value}
                min={control.min}
                max={control.max}
                step={control.step ?? 0.5}
                fine={(control.step ?? 0.5) / 5}
                unit={control.unit}
                digits={control.step && control.step >= 1 ? 0 : 1}
                onChange={(value) => onControl(control.id, value)}
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {block.unsaved ? <Badge tone="warning">Unsaved</Badge> : <span />}
        <Button size="sm" variant="ghost" onClick={onAll}>
          <Faders /> All controls
          {block.controls.length > main.length && (
            <span className="text-muted-foreground">
              · {block.controls.length}
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

/** Every control of the block, grouped, as sliders with readouts. */
export function BlockFullEditor({
  block,
  onControl,
  onReset,
}: {
  block: BlockModel;
  onControl: (control: string, value: number) => void;
  onReset?: () => void;
}) {
  const groups = new Map<string, BlockControl[]>();
  for (const control of block.controls) {
    const key = control.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), control]);
  }
  const values = Object.fromEntries(block.controls.map((c) => [c.id, c.value]));
  return (
    <div data-slot="block-full-editor" className="grid gap-5">
      <div className="rounded-lg border border-border bg-background px-2 py-1">
        <BlockVisual
          kind={block.kind}
          role={block.role}
          values={values}
          className="h-20 w-full"
        />
      </div>
      {[...groups.entries()].map(([group, controls]) => (
        <section key={group} className="grid gap-3">
          {group && (
            <h3 className="m-0 small-caps text-sm font-medium text-muted-foreground">
              {group}
            </h3>
          )}
          {controls.map((control) => (
            <Slider
              key={control.id}
              label={control.label}
              min={control.min}
              max={control.max}
              step={control.step ?? 0.5}
              value={[control.value]}
              onValueChange={([value]) =>
                value !== undefined && onControl(control.id, value)
              }
              readout={`${control.value.toFixed(control.step && control.step >= 1 ? 0 : 1)}${control.unit ? ` ${control.unit}` : ''}`}
            />
          ))}
        </section>
      ))}
      {onReset && (
        <Button variant="outline" size="sm" className="w-fit" onClick={onReset}>
          <ArrowsClockwise /> Reset to saved
        </Button>
      )}
    </div>
  );
}

/**
 * Anchors the quick editor to the block on `md+` (popover) and opens it as
 * a bottom sheet below; the full editor is always a sheet. `anchor` is the
 * block's element in the chain.
 */
export function BlockEditor({
  block,
  open,
  onOpenChange,
  anchor,
  onControl,
  onToggle,
  onSource,
  onReset,
}: {
  block: BlockModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: HTMLElement | null;
  onControl: (block: string, control: string, value: number) => void;
  onToggle: (block: string, on: boolean) => void;
  onSource?: (block: string, value: string | null) => void;
  onReset?: (block: string) => void;
}) {
  const [full, setFull] = React.useState(false);
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 47.99rem)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  if (!block) return null;
  const quick = (
    <BlockQuickEditor
      block={block}
      onControl={(control, value) => onControl(block.id, control, value)}
      onToggle={(on) => onToggle(block.id, on)}
      onSource={onSource ? (value) => onSource(block.id, value) : undefined}
      onAll={() => {
        onOpenChange(false);
        setFull(true);
      }}
      layout={phone ? 'sheet' : 'popover'}
    />
  );
  return (
    <>
      {phone ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            onOpenChange={onOpenChange}
            aria-describedby={undefined}
          >
            <SheetHeader
              title={block.label}
              description={block.caption ?? block.kind}
              className="sr-only"
            />
            <SheetBody>{quick}</SheetBody>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverAnchor
            virtualRef={anchor ? { current: anchor } : undefined}
          />
          <PopoverContent
            side="bottom"
            align="start"
            className="w-80"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            {quick}
          </PopoverContent>
        </Popover>
      )}
      <Sheet open={full} onOpenChange={setFull}>
        <SheetContent onOpenChange={setFull}>
          <SheetHeader
            title={block.label}
            description={block.caption ?? block.kind}
          >
            <div className="mt-1 flex gap-1">
              {!block.on && <Badge tone="warning">Off</Badge>}
              {block.unsaved && <Badge tone="warning">Unsaved</Badge>}
            </div>
          </SheetHeader>
          <SheetBody>
            <BlockFullEditor
              block={block}
              onControl={(control, value) =>
                onControl(block.id, control, value)
              }
              onReset={onReset ? () => onReset(block.id) : undefined}
            />
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => setFull(false)}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
