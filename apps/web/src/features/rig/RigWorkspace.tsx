import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Caption } from '@oxidal/design-system/components/text';
import { useChainCanvasControl } from '@oxidal/design-system/lib/chain-canvas-control';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { useRemembered } from '@oxidal/design-system/lib/use-remembered';
import {
  ChainWorkspace,
  type ChainWorkspaceLayout,
} from '@oxidal/design-system/patterns/chain-workspace';
import { ReadyPresets } from '@oxidal/design-system/widgets/ready-presets';
import { StreamStatus } from '@oxidal/design-system/widgets/stream-status';
import { CompareToggle } from '@oxidal/design-system/widgets/versions';

import { useEpaper } from '../../components/RouteTree.display';
import { routeSpot } from '../../rigChain';
import { requestScreen } from '../../screenNavigation';
import { useDockParts } from '../dock/dockParts';
import { useChainView } from './chainView';
import { rigBusy, rigLocked } from './mixedRigViewModel';
import { RigChainSurface } from './RigChainSurface';
import { useRigChangeTools } from './RigChanges';
import { RigEdgeLanes } from './RigEdgeLanes';
import type { RigViewProps } from './useMixedRigSession';

/** The chain always has room to show itself; it can grow from here. */
const CHAIN_MIN_HEIGHT = 260;
/** From this chain width the edge lanes show their figures beside the meters. */
const FIGURES_FROM = 1200;

/** The chain area's width, so the map keeps clear of the edge lanes. */
function useWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/**
 * The Rig's work area: the chain, the chain bar as the divider, and the
 * panel under it. The bar holds Map or Tree and the map's tools, + Add after
 * the selected block, the changes since saving with their list, Undo and the
 * Edited/Saved compare, Save, how the chain is being run, and Hide. Its grip
 * sets the chain's height, which this browser remembers, as it does Hide;
 * selecting a block brings a hidden panel back.
 * @see docs/interface.md
 */
export function RigWorkspace({
  rig,
  vm,
  children,
}: RigViewProps & {
  /** The panel under the bar: scenes, the selected block and the rest. */
  children: (layout: ChainWorkspaceLayout) => ReactNode;
}) {
  const canvas = useChainCanvasControl();
  const [view, setView] = useChainView();
  const epaper = useEpaper();
  const [height, setHeight] = useRemembered<number>(
    'oxidal.rig.chain-height',
    0,
  );
  const [collapsed, setCollapsed] = useRemembered(
    'oxidal.rig.panel-hidden',
    false,
  );
  const changes = useRigChangeTools({ rig, vm });
  // Tools docked at the bottom sit above the chain bar.
  const dock = useDockParts();
  // A phone has no edge lanes: its guitar and level stay in the panel.
  const phone = useVerticalRig();
  const [measure, width] = useWidth();
  const insetSide = phone ? 0 : width >= FIGURES_FROM ? 148 : 56;
  const { matching, edit, picker, setName, setSaveOpening, setError } = rig;
  const { selected, state, fullRoute, sceneCanvas, editable, running } = vm;
  const waiting = rigBusy(vm, rig);

  // Selecting a block brings the hidden panel back with its settings.
  const selectedKey = vm.selectedLaneTile ?? selected?.id ?? null;
  const lastSelected = useRef(selectedKey);
  useEffect(() => {
    const before = lastSelected.current;
    lastSelected.current = selectedKey;
    if (selectedKey && selectedKey !== before && collapsed) setCollapsed(false);
  }, [selectedKey, collapsed, setCollapsed]);

  const block = selected ? vm.describeNode(selected).block : null;

  // + Add opens the same chooser as the + in the gap after the selected block.
  const addAt = (() => {
    if (!selected || !fullRoute) return null;
    const spot = routeSpot(fullRoute, selected.id);
    if (!spot) return null;
    const owner = spot.owners.at(-1);
    const at = {
      split: owner?.split ?? null,
      path: owner?.path ?? 0,
      index: spot.index + 1,
    };
    // Blocks go anywhere but ahead of a scene's tone.
    if (sceneCanvas && at.split === sceneCanvas.split && at.index === 0)
      return null;
    return at;
  })();
  const canAdd = editable && !!fullRoute && running && !rigLocked(rig);

  const draftCount = vm.draftCount;
  const saveWaits =
    vm.disabled ||
    !matching ||
    !!edit ||
    !!picker ||
    !!state.save?.running ||
    draftCount > 0;
  const stream = state.configured?.stream?.input;

  return (
    <ChainWorkspace
      className="-mx-page"
      canvas={canvas}
      chainMin={CHAIN_MIN_HEIGHT}
      chainHeight={height}
      onChainHeight={setHeight}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      chain={
        <div ref={measure} className="relative h-full">
          <RigChainSurface
            rig={rig}
            vm={vm}
            view={view}
            onView={setView}
            control={canvas}
            insetSide={insetSide}
          />
          {!phone && (
            <RigEdgeLanes rig={rig} vm={vm} figuresFrom={FIGURES_FROM} />
          )}
        </div>
      }
      // E-paper keeps the list; the choice of drawing has nothing to switch.
      aboveBar={dock?.bottom || undefined}
      chainView={epaper ? undefined : view}
      onChainView={epaper ? undefined : setView}
      selected={block ? { name: block.label, on: block.on } : null}
      // Add is always on the bar, as C2 draws it; it says why when it waits.
      onAdd={() => {
        if (canAdd && addAt) rig.setCanvasChoice({ kind: 'gap', at: addAt });
      }}
      addWaits={
        !running
          ? 'Resume audio to add blocks'
          : !editable || !fullRoute
            ? 'This preset’s routing cannot be rearranged here'
            : rigLocked(rig)
              ? 'Finish the open change first'
              : selected && !addAt
                ? 'Blocks go after a scene’s tone, not ahead of it'
                : undefined
      }
      edits={
        matching
          ? {
              count: changes.count,
              list: changes.list,
              compare: changes.compare,
              onCompare: changes.onCompare,
              compareDisabled: changes.compareDisabled,
              canSave: (changes.count > 0 || vm.changed) && !saveWaits,
              saveTitle: draftCount
                ? 'Save or discard your scene updates first'
                : undefined,
              saving: !!state.save?.running,
              onSave: () => {
                setName(matching.manifest.name);
                setSaveOpening(state);
                setError('');
              },
            }
          : undefined
      }
      barCentre={
        // A chain edit is saved and played as a revised preset: the bar says
        // so quietly instead of the chain going blank.
        rig.editing ? (
          <span
            role="status"
            className="truncate text-xs text-muted-foreground"
          >
            Applying the change…
          </span>
        ) : running && stream ? (
          <StreamStatus
            stream={stream}
            onAudioSettings={() =>
              requestScreen({ screen: 'settings', section: 'audio' })
            }
          />
        ) : undefined
      }
      barTrail={
        <ReadyPresets
          disabled={waiting}
          onSwitch={(revision) => void rig.switchPrepared(revision)}
          presets={[
            {
              id: 'playing',
              name: matching?.manifest.name ?? 'Current preset',
              state: 'playing',
            },
            ...(state.control?.prepared ?? []).map((p) => ({
              id: p.revision,
              name: p.name,
              state: p.rendering
                ? ('processing' as const)
                : ('sleeping' as const),
              note: p.error ? undefined : p.modified ? 'Modified' : undefined,
              unavailable: !!p.error,
            })),
          ]}
        />
      }
      panelClassName="px-page pb-3"
    >
      {(layout) => (
        <div className="grid min-w-0 content-start gap-3 pt-2">
          {changes.count > 0 && !layout.barHasCompare && (
            <div
              data-slot="panel-changes"
              className="flex flex-wrap items-center gap-2"
            >
              <CompareToggle
                size="xs"
                value={changes.compare}
                onChange={changes.onCompare}
                disabled={waiting}
              />
            </div>
          )}
          {changes.hearingSaved && (
            <Caption role="status" className="text-xs">
              You are hearing the saved sound. Edited brings your changes back.
            </Caption>
          )}
          {children(layout)}
        </div>
      )}
    </ChainWorkspace>
  );
}
