import type { MonitoringHistory } from './api';
type Sample = MonitoringHistory['records'][number];
export function historyPoints(records: Sample[]) {
  return records.map((record, index) => {
    const sample = record.readings;
    const previous = records[index - 1];
    const boundary =
      !!previous &&
      (previous.recorder_session !== record.recorder_session ||
        previous.audio_session !== record.audio_session ||
        record.elapsed_ms <= previous.elapsed_ms ||
        record.elapsed_ms - previous.elapsed_ms > 15000);
    const valid =
      sample.audio && sample.audio_age_ms != null && sample.audio_age_ms < 3000;
    const oldXruns = previous?.readings.xruns;
    return {
      time: new Date(record.recorded_at_ms).toLocaleTimeString(),
      cpu: boundary ? null : sample.host.cpu_percent,
      dsp:
        !boundary && valid && sample.audio!.deadline_us > 0
          ? (100 * sample.audio!.process_us_p95) / sample.audio!.deadline_us
          : null,
      memory:
        boundary ||
        !sample.host.memory_total_bytes ||
        sample.host.memory_used_bytes == null
          ? null
          : (100 * sample.host.memory_used_bytes) /
            sample.host.memory_total_bytes,
      temperature: boundary ? null : sample.host.temperature_c,
      xruns:
        !boundary &&
        valid &&
        previous &&
        previous.readings.audio_age_ms != null &&
        previous.readings.audio_age_ms < 3000 &&
        oldXruns != null &&
        sample.xruns != null &&
        sample.xruns >= oldXruns
          ? sample.xruns - oldXruns
          : null,
    };
  });
}
/** Snapshot export, explicit units and blanks for unavailable readings. */
export function historyCsv(records: Sample[]) {
  const cell = (value: unknown) => {
    if (value == null) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text))
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const columns = [
    'recorded_at_utc',
    'recorder_session',
    'audio_session',
    'elapsed_ms',
    'source',
    'cpu_percent',
    'memory_used_bytes',
    'memory_total_bytes',
    'temperature_c',
    'audio_age_ms',
    'deadline_us',
    'process_us_p95',
    'process_us_max',
    'xruns_total',
    'output_left_peak_dbfs',
    'output_right_peak_dbfs',
    'output_left_clips_total',
    'output_right_clips_total',
  ];
  return (
    [
      columns.join(','),
      ...records.map((r) => {
        const s = r.readings,
          a = s.audio;
        return [
          new Date(r.recorded_at_ms).toISOString(),
          r.recorder_session,
          r.audio_session,
          r.elapsed_ms,
          s.source,
          s.host.cpu_percent,
          s.host.memory_used_bytes,
          s.host.memory_total_bytes,
          s.host.temperature_c,
          s.audio_age_ms,
          a?.deadline_us,
          a?.process_us_p95,
          a?.process_us_max,
          s.xruns,
          a?.output[0].peak_dbfs,
          a?.output[1].peak_dbfs,
          a?.output[0].clips,
          a?.output[1].clips,
        ]
          .map(cell)
          .join(',');
      }),
    ].join('\r\n') + '\r\n'
  );
}
