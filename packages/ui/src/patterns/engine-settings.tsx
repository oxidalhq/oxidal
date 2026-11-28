import { ArrowSquareOut } from '@phosphor-icons/react';
import { useState } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { List, ListRow } from '../components/ui/list-row';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Switch } from '../components/ui/switch';
import { Caption } from '../components/ui/text';
import type { EffectSummary } from '../lib/oxidal-effects';
import { BlockTile } from '../widgets/block-tile';
import { SettingGroup, SettingNotice, SettingRow } from './settings-page';

/** An LV2 plugin pack Oxidal has qualified but does not ship. */
export type Pack = {
  id: string;
  name: string;
  website: string;
  licence?: string;
  licenceUrl?: string;
  version?: string | null;
  /** The Debian package it installs from, such as "guitarix-lv2". */
  package?: string;
  effects: number;
  sizeMib: number;
  qualification: string;
  installed: boolean;
  /** Saved presets that use it. */
  usedBy: string[] | null;
};

/** One effect that comes with Oxidal, as Settings › Effects shows it. */
export type BuiltInEffect = EffectSummary;

/**
 * One effect as a card: its block tile in the family colour (the same glyph
 * and light the Rig draws), what it is, one line, its modes, and the facts a
 * player chooses by: mono or stereo, how many controls, whether it adds
 * latency. The plugin's long description stays one press away.
 */
export function EffectCard({ effect }: { effect: BuiltInEffect }) {
  const [open, setOpen] = useState(false);
  const facts = [
    effect.channels?.join(' and '),
    effect.controls ? `${effect.controls} controls` : undefined,
    effect.latency === undefined
      ? undefined
      : effect.latency
        ? 'Adds latency'
        : 'No latency',
  ].filter(Boolean);
  return (
    <article
      data-slot="effect-card"
      aria-label={effect.name}
      className="grid min-w-0 content-start gap-3 rounded-xl border border-border bg-card p-4"
    >
      <header className="flex min-w-0 items-start gap-3">
        <BlockTile glyph={effect.glyph} tinted size="lg" />
        <div className="grid min-w-0 gap-0.5">
          <span className="small-caps text-xs font-medium text-muted-foreground">
            {effect.kind}
          </span>
          <h4 className="m-0 font-display text-xl leading-tight font-semibold">
            {effect.name}
          </h4>
        </div>
      </header>
      {effect.summary && (
        <p className="m-0 text-sm text-pretty">{effect.summary}</p>
      )}
      {!!effect.modes?.length && (
        <ul
          aria-label={`${effect.name} modes`}
          className="m-0 flex list-none flex-wrap gap-1 p-0"
        >
          {effect.modes.map((mode) => (
            <li key={mode}>
              <Badge size="sm">{mode}</Badge>
            </li>
          ))}
        </ul>
      )}
      {(facts.length > 0 || effect.details) && (
        <footer className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
          {effect.details && (
            <Button
              variant="ghost"
              size="xs"
              className="ms-auto -me-2"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? 'Less' : 'How it works'}
            </Button>
          )}
        </footer>
      )}
      {open && effect.details && (
        <p className="m-0 text-xs text-pretty text-muted-foreground">
          {effect.details}
        </p>
      )}
    </article>
  );
}

/** Effect cards in a grid: one column on a phone, up to three on a laptop. */
export function EffectGrid({ effects }: { effects: BuiltInEffect[] }) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {effects.map((effect) => (
        <EffectCard key={effect.id} effect={effect} />
      ))}
    </div>
  );
}

/**
 * Effects that come with Oxidal. Oxidal's own are original Rust; the
 * TONE3000 engine's are part of that engine and named as such. Plugin
 * packs (LV2, made by others and installed by the player) have their own
 * page, because installing is a different job.
 */
export function BuiltInEffects({
  own,
  engine,
}: {
  /** Oxidal's own effects. */
  own: BuiltInEffect[];
  /** Effects that are part of the TONE3000 engine. */
  engine: BuiltInEffect[];
}) {
  return (
    <>
      <SettingGroup title="Oxidal's own">
        <Caption className="mb-3 max-w-prose text-xs">
          Written in Rust for Oxidal, always installed, and in the block chooser
          of every preset.
        </Caption>
        <EffectGrid effects={own} />
      </SettingGroup>
      {engine.length > 0 && (
        <SettingGroup title="Part of the TONE3000 engine">
          <EffectGrid effects={engine} />
        </SettingGroup>
      )}
      <Caption>
        LV2 effects made by others are in Settings › LV2. You install those
        yourself.
      </Caption>
    </>
  );
}

/**
 * LV2 plugin packs: collections made by other people that Oxidal has
 * qualified but never ships. The player installs each one, from its own
 * source, and can remove it. Installing waits for audio to stop and runs on
 * the device, so the page can be left. Removing names the saved presets
 * that use the pack and asks for an acknowledgement before it goes.
 */
export function PluginPacks({
  packs,
  job,
  playing = false,
  disabled = false,
  onInstall,
  onRemove,
}: {
  packs: Pack[];
  /** The install running on the device, if any. */
  job?: { id: string; progress?: number; action?: 'install' | 'remove' };
  disabled?: boolean;
  /** Audio is playing: installs and removals wait for it to stop. */
  playing?: boolean;
  onInstall: (pack: Pack) => void;
  onRemove: (pack: Pack) => void;
}) {
  const [removeId, setRemoving] = useState<string | null>(null);
  const removing = packs.find((p) => p.id === removeId && p.installed);
  const [understood, setUnderstood] = useState(false);
  const install = onInstall;
  const remove = (pack: Pack) => {
    onRemove(pack);
    setRemoving(null);
    setUnderstood(false);
  };
  const working = packs.find((p) => p.id === job?.id);
  const blocked = disabled || playing || Boolean(job);
  const jobLabel = job?.action === 'remove' ? 'Removing' : 'Installing';

  return (
    <>
      {playing && (
        <SettingNotice tone="warning">
          Stop audio to install or remove a pack. This keeps the playing sound
          safe from disk activity.
        </SettingNotice>
      )}
      {working && job && (
        <div role="status" className="grid gap-1.5 border-b border-border py-2">
          <span className="text-sm">
            {jobLabel} {working.name}… You can leave this page; the device
            finishes the job.
          </span>
          <Progress
            value={job.progress}
            label={`${jobLabel} ${working.name}`}
          />
        </div>
      )}
      <SettingGroup title="Installed">
        {packs.some((p) => p.installed) ? (
          <List>{packs.filter((p) => p.installed).map((p) => packRow(p))}</List>
        ) : (
          <Caption>
            No packs installed. Install one below to add its effects.
          </Caption>
        )}
      </SettingGroup>
      <SettingGroup title="Available to install">
        <List>{packs.filter((p) => !p.installed).map((p) => packRow(p))}</List>
      </SettingGroup>

      <Dialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setUnderstood(false);
          }
        }}
      >
        {removing && (
          <DialogContent>
            <DialogHeader
              title={`Remove ${removing.name}?`}
              description="Its effects leave the block chooser. Your presets and their settings stay."
            />
            <DialogBody className="grid gap-2">
              {removing.usedBy?.length !== 0 ? (
                <>
                  {removing.usedBy ? (
                    <>
                      <p className="m-0 text-sm">
                        Used by {removing.usedBy.length} saved{' '}
                        {removing.usedBy.length === 1 ? 'preset' : 'presets'}:
                      </p>
                      <ul
                        aria-label="Presets that use this pack"
                        className="m-0 pl-5 text-sm"
                      >
                        {removing.usedBy.map((name) => (
                          <li key={name}>{name}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <Caption>
                      Oxidal could not check which saved presets use these
                      effects.
                    </Caption>
                  )}
                  <label className="flex min-h-touch items-center gap-2 text-sm">
                    <Checkbox
                      checked={understood}
                      onCheckedChange={(on) => setUnderstood(on === true)}
                    />
                    These presets will not play completely until I install it
                    again
                  </label>
                </>
              ) : (
                <Caption>No saved preset uses this pack.</Caption>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
              <Button
                variant="destructive"
                disabled={
                  blocked || (removing.usedBy?.length !== 0 && !understood)
                }
                onClick={() => remove(removing)}
              >
                Remove pack
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );

  function packRow(p: Pack) {
    return (
      <ListRow
        key={p.id}
        className="px-0"
        leading={<BlockTile glyph="plugin" tinted on={p.installed} />}
        title={p.name}
        caption={
          <>
            {p.installed &&
              p.usedBy &&
              `${p.usedBy.length ? `Used by ${p.usedBy.length} ${p.usedBy.length === 1 ? 'preset' : 'presets'}` : 'Not used by saved presets'} · `}
            {p.effects} usable effects · about {p.sizeMib} MiB
            {p.licence && ` · ${p.licence}`} · {p.qualification}
            {(p.package || p.version) &&
              ` · ${[p.package, p.version].filter(Boolean).join(' ')}`}
          </>
        }
        trailing={
          <span className="flex items-center gap-1">
            <a
              href={p.website}
              target="_blank"
              rel="noreferrer"
              aria-label={`${p.name} website`}
              className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <ArrowSquareOut aria-hidden="true" className="size-4" />
            </a>
            {p.licenceUrl && (
              <a
                href={p.licenceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline"
              >
                Licence and copyright
              </a>
            )}
            {p.installed ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={blocked}
                aria-label={`Remove ${p.name}…`}
                onClick={() => {
                  setUnderstood(false);
                  setRemoving(p.id);
                }}
              >
                Remove…
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={blocked}
                aria-label={`Install ${p.name}`}
                onClick={() => install(p)}
              >
                Install
              </Button>
            )}
          </span>
        }
      />
    );
  }
}

/**
 * The NAM engine that plays every capture, wherever it came from (your
 * files or TONE3000). These are unit-wide: kept across presets, not saved
 * in them. Changing one restarts audio briefly.
 */
export type NamEngine = {
  /** LUFS every capture is levelled to. */
  loudness: '-24' | '-18' | '-14';
  calibrate: boolean;
  oversampling: '1' | '2' | '4';
  size: 'standard' | 'lite' | 'feather' | 'nano';
  allCores: boolean;
  sleep: boolean;
  pitch: boolean;
};

export function NamEngineSettings({
  value,
  onChange,
}: {
  value: NamEngine;
  onChange: (change: Partial<NamEngine>) => void;
}) {
  const { loudness, oversampling: over, size, pitch } = value;
  return (
    <>
      <SettingGroup title="Loudness">
        <SettingRow
          label="Model loudness"
          caption="Every capture is levelled to this, so swapping amps keeps the volume. Trying a model in the rig matches loudness on top of it."
          stacked
        >
          <SegmentedControl
            value={loudness}
            onValueChange={(v) =>
              v && onChange({ loudness: v as NamEngine['loudness'] })
            }
            aria-label="Model loudness"
            className="w-full"
          >
            <Segment value="-24">−24 LUFS</Segment>
            <Segment value="-18">−18 LUFS</Segment>
            <Segment value="-14">−14 LUFS</Segment>
          </SegmentedControl>
        </SettingRow>
        <SettingRow
          id="calibrate"
          label="Match my interface's input"
          caption="Sets the input to the level the captures expect. Set the level itself in Guitars › Sound check."
        >
          <Switch
            id="calibrate"
            checked={value.calibrate}
            onCheckedChange={(calibrate) => onChange({ calibrate })}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Quality and processing">
        <SettingRow
          label="Oversampling"
          caption="Smoother high gain, at a cost: 2× uses about twice the processing per amp."
          stacked
        >
          <SegmentedControl
            value={over}
            onValueChange={(v) =>
              v && onChange({ oversampling: v as NamEngine['oversampling'] })
            }
            aria-label="Oversampling"
            className="w-full"
          >
            <Segment value="1">Off</Segment>
            <Segment value="2">2×</Segment>
            <Segment value="4">4×</Segment>
          </SegmentedControl>
        </SettingRow>
        <SettingRow
          label="Size for new NAM blocks"
          caption="Smaller sizes leave room for more amps in one preset."
          stacked
        >
          <SegmentedControl
            value={size}
            onValueChange={(v) =>
              v && onChange({ size: v as NamEngine['size'] })
            }
            aria-label="Size for new NAM blocks"
            className="w-full"
          >
            <Segment value="standard">Standard</Segment>
            <Segment value="lite">Lite</Segment>
            <Segment value="feather">Feather</Segment>
            <Segment value="nano">Nano</Segment>
          </SegmentedControl>
        </SettingRow>
        <SettingRow
          id="cores"
          label="Use every core"
          caption="Spreads amps across the Pi's four cores."
        >
          <Switch
            id="cores"
            checked={value.allCores}
            onCheckedChange={(allCores) => onChange({ allCores })}
          />
        </SettingRow>
        <SettingRow
          id="sleep"
          label="Sleep silent branches"
          caption="Amps not in the playing scene stop using processing and wake with no gap when a scene needs them. Delays and reverbs ring out before they sleep."
        >
          <Switch
            id="sleep"
            checked={value.sleep}
            onCheckedChange={(sleep) => onChange({ sleep })}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Pitch engine">
        <SettingRow
          id="pitch"
          label="Pitch engine"
          caption={
            pitch
              ? 'On: the Pitch effect works. Off saves processing.'
              : 'Off: the Pitch effect is silent until you turn this on.'
          }
        >
          <Switch
            id="pitch"
            checked={pitch}
            onCheckedChange={(on) => onChange({ pitch: on })}
          />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
