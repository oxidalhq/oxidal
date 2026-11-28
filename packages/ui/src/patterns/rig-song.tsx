import {
  ArrowLeft,
  ArrowRight,
  CaretLeft,
  CaretRight,
  Copy,
  Ear,
  Link,
  MagnifyingGlass,
  MusicNote,
  Pause,
  Play,
  Plus,
  Power,
  Repeat,
  Rows,
  SpeakerSlash,
  Swap,
  Trash,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Button } from '../components/ui/button';
import { Slider } from '../components/ui/slider';
import { Eyebrow } from '../components/ui/text';
import type { GlyphKey } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { BlockGlyph } from '../widgets/block-glyph';
import { SCENES, useRigSample } from './rig-samples.data';
import { DisplayBar } from './rig-samples.display';
import { SampleWorkspace } from './rig-samples.map.demo';
import { Editor, MiniRail } from './rig-samples.parts';
import {
  INITIAL_RIGS,
  type Line,
  parseSheet,
  SONG,
  type SongState,
  transposeChord,
  TRY_PRESETS,
  useSong,
} from './rig-song.data';

/**
 * Song workspace samples: a song is a list of sections (Intro, Verse,
 * Chorus…), each linked to a preset and a scene, with the chord sheet as the
 * page you play from. Design samples with fixed example data.
 */

const short = (p: string) => p.replace('Oxidal · ', '');

/** The rig a section uses, as a small label. */
function RigChip({
  preset,
  scene,
  linked = true,
  className,
}: {
  preset: string;
  scene: number;
  linked?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-xs',
        className,
      )}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: sceneColour(scene) }}
      />
      <span className="font-medium">{short(preset)}</span>
      <span className="text-muted-foreground">· {SCENES[scene]}</span>
      {linked && (
        <Link
          className="size-3 text-muted-foreground"
          aria-label="Linked to preset"
        />
      )}
    </span>
  );
}

/** Sections as one strip: each says which rig it plays and tap switches to it. */
function SectionStrip({ song }: { song: SongState }) {
  return (
    <div className="flex gap-1 overflow-x-auto px-4 py-2">
      <div role="tablist" aria-label="Sections" className="contents">
        {SONG.sections.map((s, i) => {
          const r = song.rigs[s.id] ?? INITIAL_RIGS.intro!;
          const on = song.active === i;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={on}
              onClick={() => song.select(i)}
              className={cn(
                'relative grid min-w-32 shrink-0 gap-0.5 rounded-lg border px-3 py-1.5 text-left',
                on
                  ? 'border-foreground bg-card'
                  : 'border-border hover:bg-accent',
              )}
            >
              <span
                aria-hidden
                className="absolute inset-x-2 top-0 h-0.5 rounded-full"
                style={{ background: sceneColour(r.scene) }}
              />
              <span className="text-sm font-semibold">{s.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {short(r.preset)} · {SCENES[r.scene]}
              </span>
            </button>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Add section"
        className="self-center"
      >
        <Plus />
      </Button>
    </div>
  );
}

function Segs({
  line,
  shift,
  size,
}: {
  line: Line;
  shift: number;
  size: 'md' | 'xl';
}) {
  return (
    <p className="flex flex-wrap items-end">
      {line.map((g, i) => (
        <span key={i} className="inline-flex flex-col">
          <span
            className={cn(
              'pr-3 font-mono font-bold text-danger-ink',
              size === 'xl' ? 'h-9 text-3xl' : 'h-5 text-sm',
            )}
          >
            {g.c ? transposeChord(g.c, shift) : ' '}
          </span>
          <span
            className={cn(
              'whitespace-pre',
              size === 'xl' ? 'text-3xl' : 'text-lg',
            )}
          >
            {g.t || ' '}
          </span>
        </span>
      ))}
    </p>
  );
}

/** The chord sheet. The playing section is marked; tapping any section jumps to it. */
function ChordSheet({
  song,
  size = 'md',
  showRigs = true,
}: {
  song: SongState;
  size?: 'md' | 'xl';
  showRigs?: boolean;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    refs.current[song.active]?.scrollIntoView?.({
      block: 'center',
      behavior: 'smooth',
    });
  }, [song.active]);
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Chord sheet"
      className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
    >
      {SONG.sections.map((s, i) => {
        const r = song.rigs[s.id] ?? INITIAL_RIGS.intro!;
        const on = song.active === i;
        return (
          <section
            key={s.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            onClick={() => song.select(i)}
            className={cn(
              'mb-6 cursor-pointer border-l-4 py-1 pl-4',
              on ? 'border-foreground' : 'border-transparent hover:bg-accent',
            )}
          >
            <div className="mb-1 flex items-center gap-3">
              <Eyebrow>{s.name}</Eyebrow>
              {showRigs && (
                <RigChip preset={r.preset} scene={r.scene} linked={r.linked} />
              )}
            </div>
            <div className="grid gap-2">
              {s.lines.map((l, j) => (
                <Segs key={j} line={l} shift={song.shift} size={size} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Play, position, loop the section, transpose. */
function Transport({ song }: { song: SongState }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="flex items-center gap-3 border-t border-border bg-card px-4 py-2 text-sm">
      <Button
        size="icon-sm"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={() => setPlaying((p) => !p)}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="font-mono text-xs">1:12 / 3:40</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div className="h-full w-1/3 rounded-full bg-foreground" />
      </div>
      <Button variant="outline" size="sm">
        <Repeat /> Loop {SONG.sections[song.active]?.name}
      </Button>
      <span className="flex items-center gap-1">
        Key {transposeChord(SONG.key, song.shift)}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Down a semitone"
          onClick={() => song.setShift(song.shift - 1)}
        >
          −
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Up a semitone"
          onClick={() => song.setShift(song.shift + 1)}
        >
          +
        </Button>
      </span>
    </div>
  );
}

/** Shown while a preset is being tried on a section: keep it, or go back. */
function TrialBar({ song }: { song: SongState }) {
  if (!song.trial) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-y border-brand/40 bg-brand/10 px-4 py-2 text-sm"
    >
      <Ear className="size-4 text-brand" />
      <span>
        Trying <strong>{short(song.trial)}</strong> on{' '}
        <strong>{song.section.name}</strong>. Nothing is saved yet.
      </span>
      <span className="ml-auto flex gap-1">
        <Button size="sm" onClick={() => song.keep(false)}>
          Keep for {song.section.name}
        </Button>
        <Button size="sm" variant="outline" onClick={() => song.keep(true)}>
          Keep for all using {short(song.saved.preset)}
        </Button>
        <Button size="sm" variant="ghost" title="Hold to hear the saved rig">
          A/B
        </Button>
        <Button size="sm" variant="ghost" onClick={() => song.tryPreset(null)}>
          Revert
        </Button>
      </span>
    </div>
  );
}

/** Left panel: presets with the blocks in each, tapping one tries it on the playing section. */
function TryList({ song }: { song: SongState }) {
  return (
    <aside
      aria-label="Try a preset"
      className="flex w-80 shrink-0 flex-col border-r border-border bg-background"
    >
      <div className="border-b border-border p-3">
        <Eyebrow>Try on {song.section.name}</Eyebrow>
        <label className="mt-2 flex items-center gap-2 rounded-md border border-input px-2 py-1.5 text-sm text-muted-foreground">
          <MagnifyingGlass /> Search presets and sounds
        </label>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {TRY_PRESETS.map((p) => {
          const current = song.rig.preset === p.name;
          const tryingThis = song.trial === p.name;
          return (
            <li key={p.name}>
              <button
                onClick={() =>
                  song.tryPreset(current && !song.trial ? null : p.name)
                }
                className={cn(
                  'grid w-full gap-1 rounded-lg px-3 py-2 text-left hover:bg-accent',
                  current && 'bg-accent',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {short(p.name)}
                  {tryingThis && (
                    <Ear className="size-4 text-brand" aria-label="Trying" />
                  )}
                  {current && !tryingThis && (
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      in use
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {p.glyphs.map((g, i) => (
                    <BlockGlyph key={i} glyph={g} className="size-4" />
                  ))}
                  <span className="ml-1 text-xs">{p.note}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/** Practice: chain in the middle, sections and chord sheet below, controls in a sheet at the bottom. */
function SongWorkspace({
  leftOpen = false,
  initialTrial = null,
  initialActive = 1,
}: {
  leftOpen?: boolean;
  initialTrial?: string | null;
  initialActive?: number;
}) {
  const song = useSong(initialActive, initialTrial);
  const rig = useRigSample(null);
  const [left, setLeft] = useState(leftOpen);
  const [mode, setMode] = useState<'edit' | 'perform'>('edit');
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DisplayBar
        variant="strip"
        scene={song.rig.scene}
        presetName={short(song.rig.preset)}
        edited={!!song.trial}
        mode={mode}
        onMode={setMode}
      />
      <div className="flex min-h-0 flex-1">
        {left ? (
          <TryList song={song} />
        ) : (
          <MiniRail
            icons={[<MusicNote key="p" className="size-5" />]}
            status={['Try']}
            onOpen={() => setLeft(true)}
          />
        )}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="px-6 pt-3">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-serif text-lg font-semibold">
                {SONG.title}
              </span>
              <span className="text-muted-foreground">
                {song.section.name} plays
              </span>
              <RigChip
                preset={song.rig.preset}
                scene={song.rig.scene}
                linked={song.saved.linked}
              />
              {song.saved.linked ? (
                <button
                  className="text-xs text-muted-foreground underline underline-offset-2"
                  onClick={song.copyForSong}
                  title="Edits to this preset change every song that uses it"
                >
                  Make a copy for this song
                </button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Own copy for this song
                </span>
              )}
            </div>
          </div>
          <SampleWorkspace rig={rig}>
            <SectionStrip song={song} />
            <TrialBar song={song} />
            <ChordSheet song={song} />
            <Transport song={song} />
          </SampleWorkspace>
          {rig.block && (
            <section className="absolute inset-x-0 bottom-0 z-10 border-t border-border bg-card shadow-[0_-8px_24px_rgb(0_0_0/0.1)]">
              <Editor
                rig={rig}
                columns="grid-cols-5"
                onClose={() => rig.setSelected(null)}
              />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

/** Layout F1: practise a song with its rigs attached. */
export function SongPracticeSample() {
  return <SongWorkspace />;
}

/** Layout F2: try other presets on a section without committing. */
export function TryPresetsSample() {
  return (
    <SongWorkspace
      leftOpen
      initialActive={2}
      initialTrial="Marshall JCM 800 lead"
    />
  );
}

/** Layout F3: perform. Big section and scene buttons, big chord sheet, next section ready. */
export function PerformSongSample() {
  const song = useSong(1);
  const [mode, setMode] = useState<'edit' | 'perform'>('perform');
  const next = SONG.sections[song.active + 1];
  const nextRig = next ? (song.rigs[next.id] ?? INITIAL_RIGS.intro!) : null;
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DisplayBar
        variant="strip"
        scene={song.rig.scene}
        presetName={short(song.rig.preset)}
        edited={false}
        mode={mode}
        onMode={setMode}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_26rem]">
        <ChordSheet song={song} size="xl" showRigs={false} />
        <aside
          aria-label="Now and next"
          className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4"
        >
          <section className="grid gap-1 rounded-xl border-2 border-foreground p-4">
            <Eyebrow>Now</Eyebrow>
            <p className="font-serif text-3xl font-semibold">
              {song.section.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {short(song.rig.preset)} · Scene {song.rig.scene + 1}{' '}
              {SCENES[song.rig.scene]}
            </p>
          </section>
          <section className="grid grid-cols-3 gap-2" aria-label="Scenes">
            {SCENES.map((n, i) => (
              <button
                key={n}
                onClick={() => song.setScene(i)}
                aria-pressed={song.rig.scene === i}
                className={cn(
                  'relative grid min-h-20 place-items-center rounded-xl border text-sm font-semibold',
                  song.rig.scene === i
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-background hover:bg-accent',
                )}
              >
                <span
                  aria-hidden
                  className="absolute inset-x-3 top-0 h-1 rounded-b-full"
                  style={{ background: sceneColour(i) }}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {i + 1}
                </span>
                {n}
              </button>
            ))}
          </section>
          <section className="grid gap-2 rounded-xl border border-border bg-background p-4">
            <Eyebrow>Next</Eyebrow>
            {next && nextRig ? (
              <>
                <p className="text-lg font-semibold">{next.name}</p>
                <p className="text-sm text-muted-foreground">
                  {short(nextRig.preset)} · {SCENES[nextRig.scene]}
                </p>
                <p className="flex items-center gap-2 text-xs">
                  <span className="size-2 rounded-full bg-led-pedal" /> Ready:
                  loaded in the background, switches without a gap
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">End of the song.</p>
            )}
          </section>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Button
              variant="outline"
              className="min-h-20 text-lg"
              disabled={song.active === 0}
              onClick={() => song.select(song.active - 1)}
            >
              <CaretLeft /> Back
            </Button>
            <Button
              className="min-h-20 text-lg"
              disabled={!next}
              onClick={() => song.select(song.active + 1)}
            >
              Next section <CaretRight />
            </Button>
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg">
              <MusicNote /> Tuner
            </Button>
            <Button variant="outline" size="lg">
              <SpeakerSlash /> Mute
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

const SAMPLE_SHEET = `# Intro
[Am]    [F]    [C]    [G]
# Verse 1
[Am]Harbour lights are [F]fading in the [C]rain
[G]Every word you [Am]left is still the same
# Chorus
[F]Slow burn, [C]slow burn
[G]Carry me [Am]home again
`;

/** Layout F4: compose. Type the sheet, see it rendered, link a rig to each section. */
export function ComposeSongSample() {
  const [text, setText] = useState(SAMPLE_SHEET);
  const [rigs, setRigs] = useState<Record<string, string>>({
    Intro: 'Oxidal · Clean Sparkle',
    'Verse 1': 'Oxidal · Harmonic Tremolo',
  });
  const [shift, setShift] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);
  const sections = parseSheet(text);
  const insert = (chord: string) => {
    const el = ta.current;
    const at = el?.selectionStart ?? text.length;
    setText(text.slice(0, at) + `[${chord}]` + text.slice(at));
  };
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DisplayBar
        variant="strip"
        presetName="New song"
        number="—"
        edited
        mode="edit"
      />
      <div className="flex items-center gap-3 border-b border-border px-6 py-2 text-sm">
        <span className="font-serif text-lg font-semibold">New song</span>
        <span className="text-muted-foreground">Key Am · 112 BPM</span>
        <span className="ml-4 text-muted-foreground">Chords in this key:</span>
        {['Am', 'Dm', 'E7', 'F', 'C', 'G'].map((c) => (
          <Button key={c} variant="outline" size="sm" onClick={() => insert(c)}>
            {c}
          </Button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          Transpose
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Down"
            onClick={() => setShift(shift - 1)}
          >
            −
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Up"
            onClick={() => setShift(shift + 1)}
          >
            +
          </Button>
          <Button variant="outline" size="sm" className="ml-2">
            Import text
          </Button>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="flex min-h-0 flex-col border-r border-border">
          <Eyebrow className="block px-6 pt-3">
            Sheet text · # starts a section, [Am] puts a chord over the words
          </Eyebrow>
          <textarea
            ref={ta}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="Sheet text"
            className="min-h-0 flex-1 resize-none bg-transparent p-6 font-mono text-sm outline-none"
          />
        </div>
        <div className="min-h-0 overflow-y-auto px-8 py-5">
          {sections.map((s, i) => (
            <section key={i} className="mb-6">
              <div className="mb-1 flex items-center gap-3">
                <Eyebrow>{s.name}</Eyebrow>
                <select
                  aria-label={`Rig for ${s.name}`}
                  value={rigs[s.name] ?? ''}
                  onChange={(e) =>
                    setRigs((r) => ({ ...r, [s.name]: e.target.value }))
                  }
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs',
                    rigs[s.name]
                      ? 'border-border bg-card'
                      : 'border-dashed border-border text-muted-foreground',
                  )}
                >
                  <option value="">Choose a rig…</option>
                  {TRY_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {short(p.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                {s.lines.map((l, j) => (
                  <Segs key={j} line={l} shift={shift} size="md" />
                ))}
              </div>
            </section>
          ))}
          {sections.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Start typing, or import text.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type Def = { key: GlyphKey; name: string; group: string };
const DEFS: Def[] = [
  { key: 'amp', name: 'Amp', group: 'Amps and cabs' },
  { key: 'cab', name: 'Cab', group: 'Amps and cabs' },
  { key: 'ir', name: 'Speaker IR', group: 'Amps and cabs' },
  { key: 'boost', name: 'Boost', group: 'Drive' },
  { key: 'od', name: 'Overdrive', group: 'Drive' },
  { key: 'dist', name: 'Distortion', group: 'Drive' },
  { key: 'fuzz', name: 'Fuzz', group: 'Drive' },
  { key: 'comp', name: 'Compressor', group: 'Dynamics' },
  { key: 'gate', name: 'Gate', group: 'Dynamics' },
  { key: 'limit', name: 'Limiter', group: 'Dynamics' },
  { key: 'chorus', name: 'Chorus', group: 'Modulation' },
  { key: 'phaser', name: 'Phaser', group: 'Modulation' },
  { key: 'trem', name: 'Tremolo', group: 'Modulation' },
  { key: 'rotary', name: 'Rotary', group: 'Modulation' },
  { key: 'delay', name: 'Delay', group: 'Time and space' },
  { key: 'reverb', name: 'Reverb', group: 'Time and space' },
  { key: 'space', name: 'Space', group: 'Time and space' },
  { key: 'wah', name: 'Wah', group: 'Filters' },
  { key: 'peq', name: 'EQ', group: 'Filters' },
  { key: 'pitch', name: 'Pitch', group: 'Pitch' },
];
const GROUPS = Array.from(new Set(DEFS.map((d) => d.group)));

type Item = {
  id: number;
  key: GlyphKey;
  name: string;
  on: boolean;
  par: boolean;
};
let nextId = 100;

function Chooser({
  onPick,
  onClose,
}: {
  onPick: (d: Def) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [g, setG] = useState<string | null>(null);
  const list = DEFS.filter(
    (d) =>
      (!g || d.group === g) && d.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div
      role="dialog"
      aria-label="Add a block"
      className="shadow-xl absolute top-full left-1/2 z-30 mt-2 w-96 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-popover-foreground"
    >
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search blocks"
          className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {GROUPS.map((x) => (
          <button
            key={x}
            onClick={() => setG(g === x ? null : x)}
            aria-pressed={g === x}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              g === x
                ? 'border-foreground bg-foreground text-background'
                : 'border-border',
            )}
          >
            {x}
          </button>
        ))}
      </div>
      <div className="mt-3 grid max-h-64 grid-cols-4 gap-1 overflow-y-auto">
        {list.map((d) => (
          <button
            key={d.key}
            onClick={() => onPick(d)}
            className="grid place-items-center gap-1 rounded-lg p-2 text-xs hover:bg-accent"
          >
            <BlockGlyph glyph={d.key} className="size-7" />
            {d.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Layout G: edit the chain. Add anywhere, move, duplicate, bypass, delete, make parallel. */
export function ChainEditSample() {
  const [items, setItems] = useState<Item[]>([
    { id: 1, key: 'gate', name: 'Gate', on: true, par: false },
    { id: 2, key: 'boost', name: 'Boost', on: true, par: false },
    {
      id: 3,
      key: 'amp',
      name: 'Fender Super Reverb 1977',
      on: true,
      par: false,
    },
    { id: 4, key: 'chorus', name: 'Chorus', on: false, par: false },
    { id: 5, key: 'delay', name: 'Delay', on: true, par: false },
    { id: 6, key: 'reverb', name: 'Reverb', on: true, par: false },
  ]);
  const [sel, setSel] = useState<number | null>(3);
  const [adding, setAdding] = useState<number | null>(null);
  const idx = items.findIndex((i) => i.id === sel);
  const sw = (a: number, b: number) =>
    setItems((l) => {
      const n = [...l];
      [n[a], n[b]] = [n[b]!, n[a]!];
      return n;
    });
  const insert = (at: number, d: Def) => {
    const it: Item = {
      id: nextId++,
      key: d.key,
      name: d.name,
      on: true,
      par: false,
    };
    setItems((l) => [...l.slice(0, at), it, ...l.slice(at)]);
    setSel(it.id);
    setAdding(null);
  };
  const tool = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      key={label}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-md hover:bg-accent disabled:opacity-30"
    >
      {icon}
    </button>
  );
  const slot = (at: number) => (
    <span key={`slot${at}`} className="relative flex shrink-0 items-center">
      <span aria-hidden className="h-px w-3 bg-wire" />
      <button
        aria-label="Add a block here"
        onClick={() => setAdding(adding === at ? null : at)}
        className={cn(
          'grid size-6 place-items-center rounded-full border border-dashed border-border text-muted-foreground transition-opacity hover:border-foreground hover:text-foreground',
          adding === at ? 'opacity-100' : 'opacity-40',
        )}
      >
        <Plus className="size-3" />
      </button>
      <span aria-hidden className="h-px w-3 bg-wire" />
      {adding === at && (
        <Chooser
          onPick={(d) => insert(at, d)}
          onClose={() => setAdding(null)}
        />
      )}
    </span>
  );
  const tile = (it: Item) => {
    const on = sel === it.id;
    return (
      <span key={it.id} className="relative">
        {on && (
          <span
            role="toolbar"
            aria-label="Block actions"
            className="shadow-lg absolute -top-12 left-1/2 z-20 flex -translate-x-1/2 gap-0.5 rounded-lg border border-border bg-popover p-0.5"
          >
            {tool(
              'Move left',
              <ArrowLeft />,
              () => sw(idx, idx - 1),
              idx === 0,
            )}
            {tool(
              'Move right',
              <ArrowRight />,
              () => sw(idx, idx + 1),
              idx === items.length - 1,
            )}
            {tool(it.on ? 'Bypass' : 'Turn on', <Power />, () =>
              setItems((l) =>
                l.map((x) => (x.id === it.id ? { ...x, on: !x.on } : x)),
              ),
            )}
            {tool('Duplicate', <Copy />, () =>
              insert(idx + 1, DEFS.find((d) => d.key === it.key) ?? DEFS[0]!),
            )}
            {tool('Swap for another', <Swap />, () => setAdding(idx))}
            {tool(
              it.par ? 'Back in line' : 'Parallel with next',
              <Rows />,
              () =>
                setItems((l) =>
                  l.map((x) => (x.id === it.id ? { ...x, par: !x.par } : x)),
                ),
              idx === items.length - 1,
            )}
            {tool('Delete', <Trash />, () => {
              setItems((l) => l.filter((x) => x.id !== it.id));
              setSel(null);
            })}
          </span>
        )}
        <button
          onClick={() => setSel(on ? null : it.id)}
          aria-pressed={on}
          className="group flex w-24 flex-col items-center gap-1.5 rounded-lg p-1.5"
        >
          <span
            className={cn(
              'grid size-20 place-items-center rounded-xl border-2 bg-card',
              on
                ? 'border-foreground'
                : 'border-border group-hover:border-wire',
              !it.on && 'opacity-40',
            )}
          >
            <BlockGlyph glyph={it.key} className="size-9" />
          </span>
          <span className="line-clamp-2 text-center text-xs leading-tight font-medium">
            {it.name}
          </span>
        </button>
      </span>
    );
  };
  // Group items: a block marked parallel sits above the next one.
  const parts: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    parts.push(slot(i));
    if (it.par && items[i + 1]) {
      parts.push(
        <span
          key={`g${it.id}`}
          className="flex flex-col border-x-2 border-wire/60 px-1"
        >
          {tile(it)}
          {tile(items[i + 1]!)}
        </span>,
      );
      i++;
    } else parts.push(tile(it));
  }
  parts.push(slot(items.length));
  const block = items.find((i) => i.id === sel);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <DisplayBar
        variant="strip"
        presetName="New preset"
        number="—"
        edited
        mode="edit"
      />
      <main className="relative flex min-h-0 flex-1 flex-col">
        <div className="grid flex-1 place-items-center overflow-x-auto px-6 pt-16">
          <div className="flex items-center">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-foreground font-mono text-[10px] font-bold">
              IN
            </span>
            {parts}
            <span className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-foreground font-mono text-[10px] font-bold">
              OUT
            </span>
          </div>
        </div>
        <p className="px-6 pb-3 text-center text-xs text-muted-foreground">
          Tap a block for its actions. Tap + to add a block anywhere. Blocks
          marked parallel sit one above the other.
        </p>
        {block && (
          <section className="border-t border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-3">
              <BlockGlyph glyph={block.key} className="size-6" />
              <p className="font-serif text-lg font-semibold">{block.name}</p>
              <span className="ml-auto text-sm text-muted-foreground">
                {block.on ? 'On' : 'Bypassed'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-x-6">
              {['Level', 'Tone', 'Mix', 'Time'].map((l) => (
                <Slider
                  key={l}
                  label={l}
                  min={0}
                  max={100}
                  defaultValue={[50]}
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
