import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '@oxidal/design-system/components/dialog';
import { Switch } from '@oxidal/design-system/components/switch';
import { glyphFor } from '@oxidal/design-system/lib/block-glyphs';
import { cn } from '@oxidal/design-system/lib/cn';
import { controlLabel as pluginLabel } from '@oxidal/design-system/lib/plugin';
import { useAllControls } from '@oxidal/design-system/lib/use-all-controls';
import { DockableSheet } from '@oxidal/design-system/patterns/tool-dock';
import {
  type BlockControl,
  BlockFullEditor,
} from '@oxidal/design-system/widgets/block-editor';
import { SourceCard } from '@oxidal/design-system/widgets/block-source';
import {
  BlockPanelControl,
  blockPanelVisualClass,
  SelectedBlockPanel as BlockPanel,
} from '@oxidal/design-system/widgets/selected-block-panel';
import { VisualControl } from '@oxidal/design-system/widgets/visual-control';

import type { RigControl } from '../../api';
import { controlLabel } from '../../lv2Control';
import { usePluginSource } from '../../PluginSourceDetails';
import type { IdStep } from '../../rigChain';
import { useToneSource } from '../../useToneSource';
import { ControlGrid } from './ControlGrid';
import { LiveLv2Panel } from './LiveLv2Panel';
import { key, rigBusy, rigLocked } from './mixedRigViewModel';
import { NativeLoad } from './NativeLoad';
import { SelectedBlockPanel as RoutingPanel } from './SelectedBlockPanel';
import { SelectedModelControls } from './SelectedModelControls';
import { useLv2Controls } from './useLv2Controls';
import type { RigViewProps } from './useMixedRigSession';

/** The capture engine's tone controls, as the amp drawing names its points. */
const TONE_POINTS: Record<string, string> = {
  toneBass: 'bass',
  toneMid: 'mid',
  toneTreble: 'treble',
};

/** Where a block sits, as the Rig surface says it: "Main line · 3 of 6" or "Path 2 · 1 of 2". */
function whereIn(route: IdStep[], id: string, path?: number): string | null {
  const blocks = route.filter((s) => typeof s === 'string');
  for (const step of route) {
    if (typeof step === 'string') {
      if (step === id)
        return `${path === undefined ? 'Main line' : `Path ${path + 1}`} · ${blocks.indexOf(step) + 1} of ${blocks.length}`;
    } else
      for (const [i, branch] of step.branches.entries()) {
        const found = whereIn(branch, id, i);
        if (found) return found;
      }
  }
  return null;
}

/**
 * The selected block as the Storybook Rig surface draws it: who it is on the
 * left (position, picture, maker, on/off, change, all controls), its drawing
 * in the middle and its main values on the right, with no scrolling. The
 * full control list and the routing buttons open from the same box.
 * @see docs/interface.md
 */
export function BlockBox({ rig, vm }: RigViewProps) {
  const { command, selectLaneTile, setPicker } = rig;
  const {
    eqBlock,
    nodes,
    running,
    selected,
    selectedSpot,
    selectedToneId,
    selectedView,
    state,
    visibleControls,
  } = vm;
  const [all, setAll] = useState(false);
  const allControls = useAllControls();
  const [routing, setRouting] = useState(false);
  const [minimised, setMinimised] = useState(false);
  const tone = useToneSource(selectedToneId ?? null);
  const lv2 = useLv2Controls({ rig, vm });
  // An effect credits its maker, website and pack (Guitarix and its site,
  // the package and version), as a TONE3000 block credits its creator.
  const pluginSource = usePluginSource(
    selected?.kind === 'lv2' ? lv2.plugin : null,
  );
  // While a value is on its way to the device the controls stay usable: the
  // slider shows where it was dragged, and the newest value waits and goes
  // next. Disabling them for each step made the whole box flicker.
  const [dragged, setDragged] = useState<Record<string, number>>({});
  const waiting = useRef<{
    target: RigControl['target'];
    value: number;
  } | null>(null);
  const inFlight = vm.disabled && !vm.controlsHeld;
  useEffect(() => {
    if (inFlight) return;
    const next = waiting.current;
    waiting.current = null;
    const control = vm.state.control;
    if (next && control)
      void command({
        kind: 'control',
        command: {
          session: control.session,
          expected_revision: control.revision,
          target: next.target,
          value: next.value,
        },
      });
    // The device has the last value: show what it reports.
    else setDragged((d) => (Object.keys(d).length ? {} : d));
  }, [inFlight, command, vm.state.control]);
  if (!running || !selected || !selectedView) return null;
  const busy = rigBusy(vm, rig);
  /** Held for anything but a value in flight. */
  const controlsBusy = vm.controlsHeld || rigLocked(rig) || !!rig.switching;
  const bypass = selectedView.branch ? undefined : selectedView.bypass;
  const on = selectedView.branch
    ? selectedView.branch.enabled
    : bypass?.value !== 1;
  const label = selectedView.label;
  const rawKind =
    selected.kind === 'tone3000' ? 'amp' : selectedView.block.kind;
  const kind = rawKind === 'other' ? 'lv2' : rawKind;

  // Neighbours along the drawn chain, blocks only.
  const blocks = nodes.filter((n) => n.kind === 'lv2' || n.kind === 'tone3000');
  const at = blocks.findIndex((n) => n.id === selected.id);
  const go = (to: number) => {
    const next = blocks[to];
    if (next && !busy) selectLaneTile(`${next.id}`);
  };
  const where =
    (vm.canvasRoute && whereIn(vm.canvasRoute, selected.id)) ??
    (selectedSpot
      ? `${selectedSpot.owners.length ? 'Path' : 'Main line'} · ${selectedSpot.index + 1} of ${selectedSpot.length}`
      : '');

  // An effect shows its own main controls with the plugin's names and units;
  // everything else shows its first four ordinary controls.
  const effect = selected.kind === 'lv2' && lv2.main.length > 0;
  // A capture's controls are named as the engine names them (bass, mid,
  // treble), so the amp drawing can find its tone points.
  const idOf = (c: (typeof vm.controls)[number]) =>
    // Per-block settings keep their full key so two blocks never collide.
    c.target.kind === 'native' && !c.target.parameter.startsWith('block:')
      ? (TONE_POINTS[c.target.parameter] ?? c.target.parameter)
      : key(c);
  const ordinary = visibleControls.filter((c) => !c.toggle);
  const plain = ordinary.slice(0, 4);
  /** The value a control shows: where it was dragged, until the device has it. */
  const shown = (c: { target: unknown; value: number }) =>
    dragged[JSON.stringify(c.target)] ?? c.value;
  const asTile = (c: (typeof vm.controls)[number]): BlockControl => ({
    id: idOf(c),
    label: controlLabel(c.label),
    value: shown(c),
    min: c.minimum,
    max: c.maximum,
    step: c.integer ? 1 : (c.maximum - c.minimum) / 1000,
    main: true,
  });
  const tiles: BlockControl[] = effect
    ? lv2.main.map((c) => {
        const live = lv2.live.get(c.symbol);
        return {
          id: c.symbol,
          label: pluginLabel(c),
          value: live ? shown(live) : c.value,
          min: c.min,
          max: c.max,
          step: c.integer ? 1 : (c.max - c.min) / 1000,
          unit: c.unit,
          main: true,
        };
      })
    : plain.map(asTile);
  // The drawing sees every ordinary control, not only the four tiles.
  const drawn = effect
    ? tiles
    : vm.controls
        .filter((c) => !c.toggle && c.target.kind === 'native')
        .map(asTile);
  const targetOf = (id: string) =>
    effect
      ? lv2.live.get(id)
      : (visibleControls.find((c) => idOf(c) === id || key(c) === id) ??
        vm.controls.find((c) => idOf(c) === id || key(c) === id));
  const setValue = (id: string, value: number) => {
    const target = targetOf(id);
    if (!target || !state.control || controlsBusy) return;
    setDragged((d) => ({ ...d, [key(target)]: value }));
    if (inFlight) {
      waiting.current = { target: target.target, value };
      return;
    }
    void command({
      kind: 'control',
      command: {
        session: state.control.session,
        expected_revision: state.control.revision,
        target: target.target,
        value,
      },
    });
  };
  const toggle = (next: boolean) => {
    if (!state.control || busy) return;
    if (selectedView.branch)
      void command({
        kind: 'branch',
        command: {
          session: state.control.session,
          expected_revision: state.control.revision,
          branch: selectedView.branch.id,
          enabled: next,
        },
      });
    else if (bypass)
      void command({
        kind: 'control',
        command: {
          session: state.control.session,
          expected_revision: state.control.revision,
          target: bypass.target,
          value: next ? 0 : 1,
        },
      });
  };
  const sectionOf = (label: string) =>
    /gain|level|mix|volume|output|input|normali|boost/i.test(label)
      ? 'Levels'
      : /bass|mid|treble|presence|tone|eq/i.test(label)
        ? 'EQ'
        : 'Settings';
  const fullControls: BlockControl[] = visibleControls.map((c) => ({
    id: key(c),
    label: controlLabel(c.label),
    value: shown(c),
    min: c.minimum,
    max: c.maximum,
    step: c.integer ? 1 : (c.maximum - c.minimum) / 1000,
    toggle: c.toggle,
    group: sectionOf(c.label),
  }));
  const change =
    selected.kind === 'tone3000' && eqBlock
      ? () =>
          setPicker({
            opening: state,
            node: selected.id,
            target: eqBlock.block_id,
            name: 'Selected model',
            insert: false,
          })
      : undefined;
  const source = selected.kind === 'lv2' ? pluginSource : tone.source;
  const caption =
    selected.kind === 'tone3000'
      ? (source?.kind === 'tone3000'
          ? [source.gear, source.format].filter(Boolean).join(' · ')
          : '') || 'TONE3000'
      : (lv2.category ?? 'Effect');

  // Every control of the block: in the card on a laptop, in a sheet on a
  // narrower screen.
  const everything = (
    <>
      <BlockFullEditor
        block={{
          id: selected.id,
          label,
          kind,
          on,
          controls: fullControls,
        }}
        onControl={setValue}
        disabled={controlsBusy}
        // In place, the panel already draws the block beside its values.
        visual={allControls.inPlace ? null : undefined}
      />
      <NativeLoad load={vm.nativeLoad} />
      {selected.kind === 'lv2' ? (
        <LiveLv2Panel rig={rig} vm={vm} />
      ) : (
        <>
          <SelectedModelControls rig={rig} vm={vm} inPanel />
          <ControlGrid rig={rig} vm={vm} values={false} />
        </>
      )}
    </>
  );
  return (
    <>
      <BlockPanel
        className="rounded-xl border border-border bg-card [.rig-sheet_&]:rounded-none [.rig-sheet_&]:border-0 [.rig-sheet_&]:bg-transparent"
        title={label}
        caption={caption}
        position={where}
        source={source}
        glyph={glyphFor(selectedView.block.kind, label)}
        on={on}
        onPrevious={at > 0 ? () => go(at - 1) : undefined}
        onNext={
          at >= 0 && at < blocks.length - 1 ? () => go(at + 1) : undefined
        }
        onMinimise={() => setMinimised(true)}
        minimised={minimised}
        onExpand={() => setMinimised(false)}
        preview={tiles
          .map(
            (c) =>
              // Device values arrive as 32-bit floats (0.3440000116825104):
              // show at most two decimals, as the tiles do.
              `${c.label} ${typeof c.value === 'number' ? Number(c.value.toFixed(2)) : c.value}${c.unit ? ` ${c.unit}` : ''}`,
          )
          .join(' · ')}
        renderSwitch={(id) => (
          <Switch
            id={id}
            aria-label={`${label} on`}
            checked={on}
            disabled={busy || !(bypass || selectedView.branch)}
            onCheckedChange={toggle}
          />
        )}
        onChange={change}
        changeDisabled={busy}
        onAllControls={() =>
          allControls.inPlace ? allControls.toggle() : setAll(true)
        }
        allControls={allControls.open ? everything : undefined}
        controlCount={visibleControls.length}
        actions={
          <Button
            size="sm"
            variant="outline"
            aria-label="Routing…"
            title="Routing: split, add a path, move or remove"
            onClick={() => setRouting(true)}
          >
            ⋯
          </Button>
        }
        visual={
          tiles.length ? (
            <VisualControl
              kind={kind}
              role={lv2.layout?.role}
              controls={drawn}
              onControl={setValue}
              disabled={controlsBusy}
              className={cn(
                blockPanelVisualClass,
                !on && 'text-muted-foreground',
              )}
            />
          ) : null
        }
        controls={tiles.map((c) => (
          <BlockPanelControl
            key={c.id}
            caption={c.label}
            field={{
              label: `${label} ${c.label}`,
              value: c.value,
              min: c.min,
              max: c.max,
              step: c.step ?? 0.5,
              fine: (c.step ?? 0.5) / 5,
              unit: c.unit,
              digits: c.step && c.step >= 1 ? 0 : 1,
              disabled: controlsBusy,
              onChange: (value) => setValue(c.id, value),
            }}
          />
        ))}
      />
      <DockableSheet
        id="all-controls"
        title={label}
        description={`${caption} · every control`}
        open={all && !allControls.inPlace}
        onOpenChange={setAll}
        footer={
          <Button variant="outline" onClick={() => setAll(false)}>
            Done
          </Button>
        }
      >
        {source && (
          <div className="shrink-0">
            <SourceCard source={source} />
          </div>
        )}
        {everything}
      </DockableSheet>
      {routing && (
        <Dialog open onOpenChange={setRouting}>
          <DialogContent size="lg" aria-describedby={undefined}>
            <DialogHeader title={`${label}: routing`} />
            <DialogBody>
              <RoutingPanel rig={rig} vm={vm} />
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
