import * as React from 'react';
import {
  ArrowCounterClockwise,
  CheckCircle,
  DotsThree,
  Plus,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useConfirm } from '../components/ui/confirm';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { EmptyState } from '../components/ui/states';
import { Caption, Label } from '../components/ui/text';

export type SceneSummary = { id: string; name: string; edited?: boolean };

const NAMES = [
  'Clean',
  'Crunch',
  'Lead',
  'Ambient',
  'Solo',
  'Verse',
  'Chorus',
  'Bridge',
];

/**
 * Scenes of the playing preset, and everything you do with them in one
 * place:
 *
 * - **Tap** a pad to switch scene (no gap; trails carry over).
 * - Change a block while a scene plays and the pad says **Edited**; its
 *   strip offers **Update scene** (keep it) or **Revert**.
 * - **+ Scene** adds one, starting from the sound you hear now or from a
 *   copy of another scene.
 * - Each pad's **⋯** (or a long press) has Rename, Duplicate, Update from
 *   what you hear, Revert, Move left/right and Delete….
 * - The last scene cannot be deleted; with no scenes the preset is one sound,
 *   and the empty state says what a scene is.
 */
export function SceneManager({
  scenes,
  active,
  onSelect,
  onAdd,
  onRename,
  onDuplicate,
  onUpdate,
  onRevert,
  onDelete,
  onMove,
  className,
}: {
  scenes: SceneSummary[];
  active: string | null;
  onSelect: (id: string) => void;
  onAdd: (name: string, from: 'current' | string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onUpdate: (id: string) => void;
  onRevert: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  className?: string;
}) {
  const [menu, setMenu] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<SceneSummary | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [from, setFrom] = React.useState<string>('current');
  const { ask, dialog } = useConfirm();
  const current = scenes.find((s) => s.id === active);
  const held = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestion =
    NAMES.find((n) => !scenes.some((s) => s.name === n)) ??
    `Scene ${scenes.length + 1}`;

  const openAdd = () => {
    setName(suggestion);
    setFrom('current');
    setAdding(true);
  };

  return (
    <section
      data-slot="scene-manager"
      aria-label="Scenes"
      className={cn('grid gap-2', className)}
    >
      {scenes.length === 0 ? (
        <EmptyState
          title="This preset is one sound"
          action={
            <Button onClick={openAdd}>
              <Plus /> Add the first scene
            </Button>
          }
        >
          Scenes switch between sounds inside this preset with no gap — Clean,
          Crunch, Lead — by turning blocks and branches on or off and changing
          their values.
        </EmptyState>
      ) : (
        <div
          role="group"
          aria-label="Scene pads"
          className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"
        >
          {scenes.map((scene, index) => {
            const on = scene.id === active;
            return (
              <div key={scene.id} className="relative">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(scene.id)}
                  onPointerDown={() => {
                    held.current = setTimeout(() => setMenu(scene.id), 500);
                  }}
                  onPointerUp={() => held.current && clearTimeout(held.current)}
                  onPointerLeave={() =>
                    held.current && clearTimeout(held.current)
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu(scene.id);
                  }}
                  className={cn(
                    'grid min-h-16 w-full content-start gap-0.5 rounded-pad border border-input bg-card py-2 pr-10 pl-3 text-left select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    on &&
                      'border-foreground bg-foreground text-background hover:bg-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'small-caps text-xs font-medium',
                      on ? 'text-background/70' : 'text-muted-foreground',
                    )}
                  >
                    Scene {index + 1}
                  </span>{' '}
                  <span className="truncate text-md font-semibold">
                    {scene.name}
                  </span>{' '}
                  {scene.edited && (
                    <Badge
                      size="sm"
                      tone="warning"
                      className={cn(
                        'w-fit',
                        on && 'border-background/60 text-background',
                      )}
                    >
                      Edited
                    </Badge>
                  )}
                </button>
                <DropdownMenu
                  open={menu === scene.id}
                  onOpenChange={(open) => setMenu(open ? scene.id : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`More for ${scene.name}`}
                      className={cn(
                        'absolute top-1 right-1',
                        on && 'text-background hover:text-foreground',
                      )}
                    >
                      <DotsThree weight="bold" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => setRenaming(scene)}>
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onDuplicate(scene.id)}>
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onUpdate(scene.id)}>
                      Update from what you hear
                    </DropdownMenuItem>
                    {scene.edited && (
                      <DropdownMenuItem onSelect={() => onRevert(scene.id)}>
                        Revert changes
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={index === 0}
                      onSelect={() => onMove(scene.id, -1)}
                    >
                      Move left
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === scenes.length - 1}
                      onSelect={() => onMove(scene.id, 1)}
                    >
                      Move right
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      disabled={scenes.length <= 1}
                      onSelect={async () => {
                        if (
                          await ask({
                            title: `Delete “${scene.name}”?`,
                            body: 'The preset keeps its blocks; only this scene’s switches and values go. Footswitches set to it play the next scene.',
                            confirm: 'Delete',
                            destructive: true,
                          })
                        )
                          onDelete(scene.id);
                      }}
                    >
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
          <button
            type="button"
            onClick={openAdd}
            className="grid min-h-16 place-content-center gap-1 rounded-pad border border-dashed border-wire text-sm font-semibold text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="inline-flex items-center gap-1">
              <Plus /> Scene
            </span>
          </button>
        </div>
      )}

      {current?.edited && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
        >
          <span className="text-sm">
            <strong>{current.name}</strong> has changes you have not kept.
          </span>
          <span className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRevert(current.id)}
            >
              <ArrowCounterClockwise /> Revert
            </Button>
            <Button size="sm" onClick={() => onUpdate(current.id)}>
              <CheckCircle /> Update scene
            </Button>
          </span>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent size="sm">
          <DialogHeader
            title="Add a scene"
            description="A scene remembers which blocks and branches are on, their levels and the values you change."
          />
          <DialogBody>
            <div className="grid gap-1">
              <Label htmlFor="scene-name">Name</Label>
              <input
                id="scene-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-touch rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <div className="grid gap-1">
              <Label as="span">Start from</Label>
              <SegmentedControl
                value={from === 'current' ? 'current' : 'copy'}
                onValueChange={(v) =>
                  setFrom(
                    v === 'current'
                      ? 'current'
                      : (active ?? scenes[0]?.id ?? 'current'),
                  )
                }
                aria-label="Start from"
                className="w-full"
              >
                <Segment value="current">What you hear now</Segment>
                <Segment value="copy" disabled={!scenes.length}>
                  A copy of {current?.name ?? 'a scene'}
                </Segment>
              </SegmentedControl>
              <Caption className="text-xs">
                Then change blocks while it plays and press Update scene.
              </Caption>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                onAdd(name.trim(), from);
                setAdding(false);
              }}
            >
              Add scene
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        {renaming && (
          <DialogContent size="sm">
            <DialogHeader title={`Rename “${renaming.name}”`} />
            <DialogBody>
              <div className="grid gap-1">
                <Label htmlFor="scene-rename">Name</Label>
                <input
                  id="scene-rename"
                  defaultValue={renaming.name}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onRename(
                        renaming.id,
                        (e.target as HTMLInputElement).value.trim() ||
                          renaming.name,
                      );
                      setRenaming(null);
                    }
                  }}
                  className="min-h-touch rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const input = document.getElementById(
                    'scene-rename',
                  ) as HTMLInputElement | null;
                  onRename(renaming.id, input?.value.trim() || renaming.name);
                  setRenaming(null);
                }}
              >
                Rename
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      {dialog}
    </section>
  );
}
