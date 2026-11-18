import * as React from 'react';
import {
  ArrowsOutCardinal,
  Copy,
  DotsThree,
  Trash,
} from '@phosphor-icons/react';
import { getList, locate, moveStep, placesOf, type Step } from '../lib/route';
import { Button } from '../components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Caption } from '../components/ui/text';
import type { BlockModel } from '../widgets/block-editor';

/**
 * What you can do with a block besides its controls, from its ⋯: move it
 * to any line or branch (the same as holding and dragging it in Edit),
 * duplicate it with its settings, or remove it from the preset. Any block
 * can be removed, the first one included.
 */
export function BlockActions({
  block,
  route,
  onRoute,
  onDuplicate,
  onRemove,
  disabled,
}: {
  block: BlockModel;
  route: Step<BlockModel>[];
  onRoute: (route: Step<BlockModel>[]) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const places = placesOf(route);
  const at = locate(route, block.id);
  const current = places.findIndex(
    (p) => JSON.stringify(p.path) === JSON.stringify(at?.path ?? []),
  );
  const [moving, setMoving] = React.useState(false);
  const [place, setPlace] = React.useState(String(Math.max(0, current)));
  const [end, setEnd] = React.useState('end');
  const target = places[Number(place)];
  const move = () => {
    if (!target) return;
    const index = end === 'start' ? 0 : getList(route, target.path).length;
    onRoute(moveStep(route, block.id, target.path, index));
    setMoving(false);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-label={`More for ${block.label}`}
          >
            <DotsThree />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => {
              setPlace(String(Math.max(0, current)));
              setMoving(true);
            }}
          >
            <ArrowsOutCardinal /> Move to…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy /> Duplicate with its settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove}>
            <Trash /> Remove from the preset…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader
            title={`Move ${block.label}`}
            description="To the main line or any branch. Its settings and scenes go with it."
          />
          <DialogBody className="grid gap-3">
            <Select value={place} onValueChange={setPlace}>
              <SelectTrigger aria-label="Move to" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {places.map((p, i) => (
                  <SelectItem key={p.label} value={String(i)}>
                    {p.path.length ? `Branch ${p.label}` : p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SegmentedControl
              size="sm"
              value={end}
              onValueChange={setEnd}
              aria-label="Where in it"
            >
              <Segment value="start">At the start</Segment>
              <Segment value="end">At the end</Segment>
            </SegmentedControl>
            <Caption className="text-xs">
              In Edit you can also hold a block and drag it to any gap.
            </Caption>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button onClick={move}>Move</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
