import { expect, it } from 'vitest';
import { formatOf, hasChords, isChordLine, parseSong } from './song';

it('reads ChordPro directives, sections, comments and inline chords', () => {
  const song = parseSong(
    [
      '{title: Harbour Lights}',
      '{artist: The Oxidals}',
      '{key: G}',
      '{tempo: 96}',
      '',
      '{start_of_verse}',
      '[G]Lamps along the [D]water',
      '{comment: softly}',
      '{start_of_chorus: Chorus 1}',
      'Hold on, [Em]hold [C]on',
    ].join('\n'),
    'chordpro',
  );
  expect(song).toMatchObject({
    title: 'Harbour Lights',
    artist: 'The Oxidals',
    key: 'G',
    tempo: 96,
  });
  expect(song.lines[0]).toEqual({ kind: 'section', text: 'Verse' });
  expect(song.lines[1]).toEqual({
    kind: 'lyric',
    parts: [
      { chord: 'G', text: 'Lamps along the ' },
      { chord: 'D', text: 'water' },
    ],
  });
  expect(song.lines[2]).toEqual({ kind: 'comment', text: 'softly' });
  expect(song.lines[3]).toEqual({ kind: 'section', text: 'Chorus 1' });
  expect(song.lines[4]).toEqual({
    kind: 'lyric',
    parts: [
      { chord: undefined, text: 'Hold on, ' },
      { chord: 'Em', text: 'hold ' },
      { chord: 'C', text: 'on' },
    ],
  });
});

it('reads plain text with chords over words and section labels', () => {
  const song = parseSong(
    'Night Drive\n\n[Verse]\nAm    F     C   G\nHeadlights on the hill\n\nChorus:\nF  G  Am\n',
    'text',
  );
  expect(song.title).toBe('Night Drive');
  expect(song.lines.map((l) => l.kind)).toEqual([
    'section',
    'chords',
    'text',
    'blank',
    'section',
    'chords',
  ]);
});

it('reads Markdown headings, metadata and notes', () => {
  const song = parseSong(
    '# Glass Room\n**Key**: Em\n\n## Verse\nEm  C\nWindows in the rain\n> let it ring\n',
    'markdown',
  );
  expect(song).toMatchObject({ title: 'Glass Room', key: 'Em' });
  expect(song.lines.map((l) => l.kind)).toEqual([
    'section',
    'chords',
    'text',
    'comment',
  ]);
});

it('tells chord lines from words and formats from file names', () => {
  expect(isChordLine('G  D/F#  Em7  Cadd9 | x2')).toBe(true);
  expect(isChordLine('Am I the one')).toBe(false);
  expect(isChordLine('A')).toBe(true);
  expect(formatOf('song.CHO')).toBe('chordpro');
  expect(formatOf('notes.md')).toBe('markdown');
  expect(formatOf('lyrics.txt')).toBe('text');
  expect(hasChords(parseSong('just words', 'text'))).toBe(false);
});
