import type { Reading } from './readings-table';

/**
 * Levels › Overview readings as the app builds them from the device, with
 * sample values. Same groups, labels and explanations as the product page.
 */
export const LEVELS_READINGS: {
  title: string;
  note: string;
  readings: Reading[];
}[] = [
  {
    title: 'Loudness',
    note: 'Reference riff · before intentional Boost',
    readings: [
      {
        id: 'target',
        label: 'Target',
        value: '−20.0 LUFS',
        detail:
          '403 current · 0 stale after changes · 6 never measured · 409 total.',
      },
      {
        id: 'before',
        label: 'Before correction',
        value: '45.9 LU spread',
        attention: true,
        detail:
          'Funk Engine · Solo 1.8 LUFS · Everything On · Clean −44.0 LUFS',
      },
      {
        id: 'after',
        label: 'After correction',
        value: '0.5 LU spread',
        detail:
          'Funk Engine · Solo −20.2 LUFS · Everything On · Clean −20.0 LUFS. Intentional Boost remains on top.',
      },
    ],
  },
  {
    title: 'Guitar',
    note: 'Before every rig',
    readings: [
      {
        id: 'trim',
        label: 'Steinberger',
        value: '0.0 dB',
        detail: 'Trim. Strum −17.9 dBFS · noise −35.6 dBFS',
      },
      {
        id: 'profile',
        label: 'Profile health',
        value: 'Input changed',
        attention: true,
        detail:
          'Checked at 256 × 3; now 128 × 3. Remeasure after changing the physical input-gain knob or the guitar’s output level; Oxidal cannot read either control.',
      },
    ],
  },
  {
    title: 'Interface',
    note: 'Current digital stream',
    readings: [
      {
        id: 'stream',
        label: 'Live',
        value: '48 kHz',
        detail: 'Jogg USB Audio in and out · 128 frames × 3',
      },
      {
        id: 'peaks',
        label: 'Input / output peak',
        value: '−12.4 dBFS / −9.8 dBFS',
        detail: '0 input clips · 0 output clips in this audio session.',
      },
      {
        id: 'gain',
        label: 'Input gain guidance',
        value: 'Measured level is usable',
        detail:
          'Profile strum −17.9 dBFS before trim. Re-measure after changing the physical input-gain knob; Oxidal cannot read that knob.',
      },
    ],
  },
  {
    title: 'Playing level stages',
    note: 'Shown separately so correction is not confused with solo Boost',
    readings: [
      {
        id: 'trim',
        label: 'Guitar trim',
        value: '0.0 dB',
        detail: 'Before the rig; selected by the active guitar profile.',
      },
      {
        id: 'even',
        label: 'Even out correction',
        value: '+4.5 dB',
        detail: 'Measured correction for the sounding preset or scene.',
      },
      {
        id: 'preset',
        label: 'Preset Boost',
        value: '0.0 dB',
        detail: 'Intentional extra level on the sounding preset.',
      },
      {
        id: 'master',
        label: 'Master Level',
        value: '+3.0 dB',
        detail:
          'Unit-wide digital output after the rig; not the interface’s physical knob.',
      },
    ],
  },
];
