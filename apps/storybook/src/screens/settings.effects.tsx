import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
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
import { SettingGroup, SettingRow } from '../patterns/settings-page';
import { PACKS, type Pack } from './settings.effects.data';

/**
 * Effects that come with Oxidal. Oxidal's own four are original Rust; the
 * TONE3000 engine's are part of that engine and named as such. Plugin
 * packs (LV2, made by others and installed by the player) have their own
 * page, because installing is a different job.
 */
export function Effects() {
  return (
    <>
      <SettingGroup title="Oxidal effects">
        {['Bloom reverb', 'Echo delay', 'Motion', 'Sustain'].map((e) => (
          <SettingRow
            key={e}
            label={e}
            caption="Oxidal's own · Rust · built in"
          >
            <Badge size="sm">Built in</Badge>
          </SettingRow>
        ))}
      </SettingGroup>
      <SettingGroup title="From the TONE3000 engine">
        {[
          ['Hold', 'Freezes a note'],
          ['Swell', 'Volume swells'],
          ['Pitch', 'Pitch shift; needs the pitch engine on in NAM engine'],
        ].map(([e, what]) => (
          <SettingRow
            key={e}
            label={e}
            caption={`${what} · part of the TONE3000 engine`}
          >
            <Badge size="sm">Built in</Badge>
          </SettingRow>
        ))}
      </SettingGroup>
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
export function PluginPacks({ playing = false }: { playing?: boolean }) {
  const [packs, setPacks] = useState<Pack[]>(PACKS);
  const [job, setJob] = useState<{ id: string; progress: number } | null>(null);
  const [removing, setRemoving] = useState<Pack | null>(null);
  const [understood, setUnderstood] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const install = (pack: Pack) => {
    let progress = 0;
    setJob({ id: pack.id, progress });
    timer.current = setInterval(() => {
      progress += 20;
      if (progress <= 100) return setJob({ id: pack.id, progress });
      if (timer.current) clearInterval(timer.current);
      setJob(null);
      setPacks((all) =>
        all.map((p) => (p.id === pack.id ? { ...p, installed: true } : p)),
      );
    }, 150);
  };
  const remove = (pack: Pack) => {
    setPacks((all) =>
      all.map((p) =>
        p.id === pack.id ? { ...p, installed: false, usedBy: [] } : p,
      ),
    );
    setRemoving(null);
    setUnderstood(false);
  };
  const working = packs.find((p) => p.id === job?.id);
  const blocked = playing || Boolean(job);

  return (
    <>
      {playing && (
        <p
          role="status"
          className="m-0 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          Stop audio to install or remove a pack. This keeps the playing sound
          safe from disk activity.
        </p>
      )}
      {working && (
        <div
          role="status"
          className="grid gap-1.5 rounded-lg border border-border bg-card px-3 py-2"
        >
          <span className="text-sm">
            Installing {working.name}… You can leave this page; the device
            finishes the job.
          </span>
          <Progress
            value={job!.progress}
            label={`Installing ${working.name}`}
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
              {removing.usedBy.length ? (
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
                disabled={removing.usedBy.length > 0 && !understood}
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
        title={p.name}
        caption={
          <>
            {p.effects} effects · about {p.sizeMib} MiB · {p.licence} ·{' '}
            {p.qualification}
            {p.installed &&
              ` · ${p.usedBy.length ? `used by ${p.usedBy.length} ${p.usedBy.length === 1 ? 'preset' : 'presets'}` : 'not used by saved presets'}`}
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
            {p.installed ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={blocked}
                aria-label={`Remove ${p.name}…`}
                onClick={() => setRemoving(p)}
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
export function NamEngine() {
  const [loudness, setLoudness] = useState('-18');
  const [over, setOver] = useState('2');
  const [size, setSize] = useState('standard');
  const [pitch, setPitch] = useState(true);
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
            onValueChange={setLoudness}
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
          <Switch id="calibrate" defaultChecked />
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
            onValueChange={setOver}
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
            onValueChange={setSize}
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
          <Switch id="cores" defaultChecked />
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
          <Switch id="pitch" checked={pitch} onCheckedChange={setPitch} />
        </SettingRow>
      </SettingGroup>
    </>
  );
}
