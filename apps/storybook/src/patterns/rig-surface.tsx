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
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { previewOf } from '../lib/preview';
import {
  blocksOf,
  branchName,
  getList,
  insertStep,
  isSplit,
  locate,
  moveStep,
  removeStep,
  startBranch,
  updateBlock,
  type ListPath,
  type Split,
  type Step,
} from '../lib/route';
import { Switch } from '../components/ui/switch';
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
import { SceneEditor, type SceneModel } from '../widgets/scene-editor';
import { SceneChange, type SceneChangeSettings } from '../widgets/scene-change';
import {
  applyScene,
  sceneDifferences,
  sceneValueCount,
  setSceneValue,
  splitSceneEdit,
} from '../lib/scene';
import {
  ChangeList,
  CompareToggle,
  VersionPicker,
  type PresetVersion,
} from '../widgets/versions';
import { CabMics } from '../widgets/cab-mics';
import { BlockChooser, type EffectChoice } from './block-chooser';
import { BlockActions } from './block-actions';
import { useConfirm } from '../components/ui/confirm';
import {
  SwapSheet,
  type BlockType,
  type ModelChoice,
  type Trial,
} from './swap-sheet';
import { VisualControl } from '../widgets/visual-control';
import { MidiTarget } from '../widgets/midi';
import { scaleFromMidi } from '../lib/midi';

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

/** Where a block sits, in words: "Lead › 2 of 4", or "Main line · 3 of 5". */
function whereOf(route: RigRoute, id: string) {
  const at = locate(route, id);
  if (!at) return '';
  const names: string[] = [];
  for (let k = 0; k < at.path.length; k += 2) {
    const split = getList(route, at.path.slice(0, k))[
      at.path[k]!
    ] as Split<BlockModel>;
    names.push(branchName(split, at.path[k + 1]!));
  }
  const list = getList(route, at.path);
  return `${names.length ? names.join(' › ') : 'Main line'} · ${at.index + 1} of ${list.length}`;
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
  sceneSettings,
  levels,
  inputLevel,
  onAudition,
  onAdd,
  models,
  blockTypes,
  effects,
  blockTools,
  downloads,
  onGetModel,
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
  /** What each scene plays, for the scene editor; scenes without settings start from the preset. */
  sceneSettings?: SceneModel[];
  levels?: Record<string, number>;
  inputLevel?: number;
  onAudition?: (id: string | null) => void;
  onAdd?: (path: ListPath, index: number) => void;
  /** Models on the device and from TONE3000 that amps, cabs and pedals can try. */
  models?: ModelChoice[];
  /** Block types a block can turn into, keeping its place. */
  blockTypes?: BlockType[];
  /** With effects, each + opens the block chooser instead of calling onAdd. */
  effects?: EffectChoice[];
  /** Extra tools at the end of a block's full editor, such as NAM capture tools for amps. */
  blockTools?: (block: BlockModel) => React.ReactNode;
  /** TONE3000 downloads in progress for the Change sheet: model id → percent. */
  downloads?: Record<string, number>;
  /** Download a TONE3000 model from the Change sheet. */
  onGetModel?: (choice: ModelChoice) => void;
  className?: string;
}) {
  const phone = usePhone();
  const [swap, setSwap] = React.useState(false);
  const [adding, setAdding] = React.useState<{
    path: ListPath;
    index: number;
  } | null>(null);
  const before = React.useRef<BlockModel | null>(null);
  const [compare, setCompare] = React.useState<'edited' | 'saved'>('edited');
  const [scope, setScope] = React.useState<'scene' | 'preset'>('preset');
  const [editing, setEditing] = React.useState(false);
  const [showScenes, setShowScenes] = React.useState(false);
  const [sceneEditor, setSceneEditor] = React.useState(false);
  const [sceneChange, setSceneChange] = React.useState<SceneChangeSettings>({
    mode: 'trails',
    fadeMs: 30,
    presetTrails: true,
  });
  const [sceneModels, setSceneModels] = React.useState<SceneModel[]>(() =>
    scenes.map(
      (s) =>
        sceneSettings?.find((m) => m.id === s.id) ?? {
          id: s.id,
          name: s.name,
          on: {},
          levels: {},
        },
    ),
  );
  const [sheet, setSheet] = React.useState(false);
  const [full, setFull] = React.useState(false);
  const sceneModel =
    scope === 'scene' && compare !== 'saved'
      ? sceneModels.find((m) => m.id === activeScene)
      : undefined;
  const shown = compare === 'saved' ? saved : applyScene(route, sceneModel);
  // In "This scene", on or off and branch levels go to the playing scene;
  // settings, moves and new blocks still change the whole preset.
  // A block added while editing a scene plays in that scene only.
  const change = (next: RigRoute) => {
    if (!sceneModel) return onRoute(next);
    const edit = splitSceneEdit(next, route, sceneModel);
    const known = new Set(blocksOf(route).map((b) => b.id));
    const added = blocksOf(next)
      .filter((b) => !known.has(b.id))
      .map((b) => b.id);
    setSceneModels((all) =>
      all.map((m) =>
        m.id === sceneModel.id
          ? edit.scene
          : {
              ...m,
              on: {
                ...m.on,
                ...Object.fromEntries(added.map((id) => [id, false])),
              },
            },
      ),
    );
    onRoute(edit.route);
  };
  const { ask, dialog: confirmDialog } = useConfirm();
  const duplicate = (b: BlockModel) => {
    const at = locate(route, b.id);
    if (!at) return;
    const taken = new Set(blocksOf(route).map((x) => x.label));
    let n = 2;
    while (taken.has(`${b.label} (${n})`)) n++;
    const copy: BlockModel = {
      ...structuredClone(b),
      id: `${b.id}-${n}`,
      label: `${b.label} (${n})`,
    };
    // The copy plays only where you are: this scene, or nowhere until a scene uses it.
    setSceneModels((all) =>
      all.map((m) => ({
        ...m,
        on: { ...m.on, [copy.id]: m.id === sceneModel?.id },
      })),
    );
    onRoute(insertStep(route, at.path, at.index + 1, copy));
    setSelected(copy.id);
  };
  const removeBlock = async (b: BlockModel) => {
    const ok = await ask({
      title: `Remove ${b.label}?`,
      body: scenes.length
        ? `It leaves ${presetName} and every scene. To leave it out of one scene only, choose This scene and switch it off.`
        : `It leaves ${presetName}. The change list can put it back until you save.`,
      confirm: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    onRoute(removeStep(route, b.id));
    setSceneModels((all) =>
      all.map((m) => {
        const on = { ...m.on };
        delete on[b.id];
        return { ...m, on };
      }),
    );
  };
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
    // In "This scene", a value belongs to the playing scene (H-1).
    if (sceneModel) {
      setSceneModels((all) =>
        all.map((m) =>
          m.id === sceneModel.id ? setSceneValue(m, id, controlId, value) : m,
        ),
      );
      return;
    }
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
    change(updateBlock(shown, id, (b) => ({ ...b, on })));
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

  const canSwap = Boolean(models?.length || blockTypes?.length);
  const openSwap = (id: string) => {
    before.current = blocksOf(route).find((b) => b.id === id) ?? null;
    setSelected(id);
    setSwap(true);
  };
  const trySwap = (trial: Trial) => {
    const was = before.current;
    if (!was) return;
    onRoute(
      updateBlock(route, was.id, (b) => {
        if (trial.kind === 'type')
          return { ...trial.type.make(was.id), on: was.on, unsaved: true };
        const { choice } = trial;
        const options = b.source?.options ?? [];
        // Loudness matching moves the block's own level, from where it was.
        const controls = was.controls.map((c) =>
          c.id === 'level' && trial.trim
            ? {
                ...c,
                value: Math.min(c.max, Math.max(c.min, c.value + trial.trim)),
              }
            : c,
        );
        return {
          ...b,
          controls,
          label: choice.label,
          caption: choice.caption,
          unsaved: true,
          source: b.source && {
            ...b.source,
            value: choice.id,
            options: options.some((o) => o.value === choice.id)
              ? options
              : [
                  ...options,
                  {
                    value: choice.id,
                    label: choice.label,
                    caption: choice.caption,
                  },
                ],
          },
        };
      }),
    );
  };

  const stepTo = (delta: -1 | 1) => {
    if (!block) return;
    const next = blocks[blocks.indexOf(block) + delta];
    if (!next) return;
    setSelected(next.id);
    document
      .querySelector(`[data-block="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSceneEditor(true)}
          >
            <SquaresFour /> Edit scenes…
          </Button>
          {reading && <Badge tone="selected">Hearing the saved version</Badge>}
          {sceneModel && (
            <Caption as="p" role="status" className="basis-full text-xs">
              Editing {sceneModel.name}: on or off (an off block keeps running),
              branch levels and every value you change belong to this scene
              only, and a block you add plays in this scene only. Moving or
              removing blocks changes the whole preset.
            </Caption>
          )}
        </div>
      </header>

      {showScenes && (
        <div className="grid gap-2 px-page">
          <ScenePads scenes={scenes} active={activeScene} onSelect={onScene} />
        </div>
      )}

      <RouteView
        route={withPreview(shown)}
        onChange={change}
        selected={selected}
        onSelect={select}
        editing={editing && !reading}
        levels={levels}
        inputLevel={inputLevel}
        onAudition={onAudition}
        sceneChanged={
          sceneModel ? sceneDifferences(route, sceneModel) : sceneChanged
        }
        onAdd={effects ? (path, index) => setAdding({ path, index }) : onAdd}
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
            onClick={() => removeBlock(block)}
          >
            <Trash /> Remove
          </Button>
          <BlockActions
            block={block}
            route={route}
            onRoute={onRoute}
            onDuplicate={() => duplicate(block)}
            onRemove={() => removeBlock(block)}
          />
          <Caption as="span" className="text-xs">
            Or hold a block and drag it; drop on “Parallel” to run it beside
            another.
          </Caption>
        </div>
      )}

      {block && !editing && (
        <div
          data-slot="block-dock"
          className="sticky bottom-0 z-strip hidden px-page pt-1 pb-3 md:block"
        >
          <section
            aria-label={`${block.label} controls`}
            className={cn(
              'grid gap-x-5 gap-y-3 rounded-xl border border-foreground/70 bg-raised p-3 shadow-raised lg:grid-cols-[15rem_minmax(12rem,1fr)_17rem]',
              !block.on && 'border-dashed',
            )}
          >
            <div className="grid content-start gap-2.5">
              <div className="flex items-center gap-1.5">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Previous block"
                  disabled={blocks.indexOf(block) <= 0}
                  onClick={() => stepTo(-1)}
                >
                  <CaretLeft />
                </Button>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <Eyebrow className="truncate">
                    {whereOf(shown, block.id)}
                  </Eyebrow>
                  <Title as="h2" size="sm" className="truncate">
                    {block.label}
                  </Title>
                  <Caption as="span" className="truncate small-caps text-xs">
                    {block.caption ?? block.kind}
                  </Caption>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Next block"
                  disabled={blocks.indexOf(block) >= blocks.length - 1}
                  onClick={() => stepTo(1)}
                >
                  <CaretRight />
                </Button>
              </div>
              {sceneModel && sceneValueCount(sceneModel, block.id) > 0 && (
                <div
                  data-slot="scene-values"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-foreground px-3 py-1.5"
                >
                  <Caption as="span" className="text-xs">
                    {sceneModel.name} sets{' '}
                    {sceneValueCount(sceneModel, block.id)} of its values
                  </Caption>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSceneModels((all) =>
                        all.map((m) => {
                          if (m.id !== sceneModel.id) return m;
                          const values = { ...m.values };
                          delete values[block.id];
                          return { ...m, values, edited: true };
                        }),
                      )
                    }
                  >
                    Use the preset's values
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
                <label
                  htmlFor={`on-${block.id}`}
                  className="text-sm font-medium"
                >
                  {block.on ? 'Block on' : 'Bypassed'}
                </label>
                <MidiTarget
                  id={`${block.id}:on`}
                  label={`${block.label} · on/off`}
                  kind="switch"
                  group="Blocks"
                  onMidi={(m) =>
                    (m.kind === 'pc' || m.value > 0) &&
                    toggle(block.id, !block.on)
                  }
                >
                  <Switch
                    id={`on-${block.id}`}
                    checked={block.on}
                    onCheckedChange={(on) => toggle(block.id, on)}
                    disabled={reading}
                  />
                </MidiTarget>
              </div>
              <div className="flex flex-wrap gap-2">
                {canSwap && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reading}
                    onClick={() => openSwap(block.id)}
                    aria-label={`Change ${block.label}…`}
                  >
                    <ArrowsLeftRight /> Change…
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFull(true)}
                >
                  <Faders /> All controls · {block.controls.length}
                </Button>
                <BlockActions
                  block={block}
                  route={route}
                  onRoute={onRoute}
                  onDuplicate={() => duplicate(block)}
                  onRemove={() => removeBlock(block)}
                  disabled={reading}
                />
              </div>
            </div>
            <div className="min-w-0">
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
                    'h-32 rounded-lg border border-border bg-background px-2 py-1 text-foreground',
                    !block.on && 'text-muted-foreground',
                  )}
                />
              )}
            </div>
            <div className="grid grid-cols-2 content-start gap-x-3 gap-y-2">
              {main.map((c) => (
                <div key={c.id} className="grid gap-0.5">
                  <Label
                    as="span"
                    className="small-caps text-xs text-muted-foreground"
                  >
                    {c.label}
                  </Label>
                  <MidiTarget
                    id={`${block.id}:${c.id}`}
                    label={`${block.label} · ${c.label}`}
                    kind="continuous"
                    group="Blocks"
                    onMidi={(m) =>
                      m.kind === 'cc' &&
                      control(
                        block.id,
                        c.id,
                        scaleFromMidi(m.value, c.min, c.max, c.step ?? 0.1),
                      )
                    }
                  >
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
                  </MidiTarget>
                </div>
              ))}
            </div>
          </section>
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
          onSwap={canSwap ? openSwap : undefined}
        />
      )}

      {effects && (
        <BlockChooser
          open={Boolean(adding)}
          onOpenChange={(open) => !open && setAdding(null)}
          models={models ?? []}
          effects={effects}
          onChoose={(added) => {
            if (adding)
              change(insertStep(shown, adding.path, adding.index, added));
            setSelected(added.id);
          }}
        />
      )}

      {confirmDialog}
      <Sheet open={sceneEditor} onOpenChange={setSceneEditor}>
        <SheetContent
          onOpenChange={setSceneEditor}
          className="md:w-[min(56rem,100vw)]"
        >
          <SheetHeader
            title="Edit scenes"
            description={`What each scene of ${presetName} plays. Tap a scene name to hear it.`}
          />
          <SheetBody className="grid content-start gap-3">
            <SceneChange value={sceneChange} onChange={setSceneChange} />
            <SceneEditor
              route={route}
              onRoute={onRoute}
              scenes={sceneModels}
              onScenes={setSceneModels}
              active={activeScene}
              onSelect={onScene}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>

      {canSwap && (
        <SwapSheet
          block={block}
          open={swap}
          onOpenChange={setSwap}
          models={models ?? []}
          types={blockTypes ?? []}
          onTry={trySwap}
          downloads={downloads}
          onGet={onGetModel}
          onBack={() => {
            const was = before.current;
            if (was) onRoute(updateBlock(route, was.id, () => was));
          }}
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
              {blockTools?.(block)}
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
