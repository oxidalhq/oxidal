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
  /** Its unit (`units:unit`): dB, Hz, ms, s, %. */
  unit?: string;
  kind: 'range' | 'toggle' | 'choice';
  min: number;
  max: number;
  default: number;
  value: number;
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
  /** What it does, in the maker's words (`rdfs:comment`). */
  description?: string;
  /** A picture of it, served by the device. */
  artwork?: string;
  origin?: BlockSource;
};

const digitsOf = (c: PluginControl) =>
  c.integer ? 0 : c.max - c.min <= 2 ? 2 : c.max - c.min <= 40 ? 1 : 0;

/**
 * Any LV2 plugin, presented the same careful way whoever made it: its
 * picture (or a glyph), name, maker and what it does at the top; the few
 * controls that matter most as large fields; the rest folded into the
 * plugin's own groups, with a search when there are many. Switches are
 * switches, named values are choices, numbers carry their unit. A dot marks
 * what you changed from the plugin's defaults, and Reset puts it back.
 *
 * It works with what a plugin gives: with only symbols and ranges it still
 * shows every control, labelled from the symbol, in one list.
 */
export function PluginPanel({
  plugin,
  controls,
  on,
  onToggle,
  onControl,
  mainCount = 6,
  className,
}: {
  plugin: PluginView;
  controls: PluginControl[];
  on: boolean;
  onToggle: (on: boolean) => void;
  onControl: (symbol: string, value: number) => void;
  /** How many controls show large at the top. */
  mainCount?: number;
  className?: string;
}) {
  const [query, setQuery] = React.useState('');
  const [broken, setBroken] = React.useState(false);
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
  const groups = [...new Set(rest.map((c) => c.group ?? 'More controls'))];
  const changed = shown.filter((c) => c.value !== c.default);

  const field = (c: PluginControl, large = false) => {
    const label = controlLabel(c);
    const dot = c.value !== c.default && (
      <span
        aria-label="Changed"
        role="img"
        className="size-1.5 shrink-0 rounded-full bg-brand"
      />
    );
    const heading = (
      <span className="flex min-w-0 items-center gap-1.5 small-caps text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        {dot}
      </span>
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
            checked={c.value >= 0.5}
            onCheckedChange={(v) => onControl(c.symbol, v ? c.max : c.min)}
          />
        </label>
      );
    if (c.kind === 'choice' && c.choices?.length)
      return (
        <div key={c.symbol} className="grid gap-1">
          {heading}
          {c.choices.length <= 3 ? (
            <SegmentedControl
              size="sm"
              value={String(c.value)}
              onValueChange={(v) => v && onControl(c.symbol, Number(v))}
              aria-label={label}
              className="w-full"
            >
              {c.choices.map((p) => (
                <Segment key={p.value} value={String(p.value)}>
                  {p.label}
                </Segment>
              ))}
            </SegmentedControl>
          ) : (
            <Select
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
    return (
      <div key={c.symbol} className="grid gap-1">
        {heading}
        <NumberField
          label={label}
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
          {plugin.origin && <SourceLine source={plugin.origin} />}
        </div>
        <label
          htmlFor={switchId}
          // On a narrow phone the switch takes its own line under the name.
          className="col-span-2 flex items-center justify-between gap-2 text-sm font-medium sm:col-span-1 sm:justify-start"
        >
          {on ? 'On' : 'Off'}
          <Switch id={switchId} checked={on} onCheckedChange={onToggle} />
        </label>
      </header>
      {plugin.description && (
        <Caption className="text-sm">{plugin.description}</Caption>
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
            const list = rest.filter(
              (c) => (c.group ?? 'More controls') === group && matches(c),
            );
            if (!list.length) return null;
            const touched = list.filter((c) => c.value !== c.default).length;
            return (
              <CollapsibleSection
                key={group}
                open={query ? true : undefined}
                title={
                  <span className="flex items-baseline gap-2">
                    {group}
                    <span className="font-mono text-xs font-normal text-muted-foreground">
                      {list.length}
                      {touched > 0 && ` · ${touched} changed`}
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
          {changed.length > 0
            ? ` · ${changed.length} changed from the plugin's own settings`
            : " · all at the plugin's own settings"}
        </Caption>
        <Button
          size="sm"
          variant="ghost"
          disabled={changed.length === 0}
          onClick={() => changed.forEach((c) => onControl(c.symbol, c.default))}
        >
          <ArrowCounterClockwise /> Reset all
        </Button>
      </footer>
    </section>
  );
}
