import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ClockCounterClockwise,
  Faders,
  GitFork,
  MusicNote,
  PencilSimple,
  SquaresFour,
  Trash,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { previewOf } from '../lib/preview';
import {
  blocksOf,
  isSplit,
  locate,
  moveStep,
  removeStep,
  startBranch,
  updateBlock,
  type ListPath,
  type Step,
} from '../lib/route';
import { diffRoutes } from '../lib/route-diff';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { NumberField } from '../components/ui/number-field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { Caption, Eyebrow, Label, Title } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import {
  BlockEditor,
  BlockFullEditor,
  type BlockModel,
} from '../widgets/block-editor';
import { RouteView } from '../widgets/route-view';
import { ScenePads, type Scene } from '../widgets/scene-pad';
import {
  ChangeList,
  CompareToggle,
  VersionPicker,
  type PresetVersion,
} from '../widgets/versions';
import { CabMics } from '../widgets/cab-mics';
import { VisualControl } from '../widgets/visual-control';

export type RigRoute = Step<BlockModel>[];

function usePhone() {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 47.99rem)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

function withPreview(route: RigRoute): RigRoute {
  return route.map((s) =>
    isSplit(s)
      ? { ...s, branches: s.branches.map((b) => withPreview(b)) }
      : { ...s, preview: previewOf(s) },
  );
}

/**
 * The rig: where a sound is shaped. One surface for playing and editing.
 *
 * - The heading names the preset and its **version** (Default, Friday gig…);
 *   edits made anywhere sit on top of that version until you save them over
 *   it, save them as a new version, or discard them. **Edited / Saved**
 *   switches what you hear for an instant A/B, and the change count opens
 *   the list of what changed, each with its own undo.
 * - **This scene / Whole preset** says where a change goes; blocks the
 *   playing scene changes carry a small mark.
 * - The **route** draws the real signal: splits, branches (an empty one is
 *   dry), joins, splits again. A meter on each wire shows the level after
 *   each block. Hold a block to hear the sound without it.
 * - Tap a block: on laptops its drawing and main values open in the strip
 *   under the route (drag the drawing itself); on phones a bottom sheet with
 *   sliders. "All controls" is always one tap further.
 * - **Edit** adds + targets, long-press drag (drop on "Parallel" to run two
 *   blocks side by side) and a toolbar: earlier, later, parallel, remove.
 */
export function RigSurface({
  presetName,
  playing = false,
  route,
  saved,
  onRoute,
  versions,
  currentVersion,
  onVersion,
  onSaveVersion,
  onSaveVersionAs,
  onMakeDefault,
  scenes,
  activeScene,
  onScene,
  sceneChanged,
  levels,
  inputLevel,
  onAudition,
  onAdd,
  className,
}: {
  presetName: string;
  playing?: boolean;
  /** The route as edited (what plays). */
  route: RigRoute;
  /** The version as saved, for compare and the change list. */
  saved: RigRoute;
  onRoute: (route: RigRoute) => void;
  versions: PresetVersion[];
  currentVersion: string;
  onVersion: (id: string) => void;
  onSaveVersion: () => void;
  onSaveVersionAs: (name: string) => void;
  onMakeDefault: (id: string) => void;
  scenes: Scene[];
  activeScene: string | null;
  onScene: (id: string) => void;
  sceneChanged?: string[];
  levels?: Record<string, number>;
  inputLevel?: number;
  onAudition?: (id: string | null) => void;
  onAdd?: (path: ListPath, index: number) => void;
  className?: string;
}) {
  const phone = usePhone();
  const [compare, setCompare] = React.useState<'edited' | 'saved'>('edited');
  const [scope, setScope] = React.useState<'scene' | 'preset'>('preset');
  const [editing, setEditing] = React.useState(false);
  const [showScenes, setShowScenes] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
  const [full, setFull] = React.useState(false);
  const shown = compare === 'saved' ? saved : route;
  const blocks = blocksOf(shown);
  const [selected, setSelected] = React.useState<string | null>(
    blocks[2]?.id ?? blocks[0]?.id ?? null,
  );
  const block = blocks.find((b) => b.id === selected) ?? null;
  const changes = React.useMemo(() => diffRoutes(saved, route), [saved, route]);
  const reading = compare === 'saved';

  // Several changes can arrive in one gesture (a mic's position and angle);
  // each builds on the last, not on the route as it was when drawn.
  const latest = React.useRef(route);
  React.useEffect(() => {
    latest.current = route;
  }, [route]);
  const control = (id: string, controlId: string, value: number) => {
    const next = updateBlock(latest.current, id, (b) => ({
      ...b,
      unsaved: true,
      controls: b.controls.map((c) =>
        c.id === controlId ? { ...c, value } : c,
      ),
    }));
    latest.current = next;
    onRoute(next);
  };
  const toggle = (id: string, on: boolean) =>
    onRoute(updateBlock(route, id, (b) => ({ ...b, on })));
  const shift = (delta: -1 | 1) => {
    if (!selected) return;
    const at = locate(route, selected);
    if (!at) return;
    onRoute(
      moveStep(
        route,
        selected,
        at.path,
        delta < 0 ? Math.max(0, at.index - 1) : at.index + 2,
      ),
    );
  };

  const select = (id: string) => {
    setSelected(id);
    if (phone && !editing && !reading) setSheet(true);
  };

  const main = block ? block.controls.filter((c) => c.main).slice(0, 4) : [];

  return (
    <section
      data-slot="rig-surface"
      aria-label="Rig"
      className={cn('grid grid-cols-[minmax(0,1fr)] gap-2', className)}
    >
      <header className="grid gap-2 px-page pt-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="grid min-w-0 gap-1">
            <Eyebrow>{playing ? 'Playing' : 'Rig'}</Eyebrow>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Title size="md" className="truncate">
                {presetName}
              </Title>
              <VersionPicker
                presetName={presetName}
                versions={versions}
                current={currentVersion}
                changes={changes.length}
                onSelect={onVersion}
                onSave={onSaveVersion}
                onSaveAs={onSaveVersionAs}
                onMakeDefault={onMakeDefault}
                onDiscard={() => onRoute(saved)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {changes.length > 0 && (
              <>
                <CompareToggle value={compare} onChange={setCompare} />
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline">
                      <ClockCounterClockwise /> {changes.length}{' '}
                      {changes.length === 1 ? 'change' : 'changes'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96">
                    <ChangeList
                      changes={changes}
                      onRevert={(change) =>
                        change.kind === 'value' &&
                        control(change.block, change.control, change.from)
                      }
                    />
                  </PopoverContent>
                </Popover>
              </>
            )}
            <Toggle
              size="sm"
              pressed={showScenes}
              onPressedChange={setShowScenes}
            >
              <SquaresFour /> Scenes
            </Toggle>
            <Button size="sm" variant="outline">
              <MusicNote /> Tuner
            </Button>
            <Toggle
              size="sm"
              pressed={editing}
              onPressedChange={setEditing}
              disabled={reading}
            >
              <PencilSimple /> Edit
            </Toggle>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Caption as="span" className="small-caps text-xs">
            Changes apply to
          </Caption>
          <SegmentedControl
            size="sm"
            value={scope}
            onValueChange={(v) => setScope(v as 'scene' | 'preset')}
            aria-label="Changes apply to"
          >
            <Segment value="scene">This scene</Segment>
            <Segment value="preset">Whole preset</Segment>
          </SegmentedControl>
          {reading && <Badge tone="selected">Hearing the saved version</Badge>}
        </div>
      </header>

      {showScenes && (
        <div className="px-page">
          <ScenePads scenes={scenes} active={activeScene} onSelect={onScene} />
        </div>
      )}

      <RouteView
        route={withPreview(shown)}
        onChange={(next) => onRoute(next)}
        selected={selected}
        onSelect={select}
        editing={editing && !reading}
        levels={levels}
        inputLevel={inputLevel}
        onAudition={onAudition}
        sceneChanged={sceneChanged}
        onAdd={onAdd}
      />

      {editing && block && (
        <div
          role="toolbar"
          aria-label={`Edit ${block.label}`}
          className="flex flex-wrap items-center gap-2 border-t border-border px-page py-2"
        >
          <span className="mr-1 text-sm font-medium">{block.label}</span>
          <Button size="sm" variant="outline" onClick={() => shift(-1)}>
            <ArrowUp /> Earlier
          </Button>
          <Button size="sm" variant="outline" onClick={() => shift(1)}>
            <ArrowDown /> Later
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRoute(startBranch(route, block.id))}
          >
            <GitFork className="rotate-90" /> Parallel path
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onRoute(removeStep(route, block.id))}
          >
            <Trash /> Remove
          </Button>
          <Caption as="span" className="text-xs">
            Or hold a block and drag it; drop on “Parallel” to run it beside
            another.
          </Caption>
        </div>
      )}

      {block && !editing && (
        <div
          data-slot="block-strip"
          className="hidden gap-x-6 gap-y-3 border-t border-border px-page py-3 md:grid md:grid-cols-[16rem_minmax(0,1fr)]"
        >
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
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
                onPressedChange={(on) => toggle(block.id, on)}
                disabled={reading}
              >
                <span className="sr-only">{block.label} </span>
                {block.on ? 'On' : 'Off'}
              </Toggle>
            </div>
            {block.mics ? (
              <CabMics
                block={block}
                onControl={(c, v) => control(block.id, c, v)}
                compact
                disabled={reading}
              />
            ) : (
              <VisualControl
                kind={block.kind}
                role={block.role}
                controls={block.controls}
                onControl={(c, v) => control(block.id, c, v)}
                disabled={reading}
                className={cn(
                  'h-24 rounded-lg border border-border bg-card px-2 py-1 text-foreground',
                  !block.on && 'text-muted-foreground',
                )}
              />
            )}
          </div>
          <div className="grid grid-cols-4 content-end gap-x-4 gap-y-2">
            {main.map((c) => (
              <div key={c.id} className="grid min-h-16 content-end gap-0.5">
                <Label
                  as="span"
                  className="small-caps text-xs text-muted-foreground"
                >
                  {c.label}
                </Label>
                <NumberField
                  className="w-full"
                  label={`${block.label} ${c.label}`}
                  value={c.value}
                  min={c.min}
                  max={c.max}
                  step={c.step ?? 0.5}
                  fine={(c.step ?? 0.5) / 5}
                  unit={c.unit}
                  digits={c.step && c.step >= 1 ? 0 : 1}
                  disabled={reading}
                  onChange={(value) => control(block.id, c.id, value)}
                />
              </div>
            ))}
            {Array.from({ length: Math.max(0, 4 - main.length) }, (_, i) => (
              <div key={`slot-${i}`} aria-hidden="true" className="min-h-16" />
            ))}
            <div className="col-span-4 flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setFull(true)}>
                <Faders /> All controls · {block.controls.length}
              </Button>
            </div>
          </div>
        </div>
      )}

      {phone && (
        <BlockEditor
          block={block}
          open={sheet}
          onOpenChange={setSheet}
          anchor={null}
          onControl={control}
          onToggle={toggle}
        />
      )}

      {block && (
        <Sheet open={full} onOpenChange={setFull}>
          <SheetContent onOpenChange={setFull}>
            <SheetHeader
              title={block.label}
              description={block.caption ?? block.kind}
            />
            <SheetBody>
              <BlockFullEditor
                block={block}
                onControl={(c, v) => control(block.id, c, v)}
              />
            </SheetBody>
            <SheetFooter>
              <Button variant="outline" onClick={() => setFull(false)}>
                Done
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}
