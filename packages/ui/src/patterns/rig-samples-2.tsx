import {
  ListNumbers,
  MusicNotes,
  PushPin,
  SidebarSimple,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';

import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Eyebrow } from '../components/ui/text';
import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { BlockGlyph } from '../widgets/block-glyph';
import { ALL_BLOCKS, SCENES, useRigSample } from './rig-samples.data';
import { DisplayBar, Note } from './rig-samples.display';
import { SampleWorkspace } from './rig-samples.map.demo';
import {
  BackingPanel,
  Editor,
  MiniRail,
  PresetsPanel,
  SceneTabs,
} from './rig-samples.parts';

/**
 * Second set of Rig samples: the top bar as a live display, the full
 * instrument layout, a scene overview, one search for everything, and side
 * panels that peek and pin. Design samples with fixed example data.
 */

/** Three top bar designs, with the hamburger menu open on the first. */
export function TopBarOptionsSample() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pb-72">
        <DisplayBar variant="strip" defaultOpen />
      </div>
      <Note className="pl-80">
        A · Strip. One 56 px bar: navigation in the menu, then preset, scene,
        tempo, input and output levels, DSP and CPU, search, Tuner, Mute and
        Perform. Everything a player watches, nothing else.
      </Note>
      <div className="mt-6">
        <DisplayBar variant="screen" landmark={false} />
      </div>
      <Note>
        B · Screen. A taller bar made to look like a unit's display: large
        preset number and name, scene and tempo under it, meters and load on the
        right. Costs 40 px more height; best on a laptop or tablet.
      </Note>
      <div className="mt-6">
        <DisplayBar
          variant="quiet"
          landmark={false}
          onSearch={() => undefined}
        />
      </div>
      <Note>
        C · Quiet. 48 px. Levels collapse to one status light that opens the
        full numbers and turns orange with a reason on a dropout or clip. The
        thin line at the bottom edge is the output level. Open the light.
      </Note>
    </div>
  );
}

const FS = { boost: 'FS1', amp: 'FS2', swell: 'FS3', motion: 'FS4' };

/** The whole thing: display bar, chain with footswitch badges, scene tabs, editor, minimised panels. */
export function InstrumentSample({
  onSearch,
  children,
}: {
  onSearch?: () => void;
  children?: ReactNode;
}) {
  const rig = useRigSample();
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DisplayBar variant="strip" scene={rig.scene} onSearch={onSearch} />
      <div className="flex min-h-0 flex-1">
        {left ? (
          <Side
            title="Presets and set list"
            side="left"
            onMinimise={() => setLeft(false)}
          >
            <PresetsPanel />
          </Side>
        ) : (
          <MiniRail
            icons={[<ListNumbers key="l" className="size-5" />]}
            status={['3/5']}
            onOpen={() => setLeft(true)}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <SampleWorkspace rig={rig} badges={FS}>
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              FS on a block says which stomp switch controls it. Select a block
              to change its switch.
            </p>
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
          <Side
            title="Backing and stems"
            side="right"
            onMinimise={() => setRight(false)}
          >
            <BackingPanel />
          </Side>
        ) : (
          <MiniRail
            icons={[<MusicNotes key="m" className="size-5" />]}
            status={['1:12']}
            onOpen={() => setRight(true)}
          />
        )}
      </div>
      {children}
    </div>
  );
}

function Side({
  title,
  side,
  onMinimise,
  children,
}: {
  title: string;
  side: 'left' | 'right';
  onMinimise: () => void;
  children: ReactNode;
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

type Cell = { on: boolean; note?: string };
const C = (on: boolean, note?: string): Cell => (note ? { on, note } : { on });
const MATRIX: { id: string; label: string; cells: Cell[] }[] = [
  {
    id: 'boost',
    label: 'Boost',
    cells: [
      C(false),
      C(false),
      C(true, 'Gain 60'),
      C(false),
      C(true, 'Gain 70'),
      C(false),
    ],
  },
  {
    id: 'amp',
    label: 'Fender Super Reverb 1977',
    cells: [
      C(true),
      C(true, 'Treble +3'),
      C(true, 'Input +2 · Mid −1'),
      C(true, 'Bass +2'),
      C(true, 'Mid, Treble'),
      C(true, 'Treble +1'),
    ],
  },
  {
    id: 'swell',
    label: 'Swell (path 1)',
    cells: [C(false), C(true), C(true, 'Rise 80'), C(true), C(false), C(true)],
  },
  {
    id: 'dry',
    label: 'Dry (path 2)',
    cells: [
      C(true, '100%'),
      C(true, '100%'),
      C(true, '70%'),
      C(true, '100%'),
      C(true, '100%'),
      C(true, '100%'),
    ],
  },
  {
    id: 'motion',
    label: 'Motion',
    cells: [
      C(false),
      C(true, 'Rate 71'),
      C(false),
      C(false),
      C(true, 'Rate 90'),
      C(true, 'Rate 40'),
    ],
  },
  {
    id: 'bloom',
    label: 'Bloom',
    cells: [C(true), C(true), C(true), C(true, 'Mix 83'), C(false), C(true)],
  },
];

/** Scene overview: every block against every scene, with icons and what changed. */
export function SceneOverviewSample() {
  const rig = useRigSample(null);
  const [cells, setCells] = useState(MATRIX);
  const [diff, setDiff] = useState(false);
  const toggle = (r: number, c: number) =>
    setCells((m) =>
      m.map((row, i) =>
        i === r
          ? {
              ...row,
              cells: row.cells.map((x, j) =>
                j === c ? { ...x, on: !x.on } : x,
              ),
            }
          : row,
      ),
    );
  const rows = diff
    ? cells.filter((r) =>
        r.cells.some((x) => x.on !== r.cells[0]?.on || x.note),
      )
    : cells;
  const s = rig.scene;
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DisplayBar variant="strip" scene={s} />
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center gap-4">
          <h2 className="font-serif text-xl font-semibold">Scenes</h2>
          <span className="text-sm text-muted-foreground">
            Tap a scene name to play it. Tap a cell to turn that block on or off
            in that scene.
          </span>
          <label className="ml-auto flex items-center gap-2 text-sm">
            Show only differences
            <Switch checked={diff} onCheckedChange={setDiff} />
          </label>
          <Button variant="outline" size="sm">
            Copy scene…
          </Button>
        </div>
        <div
          className="grid items-stretch gap-1"
          style={{
            gridTemplateColumns: '14rem repeat(6, minmax(6.5rem, 1fr))',
          }}
        >
          <span />
          {SCENES.map((name, i) => (
            <button
              key={name}
              onClick={() => rig.setScene(i)}
              aria-pressed={s === i}
              className={cn(
                'relative rounded-lg px-2 pt-3 pb-2 text-left',
                s === i
                  ? 'bg-foreground text-background'
                  : 'bg-card hover:bg-accent',
              )}
            >
              <span
                aria-hidden
                className="absolute inset-x-2 top-0 h-1 rounded-b-full"
                style={{ background: sceneColour(i) }}
              />
              <span className="block font-mono text-xs text-muted-foreground">
                {i + 1}
              </span>
              <span className="block text-sm font-semibold">{name}</span>
            </button>
          ))}
          {rows.map((row) => {
            const block = ALL_BLOCKS.find((b) => b.id === row.id);
            const ri = cells.indexOf(row);
            return (
              <div key={row.id} className="contents">
                <span className="flex items-center gap-2 py-2 text-sm font-medium">
                  <BlockGlyph
                    glyph={block?.glyph ?? 'split'}
                    className="size-5"
                  />
                  <span className="truncate">{row.label}</span>
                </span>
                {row.cells.map((cell, ci) => (
                  <button
                    key={ci}
                    onClick={() => toggle(ri, ci)}
                    className={cn(
                      'grid min-h-12 place-items-center rounded-lg border px-1 text-center text-xs',
                      s === ci && 'ring-2 ring-foreground/20',
                      cell.on
                        ? 'border-border bg-card text-foreground'
                        : 'border-dashed border-border text-muted-foreground',
                    )}
                  >
                    <span className="flex items-center gap-1.5 font-semibold">
                      {cell.on && (
                        <span className="size-1.5 rounded-full bg-led-pedal" />
                      )}
                      {cell.on ? 'On' : 'Off'}
                    </span>
                    {cell.note && (
                      <span className="text-muted-foreground">{cell.note}</span>
                    )}
                    <span className="sr-only">
                      , {row.label}, scene {ci + 1}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Scene {s + 1} · {SCENES[s]} plays now. Dashed means off in that scene;
          the line under On is what that scene changes.
        </p>
      </main>
    </div>
  );
}

const SEARCH_GROUPS: {
  title: string;
  items: { label: string; hint: string; icon: ReactNode }[];
}[] = [
  {
    title: 'Set list · Friday gig',
    items: [
      {
        label: 'Slow Burn',
        hint: 'Song 1 · Oxidal · Harmonic Tremolo',
        icon: <ListNumbers className="size-4" />,
      },
      {
        label: 'Afterglow',
        hint: 'Song 5 · Oxidal · Ambient Wash',
        icon: <ListNumbers className="size-4" />,
      },
    ],
  },
  {
    title: 'Presets',
    items: [
      {
        label: 'Oxidal · Harmonic Tremolo',
        hint: 'Playing now',
        icon: <MusicNotes className="size-4" />,
      },
      {
        label: 'Fender Super Reverb 1977',
        hint: 'TONE3000 · full rig',
        icon: <MusicNotes className="size-4" />,
      },
    ],
  },
  {
    title: 'In this preset',
    items: [
      {
        label: 'Oxidal Motion',
        hint: 'Block · Time',
        icon: <BlockGlyph glyph="trem" className="size-4" />,
      },
      {
        label: 'Scene 2 · Tremolo',
        hint: 'Scene',
        icon: (
          <span
            className="size-2.5 rounded-full"
            style={{ background: sceneColour(1) }}
          />
        ),
      },
    ],
  },
];

/** One search for presets, songs, blocks and scenes, opened with ⌘K. */
export function CommandPaletteSample() {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const groups = SEARCH_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) =>
      `${i.label} ${i.hint}`.toLowerCase().includes(q.toLowerCase()),
    ),
  })).filter((g) => g.items.length);
  return (
    <InstrumentSample onSearch={() => setOpen(true)}>
      {open && (
        <div
          className="bg-black/30 fixed inset-0 z-40 grid place-items-start justify-center pt-24"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Search"
            onClick={(e) => e.stopPropagation()}
            className="shadow-xl w-[620px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground"
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search presets, songs, blocks, scenes, actions…"
              className="w-full border-b border-border bg-transparent px-4 py-3 text-base outline-none"
            />
            <div className="max-h-96 overflow-y-auto p-2">
              {groups.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  Nothing matches “{q}”.
                </p>
              )}
              {groups.map((g) => (
                <section key={g.title} className="mb-1">
                  <Eyebrow className="block px-2 py-1">{g.title}</Eyebrow>
                  {g.items.map((it, i) => (
                    <button
                      key={it.label}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent',
                        g === groups[0] && i === 0 && 'bg-accent',
                      )}
                    >
                      <span className="grid size-7 place-items-center rounded-md bg-secondary">
                        {it.icon}
                      </span>
                      <span className="text-sm font-medium">{it.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {it.hint}
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
            <p className="flex gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>↑↓ move</span>
              <span>↵ open</span>
              <span>esc close</span>
              <span className="ml-auto">The same list Library shows</span>
            </p>
          </div>
        </div>
      )}
    </InstrumentSample>
  );
}

type Mode = 'min' | 'peek' | 'pinned';

/** Tablet or Fold: panels start minimised, peek over the chain, pin to dock. */
export function PanelsSample() {
  const rig = useRigSample();
  const [left, setLeft] = useState<Mode>('min');
  const [right, setRight] = useState<Mode>('min');
  const panel = (
    title: string,
    side: 'left' | 'right',
    mode: Mode,
    set: (m: Mode) => void,
    body: ReactNode,
    shadow: boolean,
  ) => (
    <aside
      aria-label={title}
      className={cn(
        'flex w-72 shrink-0 flex-col bg-background',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
        shadow && 'shadow-xl',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <Eyebrow>{title}</Eyebrow>
        <span className="flex">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={mode === 'pinned'}
            aria-label={mode === 'pinned' ? 'Unpin' : 'Pin open'}
            onClick={() => set(mode === 'pinned' ? 'peek' : 'pinned')}
          >
            <PushPin weight={mode === 'pinned' ? 'fill' : 'regular'} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Minimise ${title}`}
            onClick={() => set('min')}
          >
            <SidebarSimple mirrored={side === 'right'} />
          </Button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
  const rail = (side: 'left' | 'right') =>
    side === 'left' ? (
      <MiniRail
        icons={[<ListNumbers key="l" className="size-5" />]}
        status={['3/5']}
        onOpen={() => setLeft('peek')}
      />
    ) : (
      <MiniRail
        icons={[<MusicNotes key="m" className="size-5" />]}
        status={['1:12']}
        onOpen={() => setRight('peek')}
      />
    );
  return (
    <div className="grid min-h-screen place-items-center bg-muted p-6">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          Tablet width (1024 × 768). Open a side icon to peek over the chain;
          click the chain to close it; pin to dock it.
        </p>
        <div className="rounded-2xl relative flex h-[768px] w-[1024px] flex-col overflow-hidden border-8 border-foreground bg-background text-foreground">
          <DisplayBar variant="quiet" scene={rig.scene} />
          <div className="relative flex min-h-0 flex-1">
            {left === 'pinned'
              ? panel(
                  'Presets and set list',
                  'left',
                  left,
                  setLeft,
                  <PresetsPanel />,
                  false,
                )
              : rail('left')}
            <main
              className="flex min-w-0 flex-1 flex-col"
              onClick={() => {
                if (left === 'peek') setLeft('min');
                if (right === 'peek') setRight('min');
              }}
            >
              <SampleWorkspace rig={rig}>
                <SceneTabs
                  rig={rig}
                  className="mt-2 border-b border-border px-3 [&_[role=tab]]:-mb-px"
                />
                <section className="bg-card">
                  <Editor rig={rig} columns="grid-cols-2" />
                </section>
              </SampleWorkspace>
            </main>
            {right === 'pinned'
              ? panel(
                  'Backing and stems',
                  'right',
                  right,
                  setRight,
                  <BackingPanel />,
                  false,
                )
              : rail('right')}
            {left === 'peek' && (
              <div className="absolute top-0 bottom-0 left-12 z-20 flex">
                {panel(
                  'Presets and set list',
                  'left',
                  left,
                  setLeft,
                  <PresetsPanel />,
                  true,
                )}
              </div>
            )}
            {right === 'peek' && (
              <div className="absolute top-0 right-12 bottom-0 z-20 flex">
                {panel(
                  'Backing and stems',
                  'right',
                  right,
                  setRight,
                  <BackingPanel />,
                  true,
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
