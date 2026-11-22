import { expect, it } from 'vitest';

import type { MonitoringHistory } from './api';
import { historyCsv, historyPoints } from './historyData';
type Sample = MonitoringHistory['records'][number];
function sample(elapsed: number, xruns: number): Sample {
  return {
    schema: 1,
    recorder_session: 'recorder',
    audio_session: 'audio',
    elapsed_ms: elapsed,
    recorded_at_ms: 1700000000000 + elapsed,
    readings: {
      source: 'native',
      audio_phase: 'running',
      graph_phase: 'stopped',
      rig_phase: 'stopped',
      sequence: elapsed,
      audio_age_ms: 100,
      xruns,
      host: {
        cpu_percent: 25,
        memory_used_bytes: 50,
        memory_total_bytes: 100,
        temperature_c: 52,
      },
      audio: {
        frames: 1,
        deadline_us: 1000,
        process_us_p50: 100,
        process_us_p95: 200,
        process_us_max: 300,
        invalid_samples: 0,
        input: [
          { clips: 0, peak_dbfs: -10, rms_dbfs: -20 },
          { clips: 0, peak_dbfs: -10, rms_dbfs: -20 },
        ],
        output: [
          { clips: 2, peak_dbfs: -1, rms_dbfs: -10 },
          { clips: 0, peak_dbfs: -3, rms_dbfs: -12 },
        ],
      },
    },
  };
}
it('derives useful percentages and interval xruns without inventing zero at a boundary', () => {
  const rows = [
    sample(0, 2),
    sample(5000, 5),
    { ...sample(10000, 0), audio_session: 'new' },
    sample(30000, 9),
  ];
  const points = historyPoints(rows);
  expect(points[0]).toMatchObject({ dsp: 20, memory: 50, xruns: null });
  expect(points[1]).toMatchObject({ cpu: 25, temperature: 52, xruns: 3 });
  expect(points[2]).toMatchObject({ dsp: null, xruns: null });
  expect(points[3]).toMatchObject({ dsp: null, xruns: null });
  expect(historyPoints([sample(0, 8), sample(5000, 3)])[1]!.xruns).toBeNull();
});
it('marks stale audio unavailable while retaining useful host metrics', () => {
  const stale = sample(5000, 5);
  stale.readings.audio_age_ms = 4000;
  const points = historyPoints([sample(0, 2), stale, sample(10000, 8)]);
  expect(points[1]).toMatchObject({ cpu: 25, dsp: null, xruns: null });
  expect(points[2]!.xruns).toBeNull();
});
it('exports explicit units, identities and missing values without spreadsheet formulas', () => {
  const row = sample(0, 2);
  row.recorder_session = '=SUM(1,2)';
  row.readings.host.temperature_c = null;
  const csv = historyCsv([row]);
  expect(csv).toContain(
    'recorded_at_utc,recorder_session,audio_session,elapsed_ms',
  );
  expect(csv).toContain('output_left_peak_dbfs');
  expect(csv).toContain('"\'=SUM(1,2)"');
  expect(csv).toContain('"100",,"100"');
  expect(csv).toContain('"-1"');
  expect(csv).not.toContain('undefined');
  expect(csv).not.toContain('NaN');
});

it('keeps physical CPU numbers across old rows, missing cores, stale audio and session changes', () => {
  const old = sample(0, 0),
    running = sample(5000, 0),
    stale = sample(10000, 0),
    changed = sample(15000, 0);
  running.readings.host.cpu_cores = [
    { core: 2, percent: 10 },
    { core: 0, percent: 90 },
  ];
  running.readings.audio!.audio_cpu = 0;
  stale.readings.host.cpu_cores = [{ core: 2, percent: null }];
  stale.readings.audio!.audio_cpu = 2;
  stale.readings.audio_age_ms = 3200;
  changed.audio_session = 'next-worker';
  changed.readings.host.cpu_cores = [{ core: 2, percent: 15 }];
  const rows = [old, running, stale, changed];
  const points = historyPoints(rows);
  expect(points[0]).not.toHaveProperty('core_2');
  expect(points[1]).toMatchObject({ core_0: 90, core_2: 10, audioCpu: 0 });
  expect(points[2]).toMatchObject({ core_2: null, audioCpu: null });
  expect(points[3]).toMatchObject({ core_2: null });
  const lines = historyCsv(rows).split('\r\n');
  expect(lines[0]).toMatch(/,audio_cpu,cpu_0_percent,cpu_2_percent$/);
  expect(lines[1]).toMatch(/,,,$/);
  expect(lines[2]).toMatch(/,"0","90","10"$/);
  expect(lines[3]).toMatch(/,,,$/);
});
