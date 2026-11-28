import {
  ArrowsLeftRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Faders,
} from '@phosphor-icons/react';
import { type ComponentProps, type ReactNode, useId } from 'react';

import { Button } from '../components/ui/button';
import { NumberField } from '../components/ui/number-field';
import { Caption, Eyebrow, Label, Title } from '../components/ui/text';
import type { GlyphKey } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { BlockDock } from './block-dock';
import { type BlockSource, SourceLine, SourcePicture } from './block-source';

export function SelectedBlockPanel({
  title,
  caption,
  position,
  source,
  glyph,
  pictureUrl,
  on,
  onPrevious,
  onNext,
  onMinimise,
  minimised,
  onExpand,
  preview,
  renderSwitch,
  onChange,
  changeDisabled,
  onAllControls,
  controlCount,
  allControls,
  switchLabel,
  beforeBypass,
  modelStepper,
  actions,
  visual,
  controls,
  className,
}: {
  title: string;
  caption: string;
  position: string;
  source?: BlockSource;
  glyph?: GlyphKey;
  pictureUrl?: string;
  on: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onMinimise: () => void;
  minimised?: boolean;
  onExpand?: () => void;
  preview?: string;
  renderSwitch: (id: string) => ReactNode;
  onChange?: () => void;
  changeDisabled?: boolean;
  onAllControls: () => void;
  controlCount: number;
  /**
   * Every control, shown in place under the curve (a laptop or wider), so
   * tone chasing needs no sheet. Present while open; All controls closes it.
   */
  allControls?: ReactNode;
  /**
   * What the switch turns on, when it is not this block alone: an engine
   * with one switch for all its effects says "All effects".
   */
  switchLabel?: string;
  beforeBypass?: ReactNode;
  modelStepper?: ReactNode;
  actions?: ReactNode;
  visual?: ReactNode;
  controls: ReactNode;
  className?: string;
}) {
  const switchId = useId();
  const neighbours = (
    <>
      {' '}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous block"
        disabled={!onPrevious}
        onClick={onPrevious}
      >
        <CaretLeft />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next block"
        disabled={!onNext}
        onClick={onNext}
      >
        <CaretRight />
      </Button>
    </>
  );
  if (minimised && onExpand)
    return (
      <section
        aria-label={`${title} controls`}
        data-minimised
        className={cn(
          'flex items-center gap-3 rounded-xl border border-foreground/70 bg-raised px-3 py-2 shadow-raised',
          !on && 'border-dashed',
          className,
        )}
      >
        <SourcePicture
          source={source}
          glyph={glyph}
          pictureUrl={pictureUrl}
          className="size-10"
        />
        <div className="grid min-w-0 shrink-0 gap-0.5">
          <Title as="h2" size="sm" className="truncate" title={title}>
            {title}
          </Title>
          <Caption as="span" className="truncate small-caps text-xs">
            {caption}
          </Caption>
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-sm tabular-nums max-lg:hidden">
          {preview}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {neighbours}
          <label htmlFor={switchId} className="sr-only">
            {title} on
          </label>
          {renderSwitch(switchId)}
          <Button size="sm" variant="ghost" className="ml-2" onClick={onExpand}>
            <CaretUp /> Show controls
          </Button>
        </span>
      </section>
    );
  return (
    <BlockDock
      aria-label={`${title} controls`}
      bypassed={!on}
      className={className}
    >
      <div
        className="grid content-start gap-2.5"
        data-slot="block-panel-identity"
      >
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1">
            <Eyebrow className="min-w-0 flex-1 truncate">{position}</Eyebrow>
            {neighbours}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Minimise controls"
              title="Minimise, to see more of the rig"
              onClick={onMinimise}
            >
              <CaretDown />
            </Button>
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <SourcePicture
              source={source}
              glyph={glyph}
              pictureUrl={pictureUrl}
              className="size-16"
            />
            <div className="grid min-w-0 gap-0.5">
              <Title as="h2" size="sm" className="truncate" title={title}>
                {title}
              </Title>
              <Caption as="span" className="truncate small-caps text-xs">
                {caption}
              </Caption>
              {source && <SourceLine source={source} />}
            </div>
          </div>
        </div>
        {beforeBypass}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
          <label htmlFor={switchId} className="text-sm font-medium">
            {switchLabel
              ? `${switchLabel} ${on ? 'on' : 'off'}`
              : on
                ? 'Block on'
                : 'Bypassed'}
          </label>
          {renderSwitch(switchId)}
        </div>
        {modelStepper}
        <div className="flex flex-wrap gap-2">
          {onChange && (
            <Button
              size="sm"
              variant="outline"
              disabled={changeDisabled}
              onClick={onChange}
              aria-label={`Change ${title}…`}
            >
              <ArrowsLeftRight /> Change…
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-expanded={allControls ? true : undefined}
            onClick={onAllControls}
          >
            {allControls ? <CaretUp /> : <Faders />}
            {allControls
              ? 'Fewer controls'
              : `All controls${controlCount > 0 ? ` · ${controlCount}` : ''}`}
          </Button>
          {actions}
        </div>
      </div>
      {/* On a laptop the drawing fills its column's height: no empty band
          under it beside a taller block column. */}
      <div
        className="min-w-0 lg:relative lg:min-h-32 lg:self-stretch lg:[&>*]:absolute lg:[&>*]:inset-0 lg:[&>*]:h-auto"
        data-slot="block-panel-visual"
      >
        {visual}
      </div>
      <div
        className="grid min-w-0 grid-cols-2 content-start gap-x-3 gap-y-2"
        data-slot="block-panel-controls"
      >
        {controls}
      </div>
      {allControls && (
        <div
          className="grid min-w-0 gap-3 border-t border-border pt-3 lg:col-span-2 lg:col-start-2"
          role="region"
          aria-label={`${title}: every control`}
          data-slot="block-panel-all"
        >
          {allControls}
        </div>
      )}
    </BlockDock>
  );
}

export function BlockPanelControl({
  caption,
  field,
  wrap,
}: {
  caption: string;
  field: ComponentProps<typeof NumberField>;
  wrap?: (control: ReactNode) => ReactNode;
}) {
  const input = (
    <NumberField {...field} className={cn('w-full min-w-0', field.className)} />
  );
  return (
    <div className="grid min-w-0 gap-0.5">
      <Label as="span" className="small-caps text-xs text-muted-foreground">
        {caption}
      </Label>
      {wrap ? wrap(input) : input}
    </div>
  );
}

export const blockPanelVisualClass =
  'h-32 rounded-lg border border-border bg-background px-2 py-1 text-foreground';
