import { expect, it } from 'vitest';
import { glyphFor, glyphs } from './blockGlyphs';
import { blockKind } from './rigChain';

it('keeps captured gear as its object, whatever the capture is called', () => {
  expect(glyphFor('amp', 'Marshall JCM800')).toBe('amp');
  expect(glyphFor('full-rig')).toBe('rig');
  expect(glyphFor('amp-cab')).toBe('rig');
  expect(glyphFor('cab')).toBe('cab');
  expect(glyphFor('ir')).toBe('ir');
  // A NAM pedal capture is a stompbox even when the name says fuzz or drive.
  expect(glyphFor('pedal', 'Big Muff fuzz')).toBe('pedal');
  expect(glyphFor('outboard')).toBe('rack');
});

it('maps LV2 effects by name and never guesses an amp for unknown types', () => {
  expect(glyphFor('', 'Tape Delay')).toBe('delay');
  expect(glyphFor('', 'Plate Reverb')).toBe('reverb');
  expect(
    glyphFor('', 'http://guitarix.sourceforge.net/plugins/gx_tubescreamer'),
  ).toBe('od');
  expect(glyphFor('', 'Chorus')).toBe('chorus');
  expect(glyphFor('', 'Noise Gate')).toBe('gate');
  expect(glyphFor('', 'Brickwall Limiter')).toBe('limit');
  expect(glyphFor('', 'Octaver')).toBe('octave');
  expect(glyphFor('', 'Mystery Box')).toBe('plugin');
  expect(glyphFor('')).toBe('plugin');
});

it('lights the LED by the glyph family and covers every glyph', () => {
  expect(blockKind('', 'Tape Delay')).toBe('time');
  expect(blockKind('', 'Chorus')).toBe('mod');
  expect(blockKind('amp')).toBe('amp');
  expect(blockKind('', 'anything', 'ir')).toBe('cab');
  expect(Object.keys(glyphs)).toHaveLength(38);
  for (const glyph of Object.values(glyphs)) expect(glyph.svg).toMatch(/^</);
});
