/**
 * Lyrics and chord sheets in the formats players already carry:
 *
 * - ChordPro (`.cho`, `.chordpro`, `.crd`): chords in brackets inside the
 *   words, `[G]Sun on the [D]water`, with `{title: …}`, `{key: …}`,
 *   `{start_of_chorus}` and comment directives.
 * - Markdown (`.md`): `#` headings become the title and sections, `>` lines
 *   are notes; chord-only lines are kept above the words they belong to.
 * - Plain text (`.txt`): chords written on their own line above the words,
 *   `[Verse]` or `Chorus:` lines as sections.
 *
 * Everything becomes one `Song` the viewer draws the same way.
 */
export type SongFormat = 'chordpro' | 'markdown' | 'text';

export type ChordPart = { chord?: string; text: string };

export type SongLine =
  | { kind: 'lyric'; parts: ChordPart[] }
  | { kind: 'chords'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'section'; text: string }
  | { kind: 'comment'; text: string }
  | { kind: 'blank' };

export type Song = {
  title: string;
  artist?: string;
  key?: string;
  tempo?: number;
  capo?: number;
  format: SongFormat;
  lines: SongLine[];
};

const CHORD =
  /^(N\.?C\.?|[A-G](?:#|b|♯|♭)?(?:maj|min|m|dim|aug|sus|add|M)?\d{0,2}(?:(?:sus|add|b|#)\d{1,2})*(?:\/[A-G](?:#|b|♯|♭)?)?|\|+|x\d+|%)$/;

/** A line made only of chords (and bar marks), as in "G   D/F#  Em  C". */
export function isChordLine(line: string) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every((t) => CHORD.test(t)) &&
    tokens.some((t) => /^[A-G]|^N/.test(t))
  );
}

/** File extension → format; unknown text is treated as plain text. */
export function formatOf(fileName: string): SongFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['cho', 'chordpro', 'chopro', 'crd', 'pro'].includes(ext))
    return 'chordpro';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  return 'text';
}

function sectionName(directive: string, value: string) {
  if (value) return value;
  if (/chorus/.test(directive)) return 'Chorus';
  if (/bridge/.test(directive)) return 'Bridge';
  if (/tab/.test(directive)) return 'Tab';
  return 'Verse';
}

function parseChordPro(source: string): Song {
  const song: Song = { title: '', format: 'chordpro', lines: [] };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const directive = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i.exec(
      line.trim(),
    );
    if (directive) {
      const name = directive[1]!.toLowerCase();
      const value = (directive[2] ?? '').trim();
      if (name === 'title' || name === 't') song.title = value;
      else if (name === 'artist' || name === 'subtitle' || name === 'st')
        song.artist = value;
      else if (name === 'key') song.key = value;
      else if (name === 'tempo')
        song.tempo = Number.parseFloat(value) || undefined;
      else if (name === 'capo')
        song.capo = Number.parseInt(value, 10) || undefined;
      else if (/^(start_of_|so)/.test(name))
        song.lines.push({ kind: 'section', text: sectionName(name, value) });
      else if (
        ['comment', 'c', 'comment_italic', 'ci', 'highlight'].includes(name)
      )
        song.lines.push({ kind: 'comment', text: value });
      continue;
    }
    if (line.trim().startsWith('#')) continue; // ChordPro comment
    if (!line.trim()) {
      song.lines.push({ kind: 'blank' });
      continue;
    }
    if (!line.includes('[')) {
      song.lines.push(
        isChordLine(line)
          ? { kind: 'chords', text: line }
          : { kind: 'lyric', parts: [{ text: line }] },
      );
      continue;
    }
    const parts: ChordPart[] = [];
    const pattern = /\[([^\]]+)\]/g;
    let last = 0;
    let chord: string | undefined;
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
      const text = line.slice(last, match.index);
      if (text || chord) parts.push({ chord, text });
      chord = match[1];
      last = match.index + match[0].length;
    }
    parts.push({ chord, text: line.slice(last) });
    song.lines.push({ kind: 'lyric', parts });
  }
  return song;
}

const SECTION =
  /^\s*(?:\[([^\]]+)\]|(intro|verse(?:\s*\d+)?|pre-?chorus|chorus|bridge|solo|outro|instrumental|tag)\s*:?)\s*$/i;

function parseLines(
  source: string,
  format: 'markdown' | 'text',
  suppliedTitle?: string,
): Song {
  const song: Song = { title: '', format, lines: [] };
  const lines = source.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      song.lines.push({ kind: 'blank' });
      continue;
    }
    if (format === 'markdown') {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        if (heading[1] === '#' && !song.title) song.title = heading[2]!;
        else song.lines.push({ kind: 'section', text: heading[2]! });
        continue;
      }
      const meta = /^\*\*(artist|key|tempo|capo)\*\*\s*:?\s*(.*)$/i.exec(line);
      if (meta) {
        const name = meta[1]!.toLowerCase();
        if (name === 'artist') song.artist = meta[2];
        if (name === 'key') song.key = meta[2];
        if (name === 'tempo')
          song.tempo = Number.parseFloat(meta[2]!) || undefined;
        if (name === 'capo')
          song.capo = Number.parseInt(meta[2]!, 10) || undefined;
        continue;
      }
      if (line.startsWith('>')) {
        song.lines.push({ kind: 'comment', text: line.replace(/^>\s?/, '') });
        continue;
      }
      if (line.startsWith('```')) continue;
    }
    const section = SECTION.exec(line);
    if (section && !isChordLine(line)) {
      song.lines.push({ kind: 'section', text: (section[1] ?? section[2])! });
      continue;
    }
    if (isChordLine(line)) song.lines.push({ kind: 'chords', text: line });
    else if (
      !song.title &&
      (suppliedTitle === undefined ||
        (line.trim() === suppliedTitle && lines[index + 1]?.trim() === '')) &&
      format === 'text' &&
      song.lines.every((l) => l.kind === 'blank')
    )
      song.title = line.trim();
    else
      song.lines.push({
        kind: 'text',
        text: line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/_(.+?)_/g, '$1'),
      });
  }
  return song;
}

/** A supplied Library title keeps a plain-text sheet's first lyric in its body. */
export function parseSong(
  source: string,
  format: SongFormat,
  suppliedTitle?: string,
): Song {
  const song =
    format === 'chordpro'
      ? parseChordPro(source)
      : parseLines(source, format, suppliedTitle);
  // Trim blank lines at both ends and collapse runs of blanks.
  const lines = song.lines.filter(
    (line, i, all) =>
      line.kind !== 'blank' || (i > 0 && all[i - 1]!.kind !== 'blank'),
  );
  while (lines[0]?.kind === 'blank') lines.shift();
  while (lines[lines.length - 1]?.kind === 'blank') lines.pop();
  return {
    ...song,
    title: suppliedTitle ?? (song.title || 'Untitled song'),
    lines,
  };
}

/** Whether the song carries chords at all (the viewer can hide them). */
export function hasChords(song: Song) {
  return song.lines.some(
    (l) =>
      l.kind === 'chords' ||
      (l.kind === 'lyric' && l.parts.some((p) => p.chord)),
  );
}
