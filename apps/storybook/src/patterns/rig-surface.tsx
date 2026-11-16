import * as React from 'react';
import { MusicNote, PencilSimple, SquaresFour } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { NumberField } from '../components/ui/number-field';
import { Caption, Eyebrow, Label, Title } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { BlockEditor, type BlockModel } from '../widgets/block-editor';
import { previewOf } from '../lib/preview';
import { BlockVisual } from '../widgets/block-visuals';
import { Chain, type ChainLaneModel } from '../widgets/chain';
import { ScenePads, type Scene } from '../widgets/scene-pad';

export type RigLane = Omit<ChainLaneModel, 'blocks'> & { blocks: BlockModel[] };

/**
 * The rig as one surface, playing and editing (D-4): the heading says what
 * plays; the chain reads left to right with a preview on every block; a
 * tap opens the block's quick editor anchored to it (a popover on laptops,
 * a sheet on phones) with its drawing, main values and model picker; the
 * selected block's drawing and values also sit beneath the chain for
 * one-handed tweaks on stage; "All controls" opens the full sheet. Scenes
 * fold out under the chain. Editing adds the + targets and drag-to-reorder
 * to the same drawing instead of a separate canvas.
 */
export function RigSurface({
  presetName,
  playing = false,
  unsaved = false,
  lanes,
  parallel = false,
  scenes,
  activeScene,
  onControl,
  onToggleBlock,
  onSource,
  onAdd,
  onMove,
  onScene,
  onSave,
  onRevert,
  className,
}: {
  presetName: string;
  playing?: boolean;
  unsaved?: boolean;
  lanes: RigLane[];
  parallel?: boolean;
  scenes: Scene[];
  activeScene: string | null;
  onControl: (block: string, control: string, value: number) => void;
  onToggleBlock: (block: string, on: boolean) => void;
  onSource?: (block: string, value: string | null) => void;
  onAdd?: (lane: number, index: number) => void;
  onMove?: (id: string, lane: number, index: number) => void;
  onScene: (id: string) => void;
  onSave?: () => void;
  onRevert?: () => void;
  className?: string;
}) {
  const blocks = lanes.flatMap((lane) => lane.blocks);
  const [selected, setSelected] = React.useState<string | null>(
    blocks[0]?.id ?? null,
  );
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [showScenes, setShowScenes] = React.useState(false);
  const root = React.useRef<HTMLElement>(null);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const block = blocks.find((b) => b.id === selected) ?? null;
  const main = block ? block.controls.filter((c) => c.main).slice(0, 4) : [];
  const values = block
    ? Object.fromEntries(block.controls.map((c) => [c.id, c.value]))
    : {};

  const chainLanes: ChainLaneModel[] = lanes.map((lane) => ({
    ...lane,
    blocks: lane.blocks.map((b) => ({ ...b, preview: previewOf(b) })),
  }));

  const select = (id: string) => {
    const element =
      root.current?.querySelector<HTMLElement>(
        `[data-block="${CSS.escape(id)}"]`,
      ) ?? null;
    setAnchor(element);
    if (id === selected) setOpen((was) => !was);
    else {
      setSelected(id);
      setOpen(!editing);
    }
  };

  return (
    <section
      ref={root}
      data-slot="rig-surface"
      aria-label="Rig"
      className={cn('grid gap-3', className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-page pt-3">
        <div className="grid min-w-0 gap-0.5">
          <Eyebrow>{playing ? 'Playing' : 'Rig'}</Eyebrow>
          <div className="flex min-w-0 items-center gap-2">
            <Title size="md" className="truncate">
              {presetName}
            </Title>
            {playing && <Badge tone="live">Live</Badge>}
            {unsaved && <Badge tone="warning">Unsaved</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            size="sm"
            pressed={showScenes}
            onPressedChange={setShowScenes}
            aria-label="Show scenes"
          >
            <SquaresFour /> Scenes
          </Toggle>
          <Button size="sm" variant="outline" aria-label="Tuner">
            <MusicNote /> Tuner
          </Button>
          <Toggle
            size="sm"
            pressed={editing}
            onPressedChange={(on) => {
              setEditing(on);
              if (on) setOpen(false);
            }}
            aria-label="Edit the chain"
          >
            <PencilSimple /> Edit
          </Toggle>
          {unsaved && (
            <>
              <Button size="sm" variant="outline" onClick={onRevert}>
                Revert
              </Button>
              <Button size="sm" onClick={onSave}>
                Save
              </Button>
            </>
          )}
        </div>
      </header>

      <Chain
        lanes={chainLanes}
        parallel={parallel}
        selected={selected}
        onSelect={select}
        editing={editing}
        onAdd={onAdd}
        onMove={onMove}
      />

      <BlockEditor
        block={block}
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        onControl={onControl}
        onToggle={onToggleBlock}
        onSource={onSource}
      />

      {showScenes && (
        <div className="px-page">
          <ScenePads scenes={scenes} active={activeScene} onSelect={onScene} />
        </div>
      )}

      {block && (
        <div
          data-slot="block-strip"
          className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 border-t border-border px-page py-3 md:grid-cols-[14rem_minmax(0,1fr)]"
        >
          <div className="grid gap-1.5">
            <div className="flex items-baseline gap-2">
              <Title as="h2" size="sm" className="truncate">
                {block.label}
              </Title>
              <Caption as="span" className="small-caps text-xs">
                {block.caption ?? block.kind}
              </Caption>
            </div>
            <div
              className={cn(
                'rounded-lg border border-border bg-card px-2 py-1 text-foreground',
                !block.on && 'text-muted-foreground',
              )}
            >
              <BlockVisual
                kind={block.kind}
                role={block.role}
                values={values}
                className="h-12 w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 self-end sm:grid-cols-4">
            {main.map((control) => (
              <div
                key={control.id}
                className="grid min-h-16 content-end gap-0.5"
              >
                <Label
                  as="span"
                  className="small-caps text-xs text-muted-foreground"
                >
                  {control.label}
                </Label>
                <NumberField
                  className="w-full"
                  label={`${block.label} ${control.label}`}
                  value={control.value}
                  min={control.min}
                  max={control.max}
                  step={control.step ?? 0.5}
                  fine={(control.step ?? 0.5) / 5}
                  unit={control.unit}
                  digits={control.step && control.step >= 1 ? 0 : 1}
                  onChange={(value) => onControl(block.id, control.id, value)}
                />
              </div>
            ))}
            {/* Keep four slots so the strip does not jump between blocks. */}
            {Array.from({ length: Math.max(0, 4 - main.length) }, (_, i) => (
              <div key={`slot-${i}`} aria-hidden="true" className="min-h-16" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
