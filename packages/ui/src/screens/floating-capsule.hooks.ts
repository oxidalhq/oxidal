import { useEffect, useMemo, useState } from 'react';

import { parseSong } from '../lib/song';
import type { PerformanceTempo } from '../patterns/tempo-source';
import type { StemControls, StemRole } from '../widgets/stem-strip';
import type { TransportState } from '../widgets/transport';
import { FRIDAY_SET } from './perform.data';
import { SONGS } from './songs.data';

/**
 * Example state for the C2 media dock and edge readouts: a backing track
 * that moves along, and foot-controller messages that come and go.
 * Nothing plays and nothing is measured.
 */

export const DURATION = 222;
export const time = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The backing track's state, shared by the capsule, the dock and the mini player. */
export function useBacking(start: TransportState = 'playing') {
  const [state, setState] = useState<TransportState>(start);
  const [position, setPosition] = useState(72);
  const [loop, setLoop] = useState(false);
  const [tempo, setTempo] = useState<PerformanceTempo['source']>('song');
  const [stems, setStems] = useState<Partial<Record<StemRole, StemControls>>>({
    vocals: { level: -60, muted: true, solo: false },
    drums: { level: 0, muted: false, solo: false },
    bass: { level: -2, muted: false, solo: false },
    guitar: { level: -60, muted: true, solo: false },
    piano: { level: -4, muted: false, solo: false },
    other: { level: -3, muted: false, solo: false },
  });
  const [size, setSize] = useState(3);
  const [speed, setSpeed] = useState(4);
  const entry = FRIDAY_SET[0]!;
  const found = SONGS.find((s) => s.id === entry.song);
  const [source, setSource] = useState(found?.source ?? '');
  const song = useMemo(
    () => (found ? parseSong(source, found.format) : null),
    [found, source],
  );
  const [notes, setNotes] = useState({
    song: 'Capo off. Count in four from the hi-hat; the second chorus repeats.',
    preset: 'Scene B for the chorus. Boost only on the last solo.',
  });
  // Another song splits into stems while this one plays.
  const [split, setSplit] = useState<{ song: string; progress: number } | null>(
    { song: 'Glass Room', progress: 64 },
  );
  useEffect(() => {
    if (!split || split.progress >= 99) return;
    const id = setTimeout(
      () => setSplit({ ...split, progress: split.progress + 1 }),
      4000,
    );
    return () => clearTimeout(id);
  }, [split]);
  return {
    title: 'Slow Burn',
    caption: 'Rehearsal mix · 96 BPM · 6 stems',
    next: FRIDAY_SET[1]?.preset,
    state,
    setState,
    position,
    setPosition,
    loop,
    setLoop,
    tempo: {
      source: tempo,
      bpm: tempo === 'song' ? entry.bpm : 112,
    } as PerformanceTempo,
    setTempo,
    stems,
    setStems,
    size,
    setSize,
    speed,
    setSpeed,
    song,
    source,
    setSource,
    format: found?.format ?? 'chordpro',
    notes,
    setNotes,
    split,
    cancelSplit: () => setSplit(null),
    playing: state === 'playing',
    shown: time(position),
  };
}
export type Backing = ReturnType<typeof useBacking>;

/** The unit's output level, mono and the playing guitar, as samples the controls change. */
export function useSampleLevels() {
  const [levelDb, setLevelDb] = useState(-6);
  const [mono, setMono] = useState(false);
  const [guitar, setGuitar] = useState('telecaster');
  return { levelDb, setLevelDb, mono, setMono, guitar, setGuitar };
}

/** Moves the example track along while it plays. */
export function usePlayhead(media: Backing) {
  const { playing, setPosition } = media;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPosition((p) => (p + 1) % DURATION), 1000);
    return () => clearInterval(id);
  }, [playing, setPosition]);
}

/** The stream and engine as one line, for the top of the ☰ menu on a phone. */
export const CHAIN_STATUS_LINE = '48 kHz · 128 × 3 · 8.0 ms · NAM Full A2 · 2×';

/** The stream as the device reports it. */
export const SAMPLE_STREAM = {
  sample_rate: 48000,
  period_frames: 128,
  periods: 3,
};

/** The NAM engine, for the stream and engine details. */
export const SAMPLE_ENGINE = {
  label: 'NAM Full A2 · 2×',
  details: [
    { label: 'Model size', value: 'Full · A2' },
    { label: 'Input calibration', value: '−12 dBu' },
    { label: 'Oversampling', value: '2×' },
  ],
};

/** Guitar profiles as the device stores them. */
export const SAMPLE_GUITARS = [
  { id: 'telecaster', name: 'Telecaster', trim_db: -6 },
  { id: 'les-paul', name: 'Les Paul', trim_db: -9 },
  { id: 'stratocaster', name: 'Stratocaster', trim_db: -4.5 },
];

/** A foot-controller message that shows for a moment, then settles back. */
export function useMidiFlash() {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    const messages = ['PC 3', 'CC 16 · 127', 'CC 48 · 0'];
    let i = 0;
    let off: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setFlash(messages[i++ % messages.length]!);
      off = setTimeout(() => setFlash(null), 1200);
    }, 6000);
    return () => {
      clearInterval(id);
      clearTimeout(off);
    };
  }, []);
  return flash;
}

/** The window's width, for layouts that depend on what docked tools leave. */
export function useViewportWidth() {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return width;
}
