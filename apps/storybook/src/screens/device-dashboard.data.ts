/** Example readings in the shape the device reports (monitor.rs) or would report. */
export const STREAM = {
  device: 'Hotone Jogg',
  rate: 48000,
  frames: 128,
  periods: 3,
  hours: 41.3,
  xruns: 0,
  recovered: 2,
};

export const CORES = [
  { load: 64, audio: true },
  { load: 41, audio: true },
  { load: 18, audio: false },
  { load: 9, audio: false },
];

export const DISK = {
  used: 11.2,
  total: 29.1,
  parts: [
    { name: 'System', gb: 4.1 },
    { name: 'Models and IRs', gb: 2.3 },
    { name: 'Stems and backing tracks', gb: 3.9 },
    { name: 'Plugin packs', gb: 0.4 },
    { name: 'Recordings', gb: 0.5 },
  ],
};

export type AuditRecord = {
  at: string;
  operation: string;
  outcome: 'Accepted' | 'Refused' | 'Failed';
  status: number;
  ms: number;
};

/** Redacted control requests, newest first (audit.rs). */
export const AUDIT: AuditRecord[] = [
  {
    at: '21:42:08',
    operation: 'Change a block value',
    outcome: 'Accepted',
    status: 202,
    ms: 4,
  },
  {
    at: '21:42:03',
    operation: 'Switch scene',
    outcome: 'Accepted',
    status: 202,
    ms: 3,
  },
  {
    at: '21:41:57',
    operation: 'Load preset',
    outcome: 'Accepted',
    status: 202,
    ms: 38,
  },
  {
    at: '21:40:12',
    operation: 'Change engine setting',
    outcome: 'Refused',
    status: 409,
    ms: 6,
  },
  {
    at: '21:39:50',
    operation: 'Install plugin pack',
    outcome: 'Failed',
    status: 503,
    ms: 1204,
  },
  {
    at: '21:38:31',
    operation: 'Save preset',
    outcome: 'Accepted',
    status: 200,
    ms: 22,
  },
];

/** Ten minutes at one reading every ten seconds, steady enough to compare. */
export function history(base: number, swing: number, seed: number, n = 60) {
  return Array.from({ length: n }, (_, i) => {
    const wave =
      Math.sin(i * 0.31 + seed) * swing +
      Math.sin(i * 0.09 + seed * 2) * swing * 0.6;
    return { t: (i - (n - 1)) / 6, v: Math.round((base + wave) * 10) / 10 };
  });
}

export const PROCESSING = history(52, 9, 1);
export const TEMPERATURE = history(58, 3, 2);
export const MEMORY = history(2.6, 0.15, 3);
export const CORE_HISTORY = CORES.map((c, i) =>
  history(c.load, c.load / 5, i + 4),
);

/** Dropouts per minute over the last ten minutes. */
export const DROPOUTS = Array.from({ length: 10 }, (_, i) => ({
  minute: i - 9,
  count: i === 3 ? 2 : i === 7 ? 1 : 0,
}));
