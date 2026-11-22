import { ArrowCounterClockwise, MagnifyingGlass } from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import { CollapsibleSection } from '../components/ui/collapsible';
import { NumberField } from '../components/ui/number-field';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Caption } from '../components/ui/text';
import { glyphFor } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { controlLabel } from '../lib/plugin';
import { BlockGlyph } from '../widgets/block-glyph';
import { type BlockSource, SourceLine } from '../widgets/block-source';

/** One control of a plugin, as LV2 describes it. Only `symbol` and the range are certain. */
export type PluginControl = {
  symbol: string;
  /** The plugin's own name for it (`lv2:name`); without one the symbol is tidied up. */
  name?: string;
  /** The plugin's group for it (`pg:group`), such as "Tone" or "Modulation". */
  group?: string;
  /** Declared group identity; two groups may have the same visible label. */
  groupId?: string;
  /** Its unit (`units:unit`): dB, Hz, ms, s, %. */
  unit?: string;
  kind: 'range' | 'toggle' | 'choice';
  min: number;
  max: number;
  default?: number;
  value: number;
  display?: string;
  integer?: boolean;
  /** Named values (`lv2:scalePoint`), for a choice. */
  choices?: { value: number; label: string }[];
  /** The plugin says it matters most (`pprops:displayPriority`, from LV2 Port Properties): higher shows first. */
  priority?: number;
  /** The plugin asks hosts not to show it (`notOnGUI`). */
  hidden?: boolean;
};

export type PluginView = {
  name: string;
  /** Such as "Delay" or "Compressor". */
  category?: string;
  author?: string;
  /** What it does, in the maker's words (`rdfs:comment`). */
  description?: string;
  homepage?: string;
  /** A picture of it, served by the device. */
  artwork?: string;
  origin?: BlockSource;
};

const differsFromDefault = (control: PluginControl) =>
  control.default !== undefined && control.value !== control.default;

const digitsOf = (c: PluginControl) =>
  c.integer ? 0 : c.max - c.min <= 2 ? 2 : c.max - c.min <= 40 ? 1 : 0;

/**
 * Any LV2 plugin, presented the same careful way whoever made it: its
 * picture (or a glyph), name, maker and what it does at the top; the few
 * controls that matter most as large fields; the rest folded into the
 * plugin's own groups, with a search when there are many. Switches are
 * switches, named values are choices, numbers carry their unit. A dot marks
 * controls that differ from their factory defaults.
 *
 * It works with what a plugin gives: with only symbols and ranges it still
 * shows every control, labelled from the symbol, in one list.
 */
export function PluginPanel({
  plugin,
  controls,
  on,
  onToggle,
  toggleLabel,
  onControl,
  onAdjust,
  disabled = false,
  onRestoreDefaults,
  renderRange,
  mainCount = 6,
  className,
}: {
  plugin: PluginView;
  controls: PluginControl[];
  on: boolean;
  onToggle?: (on: boolean) => void;
  toggleLabel?: string;
  onControl: (symbol: string, value: number) => void;
  /** Opens the host’s live adjustment dialog for a range control. */
  onAdjust?: (symbol: string) => void;
  disabled?: boolean;
  /** Restores the factory defaults for the visible controls in one operation. */
  onRestoreDefaults?: () => void;
  /** A host-owned adjustment field that keeps its existing edit transaction. */
  renderRange?: (control: PluginControl) => React.ReactNode;
  /** How many controls show large at the top. */
  mainCount?: number;
  className?: string;
}) {
  const [query, setQuery] = React.useState('');
  const [broken, setBroken] = React.useState(false);
  const [seenArtwork, setSeenArtwork] = React.useState(plugin.artwork);
  if (seenArtwork !== plugin.artwork) {
    setSeenArtwork(plugin.artwork);
    setBroken(false);
  }
  const switchId = React.useId();
  const shown = controls.filter((c) => !c.hidden);
  const ranked = [...shown].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );
  const main = ranked.slice(0, mainCount);
  const rest = shown.filter((c) => !main.includes(c));
  const matches = (c: PluginControl) =>
    `${controlLabel(c)} ${c.group ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const groupId = (c: PluginControl) => c.groupId ?? c.group ?? 'More controls';
  const groups = [...new Set(rest.map(groupId))];
  const nonDefaultCount = shown.filter(differsFromDefault).length;
  const allDefaultsKnown =
    shown.length > 0 && shown.every((c) => c.default !== undefined);

  const field = (c: PluginControl, large = false) => {
    const label = controlLabel(c);
    const dot = differsFromDefault(c) && (
      <span
        aria-label="Differs from factory default"
        role="img"
        className="size-1.5 shrink-0 rounded-full bg-brand"
      />
    );
    const heading = (
      <span className="flex min-w-0 items-center gap-1.5 small-caps text-xs text-muted-foreground">
        <span className={c.kind === 'toggle' ? 'leading-tight' : 'truncate'}>
          {label}
        </span>
        {dot}
      </span>
    );
    if (c.kind === 'range' && renderRange)
      return (
        <div key={c.symbol} className="grid min-w-0 gap-1">
          {heading}
          {renderRange(c)}
        </div>
      );
    if (c.kind === 'toggle')
      return (
        <label
          key={c.symbol}
          className="flex min-h-touch min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-background px-3"
        >
          {heading}
          <Switch
            aria-label={label}
            checked={c.value !== c.min}
            disabled={disabled}
            onCheckedChange={(v) => onControl(c.symbol, v ? c.max : c.min)}
          />
        </label>
      );
    if (c.kind === 'choice' && c.choices?.length)
      return (
        <div
          key={c.symbol}
          className="col-span-2 grid min-w-0 gap-1 sm:col-span-3"
        >
          {heading}
          {c.choices.length <= 3 ? (
            <SegmentedControl
              size="sm"
              disabled={disabled}
              value={String(c.value)}
              onValueChange={(v) => v && onControl(c.symbol, Number(v))}
              aria-label={label}
              className="w-full"
            >
              {c.choices.map((p) => (
                <Segment
                  key={p.value}
                  value={String(p.value)}
                  className="min-h-touch px-2 py-1 [overflow-wrap:anywhere] whitespace-normal [[data-size=sm]_&]:h-auto"
                >
                  {p.label}
                </Segment>
              ))}
            </SegmentedControl>
          ) : (
            <Select
              disabled={disabled}
              value={String(c.value)}
              onValueChange={(v) => onControl(c.symbol, Number(v))}
            >
              <SelectTrigger aria-label={label} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {c.choices.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      );
    if (onAdjust)
      return (
        <div key={c.symbol} className="grid min-w-0 gap-1">
          {heading}
          <PluginAdjustValue
            control={c}
            large={large}
            disabled={disabled}
            onAdjust={onAdjust}
          />
        </div>
      );
    return (
      <div key={c.symbol} className="grid gap-1">
        {heading}
        <NumberField
          label={label}
          disabled={disabled}
          size={large ? 'lg' : 'md'}
          value={c.value}
          min={c.min}
          max={c.max}
          step={c.integer ? 1 : (c.max - c.min) / 100}
          unit={c.unit ? ` ${c.unit}` : ''}
          digits={digitsOf(c)}
          onChange={(v) => onControl(c.symbol, v)}
        />
      </div>
    );
  };

  return (
    <section
      data-slot="plugin-panel"
      aria-label={`${plugin.name} controls`}
      className={cn('grid gap-4', className)}
    >
      <header className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto]">
        <div className="grid aspect-[5/3] w-16 place-items-center overflow-hidden rounded-md border border-border bg-background sm:w-20">
          {plugin.artwork && !broken ? (
            <img
              src={plugin.artwork}
              alt=""
              loading="lazy"
              onError={() => setBroken(true)}
              className="size-full object-cover"
            />
          ) : (
            <BlockGlyph
              glyph={glyphFor('', `${plugin.category ?? ''} ${plugin.name}`)}
              className="size-8 text-muted-foreground"
            />
          )}
        </div>
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-display text-xl leading-tight font-semibold">
            {plugin.name}
          </span>
          {plugin.category && (
            <span className="small-caps text-xs text-muted-foreground">
              {plugin.category}
            </span>
          )}
          {plugin.origin ? (
            <SourceLine source={plugin.origin} />
          ) : (
            plugin.author && (
              <span className="text-xs text-muted-foreground">
                {plugin.author}
              </span>
            )
          )}
        </div>
        {onToggle && (
          <label
            htmlFor={switchId}
            // On a narrow phone the switch takes its own line under the name.
            className="col-span-2 flex items-center justify-between gap-2 text-sm font-medium sm:col-span-1 sm:justify-start"
          >
            {on ? 'On' : 'Off'}
            <Switch
              id={switchId}
              aria-label={toggleLabel}
              checked={on}
              disabled={disabled}
              onCheckedChange={onToggle}
            />
          </label>
        )}
      </header>
      {plugin.description && (
        <Caption className="text-sm">{plugin.description}</Caption>
      )}

      {plugin.homepage && (
        <a
          href={plugin.homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-sm underline"
        >
          Plugin website
        </a>
      )}

      <div
        role="group"
        aria-label="Main controls"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        {main.map((c) => field(c, true))}
      </div>

      {rest.length > 0 && (
        <div className="grid gap-2">
          {rest.length > 8 && (
            <label className="relative">
              <span className="sr-only">Find a control</span>
              <MagnifyingGlass
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Find among ${rest.length} more controls`}
                className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-9 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>
          )}
          {groups.map((group) => {
            const list = rest.filter((c) => groupId(c) === group && matches(c));
            if (!list.length) return null;
            const nonDefault = list.filter(differsFromDefault).length;
            return (
              <CollapsibleSection
                key={group}
                open={query ? true : undefined}
                title={
                  <span className="flex items-baseline gap-2">
                    {list[0]?.group ?? 'More controls'}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {list.length}
                      {nonDefault > 0 && ` · ${nonDefault} off default`}
                    </span>
                  </span>
                }
              >
                <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
                  {list.map((c) => field(c))}
                </div>
              </CollapsibleSection>
            );
          })}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <Caption as="span" role="status" className="text-xs">
          {shown.length} controls
          {nonDefaultCount > 0
            ? ` · ${nonDefaultCount} ${nonDefaultCount === 1 ? 'differs' : 'differ'} from factory defaults`
            : allDefaultsKnown && ' · all at factory defaults'}
        </Caption>
        {onRestoreDefaults && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || nonDefaultCount === 0}
            onClick={onRestoreDefaults}
          >
            <ArrowCounterClockwise /> Restore factory defaults
          </Button>
        )}
      </footer>
    </section>
  );
}

/** Read a live value and open its host-owned adjustment dialog. @see PluginPanel */
export function PluginAdjustValue({
  control,
  large,
  disabled,
  onAdjust,
}: {
  control: PluginControl;
  large?: boolean;
  disabled?: boolean;
  onAdjust: (symbol: string) => void;
}) {
  const display = control.display ?? String(control.value);
  const unitSuffix = control.unit ? ` ${control.unit}` : '';
  const withUnit = Boolean(unitSuffix && display.endsWith(unitSuffix));
  return (
    <Button
      variant="outline"
      className={cn(
        'min-h-touch min-w-0 justify-end gap-0.5 font-mono font-normal tabular-nums',
        large && 'text-xl',
      )}
      disabled={disabled}
      aria-label={`Adjust ${controlLabel(control)}`}
      aria-haspopup="dialog"
      onClick={() => onAdjust(control.symbol)}
    >
      <span className="min-w-0 truncate">
        {withUnit ? display.slice(0, -unitSuffix.length) : display}
      </span>
      {withUnit && (
        <span className="text-xs text-muted-foreground">{unitSuffix}</span>
      )}
    </Button>
  );
}
