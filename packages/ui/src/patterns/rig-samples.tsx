import { ListNumbers, MusicNotes, SidebarSimple } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Eyebrow } from '../components/ui/text';
import { cn } from '../lib/cn';
import { BlockGlyph } from '../widgets/block-glyph';
import {
  ALL_BLOCKS,
  CHAIN,
  type RigSample,
  useRigSample,
} from './rig-samples.data';
import { SampleTop, SampleWorkspace } from './rig-samples.map.demo';
import {
  BackingPanel,
  Cap,
  Chain,
  Editor,
  MiniRail,
  PresetBar,
  PresetsPanel,
  SceneTabs,
  Tile,
  TopBar,
  Wire,
} from './rig-samples.parts';

/**
 * Five layouts for the Rig screen, built from the same example rig so they
 * can be compared. Design samples only: the data is fixed and nothing is
 * saved. See docs/specs/00-sprint/16-product-adoption/research/res-ux-inventory.md.
 */

function Panel({
  title,
  onMinimise,
  children,
  side,
}: {
  title: string;
  onMinimise: () => void;
  children: ReactNode;
  side: 'left' | 'right';
}) {
  return (
    <aside
      aria-label={title}
      className={cn(
        'flex w-72 shrink-0 flex-col bg-background',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <Eyebrow>{title}</Eyebrow>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onMinimise}
          aria-label={`Minimise ${title}`}
        >
          <SidebarSimple mirrored={side === 'right'} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

/** 1. Workbench: side panels, chain, scene tabs as the hinge, docked editor. */
export function WorkbenchSample() {
  const rig = useRigSample();
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <SampleTop />
      <div className="flex min-h-0 flex-1">
        {left ? (
          <Panel
            title="Presets and set list"
            side="left"
            onMinimise={() => setLeft(false)}
          >
            <PresetsPanel />
          </Panel>
        ) : (
          <MiniRail
            icons={[<ListNumbers key="l" className="size-5" />]}
            status={['3/5']}
            onOpen={() => setLeft(true)}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <SampleWorkspace rig={rig}>
            <SceneTabs
              rig={rig}
              className="mt-2 border-b border-border px-4 [&_[role=tab]]:-mb-px"
            />
            <section className="bg-card">
              <Editor rig={rig} columns="grid-cols-2 xl:grid-cols-3" />
            </section>
          </SampleWorkspace>
        </main>
        {right ? (
          <Panel
            title="Backing and stems"
            side="right"
            onMinimise={() => setRight(false)}
          >
            <BackingPanel />
          </Panel>
        ) : (
          <MiniRail
            icons={[<MusicNotes key="m" className="size-5" />]}
            status={['1:12']}
            onOpen={() => setRight(true)}
          />
        )}
      </div>
    </div>
  );
}

/** 2. One line: a single row of large blocks and a wide editor strip below. */
export function OneLineSample() {
  const rig = useRigSample();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar />
      <PresetBar className="px-6 py-3" />
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="grid flex-1 place-items-center px-6">
          <Chain rig={rig} size="xl" className="justify-center" />
        </div>
        <div className="px-6 pb-3">
          <SceneTabs
            rig={rig}
            className="[&_[role=tab]]:rounded-full [&_[role=tab]]:border [&_[role=tab]]:border-border"
          />
        </div>
        <section className="border-t border-border bg-card">
          <Editor rig={rig} columns="grid-cols-5" />
        </section>
      </main>
    </div>
  );
}

/** 3. Pedalboard: blocks wrap into rows; the editor slides over from the right. */
export function PedalboardSample() {
  const rig = useRigSample('amp');
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar />
      <PresetBar className="px-6 py-3" />
      <div className="relative flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="grid flex-1 place-items-center px-6 py-4">
            <Chain
              rig={rig}
              size="xl"
              className="max-w-3xl justify-center gap-y-8"
            />
          </div>
          <div className="border-t border-border px-6 pt-3">
            <SceneTabs rig={rig} className="[&_[role=tab]]:min-w-28" />
          </div>
        </main>
        {rig.block && (
          <aside
            aria-label="Block editor"
            className="shadow-lg w-96 shrink-0 overflow-y-auto border-l border-border bg-card"
          >
            <Editor
              rig={rig}
              columns="grid-cols-1"
              onClose={() => rig.setSelected(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

/** One vertical strip per block: the main control is right there, no editor needed. */
function Strip({
  rig,
  id,
  value,
  onChange,
}: {
  rig: RigSample;
  id: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const block = ALL_BLOCKS.find((b) => b.id === id);
  if (!block) return null;
  const on = rig.isOn(id);
  const sel = rig.selected === id;
  return (
    <div
      className={cn(
        'flex w-28 flex-col items-center gap-3 rounded-xl border bg-card px-2 py-3',
        sel ? 'border-foreground' : 'border-border',
        !on && 'opacity-60',
      )}
    >
      <button
        onClick={() => rig.setSelected(sel ? null : id)}
        className="flex w-full min-w-0 flex-col items-center gap-1 text-center"
        aria-label={`${block.name}, show details`}
      >
        <BlockGlyph glyph={block.glyph} className="size-7" />
        <span className="line-clamp-2 w-full text-xs leading-tight font-semibold">
          {block.name.replace('Oxidal ', '')}
        </span>
      </button>
      <div className="h-56">
        <Slider
          label={block.main}
          orientation="vertical"
          min={0}
          max={100}
          value={[value]}
          onValueChange={([v]) => onChange(v ?? 0)}
        />
      </div>
      <span className="font-mono text-xs">{Math.round(value)}</span>
      <Switch
        checked={on}
        onCheckedChange={() => rig.toggle(id)}
        aria-label={`${block.name} on`}
      />
    </div>
  );
}

/** 4. Console: every block is a channel strip; scenes change the whole row at once. */
export function ConsoleSample() {
  const rig = useRigSample(null);
  const [vals, setVals] = useState<Record<string, number>>(
    Object.fromEntries(ALL_BLOCKS.map((b, i) => [b.id, 35 + i * 12])),
  );
  const strip = (id: string) => (
    <Strip
      key={id}
      rig={rig}
      id={id}
      value={vals[id] ?? 0}
      onChange={(v) => setVals((o) => ({ ...o, [id]: v }))}
    />
  );
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TopBar />
      <PresetBar className="px-6 py-3" />
      <SceneTabs
        rig={rig}
        className="border-b border-border px-6 [&_[role=tab]]:-mb-px"
      />
      <main className="flex flex-1 items-center justify-center gap-3 overflow-x-auto bg-card p-6">
        <Cap label="IN" db="−3 dB" />
        {CHAIN.map((item) =>
          item.kind === 'block' ? (
            strip(item.block.id)
          ) : (
            <div
              key="split"
              className="rounded-2xl grid gap-2 border border-dashed border-wire p-2"
            >
              <Eyebrow className="text-center">Parallel</Eyebrow>
              <div className="flex gap-2">
                {item.lanes.map((l, i) =>
                  l ? (
                    strip(l.id)
                  ) : (
                    <div
                      key={i}
                      className="grid w-28 place-items-center rounded-xl border border-dashed border-border text-xs text-muted-foreground"
                    >
                      Dry
                    </div>
                  ),
                )}
              </div>
            </div>
          ),
        )}
        <Cap label="OUT" db="+3 dB" />
      </main>
      {rig.block && (
        <section className="border-t border-border bg-background">
          <Editor
            rig={rig}
            columns="grid-cols-5"
            onClose={() => rig.setSelected(null)}
          />
        </section>
      )}
    </div>
  );
}

/** 5. Phone: pinned scene chips above a bottom sheet; the chain nudges up. */
export function PhoneSample() {
  const rig = useRigSample();
  return (
    <div className="grid min-h-screen place-items-center bg-muted p-6">
      <div className="relative flex h-[844px] w-[390px] flex-col overflow-hidden rounded-[2.5rem] border-8 border-foreground bg-background text-foreground">
        <PresetBar compact className="px-3 pt-8 pb-2" />
        <div className="px-3 py-4">
          <Chain rig={rig} size="sm" nowrap className="pb-1" />
        </div>
        <SceneTabs rig={rig} compact className="border-b border-border px-3" />
        <section className="rounded-t-2xl relative min-h-0 flex-1 overflow-y-auto border-t border-border bg-card shadow-[0_-8px_24px_rgb(0_0_0/0.08)]">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" />
          <Editor rig={rig} columns="grid-cols-1" />
        </section>
        <nav className="grid grid-cols-4 border-t border-border bg-background py-1 text-center text-[11px]">
          {['Rig', 'Presets', 'Backing', 'Stems'].map((n, i) => (
            <span
              key={n}
              className={cn(
                'py-2',
                i === 0 ? 'font-semibold' : 'text-muted-foreground',
              )}
            >
              {n}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}

export { Tile, Wire };
