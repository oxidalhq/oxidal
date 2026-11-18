/** The venue EQ's settings: seven bands and the output trim (the device's VenueSettings). */
export type VenueBand = {
  enabled: boolean;
  freqHz: number;
  gainDb?: number | null;
  q?: number | null;
  steep?: boolean | null;
};
export type VenueSettings = { bands: VenueBand[]; trimDb: number };

/**
 * The venue EQ's seven fixed bands and the response the device plays: the same
 * RBJ Audio EQ Cookbook biquads as the audio stage, evaluated at 48 kHz, so the
 * graph and the headroom check show what the outputs do.
 * @see docs/media.md
 */
type BandKind = 'highpass' | 'lowshelf' | 'bell' | 'highshelf' | 'lowpass';
export interface BandInfo {
  name: string;
  short: string;
  kind: BandKind;
  minHz: number;
  maxHz: number;
}
export const BANDS: readonly BandInfo[] = [
  { name: 'High-pass', short: 'HP', kind: 'highpass', minHz: 20, maxHz: 400 },
  { name: 'Low shelf', short: 'LS', kind: 'lowshelf', minHz: 40, maxHz: 500 },
  { name: 'Low mid', short: 'LM', kind: 'bell', minHz: 40, maxHz: 16000 },
  { name: 'Mid', short: 'M', kind: 'bell', minHz: 40, maxHz: 16000 },
  { name: 'High mid', short: 'HM', kind: 'bell', minHz: 40, maxHz: 16000 },
  {
    name: 'High shelf',
    short: 'HS',
    kind: 'highshelf',
    minHz: 1500,
    maxHz: 16000,
  },
  { name: 'Low-pass', short: 'LP', kind: 'lowpass', minHz: 2000, maxHz: 20000 },
];
export const GAIN_LIMIT = 12;
const Q_MIN = 0.3;
const Q_MAX = 8;
export const TRIM_MIN = -24;
export const TRIM_MAX = 6;
/** Above this peak boost the check warns about clipping. */
const HEADROOM_DB = 6;
const RATE = 48000;
const SHELF_Q = 0.707;
const BUTTERWORTH = [Math.SQRT1_2];
const STEEP = [0.5411961, 1.306563];

export const isPass = (index: number) =>
  BANDS[index]?.kind === 'highpass' || BANDS[index]?.kind === 'lowpass';

type Section = [number, number, number, number, number, number];

/** The biquad sections one band adds; none when it is off. */
function sections(band: VenueBand, index: number): Section[] {
  const kind = BANDS[index]!.kind;
  if (!band.enabled) return [];
  const w = (2 * Math.PI * Math.min(band.freqHz, RATE * 0.49)) / RATE;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  if (kind === 'highpass' || kind === 'lowpass')
    return (band.steep ? STEEP : BUTTERWORTH).map((q) => {
      const alpha = sin / (2 * q);
      return kind === 'highpass'
        ? [
            (1 + cos) / 2,
            -(1 + cos),
            (1 + cos) / 2,
            1 + alpha,
            -2 * cos,
            1 - alpha,
          ]
        : [
            (1 - cos) / 2,
            1 - cos,
            (1 - cos) / 2,
            1 + alpha,
            -2 * cos,
            1 - alpha,
          ];
    });
  const gain = band.gainDb ?? 0;
  if (gain === 0) return [];
  const a = 10 ** (gain / 40);
  if (kind === 'bell') {
    const alpha = sin / (2 * Math.max(0.05, band.q ?? 1));
    return [
      [
        1 + alpha * a,
        -2 * cos,
        1 - alpha * a,
        1 + alpha / a,
        -2 * cos,
        1 - alpha / a,
      ],
    ];
  }
  const k = 2 * Math.sqrt(a) * (sin / (2 * SHELF_Q));
  const sign = kind === 'lowshelf' ? 1 : -1;
  const ap = a + 1;
  const am = a - 1;
  return [
    [
      a * (ap - sign * am * cos + k),
      sign * 2 * a * (am - sign * ap * cos),
      a * (ap - sign * am * cos - k),
      ap + sign * am * cos + k,
      -sign * 2 * (am + sign * ap * cos),
      ap + sign * am * cos - k,
    ],
  ];
}

function magnitude(list: Section[], hz: number): number {
  const w = (2 * Math.PI * hz) / RATE;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let total = 0;
  for (const [b0, b1, b2, a0, a1, a2] of list) {
    const nr = b0 + b1 * c1 + b2 * c2;
    const ni = -(b1 * s1 + b2 * s2);
    const dr = a0 + a1 * c1 + a2 * c2;
    const di = -(a1 * s1 + a2 * s2);
    total += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return total;
}

/** The combined gain in dB at `hz`, before output trim. */
export function responseAt(eq: VenueSettings, hz: number): number {
  return magnitude(
    eq.bands.flatMap((band, index) => sections(band, index)),
    hz,
  );
}

/** `points` log-spaced [Hz, dB] pairs from 20 Hz to 20 kHz, before trim. */
export function responseCurve(
  eq: VenueSettings,
  points = 180,
): [number, number][] {
  const list = eq.bands.flatMap((band, index) => sections(band, index));
  return Array.from({ length: points }, (_, k) => {
    const hz = 20 * 1000 ** (k / (points - 1));
    return [hz, list.length ? magnitude(list, hz) : 0];
  });
}

/** The highest gain anywhere in 20 Hz–20 kHz, including trim. */
export function peakBoost(eq: VenueSettings): number {
  const sampled = responseCurve(eq, 480).map(([, db]) => db);
  // Bells and shelves peak at or near their own frequency: check it exactly.
  const centres = eq.bands
    .filter((band, index) => band.enabled && !isPass(index))
    .map((band) => responseAt(eq, band.freqHz));
  return Math.max(0, ...sampled, ...centres) + eq.trimDb;
}

export interface Headroom {
  peak: number;
  risky: boolean;
  /** The trim that brings the peak back to +6 dB, when it is above it. */
  trim: number | null;
}
export function headroom(eq: VenueSettings): Headroom {
  const peak = peakBoost(eq);
  if (peak <= HEADROOM_DB + 0.05) return { peak, risky: false, trim: null };
  const trim = Math.floor((eq.trimDb - (peak - HEADROOM_DB)) * 2) / 2;
  return { peak, risky: true, trim: Math.max(TRIM_MIN, trim) };
}

/** "+1.5 dB", "−3.0 dB", "0.0 dB" (true minus sign). */
export function formatDb(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(1)} dB`;
}
/** "250 Hz", "1.20 kHz", "12.0 kHz". */
export function formatHz(hz: number): string {
  return hz >= 1000
    ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz`
    : `${Math.round(hz)} Hz`;
}
/** "120", "1k", "3.5k": band buttons on narrow screens. */
export function formatHzShort(hz: number): string {
  return hz >= 1000
    ? `${Number((hz / 1000).toFixed(hz >= 10000 ? 0 : 1))}k`
    : String(Math.round(hz));
}
/** Frequencies the editor settles on: whole Hz, 10 Hz steps from 1 kHz. */
export function roundHz(hz: number): number {
  return hz >= 1000 ? Math.round(hz / 10) * 10 : Math.round(hz);
}
export const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

/** A copy of `eq` with one band changed. */
export function withBand(
  eq: VenueSettings,
  index: number,
  change: Partial<VenueBand>,
): VenueSettings {
  const bands = eq.bands.map((band, i) =>
    i === index ? { ...band, ...change } : band,
  ) as VenueSettings['bands'];
  return { ...eq, bands };
}

/** A frequency one sixth of an octave up or down, within the band's range. */
export function stepHz(index: number, hz: number, direction: -1 | 1) {
  const band = BANDS[index]!;
  return roundHz(clamp(hz * 2 ** (direction / 6), band.minHz, band.maxHz));
}
export function stepQ(q: number, direction: -1 | 1) {
  return Math.round(clamp(q * 1.25 ** direction, Q_MIN, Q_MAX) * 100) / 100;
}
