import { expect, it } from 'vitest';
import { groupIrs, presentIr } from './irPresentation';
import type { LocalModel } from './api';

const folder =
  "IRs/Boutique Tones/Boutique Tones 412 Mezzabarba MZero '69 Cab G12M25 Impulse Responses (IRs) WAV/44.1 kHz/57";
const model = (name: string, parent = folder): LocalModel => ({
  id: name,
  name,
  title: name.replace(/\.wav$/, ''),
  format: 'ir',
  folder: parent,
  sha256: 'a'.repeat(64),
  audio: {
    sample_rate: 48000,
    channels: 1,
    bits_per_sample: 24,
    floating_point: false,
    frames: 9600,
    duration_ms: 200,
  },
});

it('groups sample-rate and microphone folders under the same cabinet', () => {
  const groups = groupIrs([
    model('412-MZB-MZERO69-G12M25_57_A_00_ANGLE-22.wav'),
    model(
      '412-MZB-MZERO69-G1M25_MIX-01.wav',
      folder.replace('44.1 kHz/57', '96 kHz/MIX-READY'),
    ),
    model('Custom_dark.wav', 'Other vendor/Other cabinet'),
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[0]!.cabinet).toBe("4×12 Mezzabarba MZero '69 · G12M25");
  expect(groups[0]!.files.map((f) => f.title)).toEqual([
    'Mic 57 · Position A00 · 22°',
    'Mix 1',
  ]);
  expect(groups[1]!.files[0]!.title).toBe('Custom dark');
});
it('uses measured WAV values even when the folder says another rate', () => {
  const file = presentIr(model('412-MZB-MZERO69-G12M25_57_A_00_ON-AXIS.wav'));
  expect(file.title).toBe('Mic 57 · Position A00 · On-axis');
  expect(file.technical).toBe('48 kHz · 24-bit · Mono · 200 ms');
  const unknown = model('Unknown.wav');
  delete unknown.audio;
  expect(presentIr(unknown).technical).toBe('WAV details unavailable');
});
