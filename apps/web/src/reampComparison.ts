import { type MediaLibrary, wavPath } from './api';

type Asset = MediaLibrary['assets'][number];

const MAX_LISTENING_SECONDS = 20;
const MAX_WAV_BYTES = 16 * 1024 * 1024;
const FULL_SCALE = 8388608;

export function auditionAsset(asset: Asset) {
  const {
    provenance,
    renders: [render],
  } = asset;
  return (
    asset.kind === 'reamp' &&
    provenance?.complete === true &&
    provenance.lost_samples === 0 &&
    render != null &&
    (render.channels === 1 || render.channels === 2) &&
    Number.isSafeInteger(render.frames) &&
    render.frames > 0 &&
    Number.isSafeInteger(render.rate) &&
    render.rate >= 8000 &&
    render.rate <= 96000 &&
    render.frames <= render.rate * MAX_LISTENING_SECONDS
  );
}

/** Check the saved input settings and dry content before comparing the outputs. */
export function auditionPair(a: Asset, b: Asset, assets: Asset[]) {
  if (a.id === b.id || !auditionAsset(a) || !auditionAsset(b))
    throw new Error(
      'Choose two different, complete reamps up to 20 seconds each.',
    );

  const left = a.provenance!;
  const right = b.provenance!;
  const sourceId = left.source?.id;
  const rate = a.renders[0]!.rate;
  const dry = assets
    .find((asset) => asset.kind === 'di' && asset.id === sourceId)
    ?.renders.find(
      (render) => render.sha256 === left.source?.sha256 && render.rate === rate,
    );
  if (
    !dry ||
    left.source?.sha256 !== right.source?.sha256 ||
    sourceId !== right.source?.id ||
    ![0, 1].includes(left.source?.channel) ||
    left.source.channel >= dry.channels ||
    left.source?.channel !== right.source?.channel ||
    b.renders[0]!.rate !== rate ||
    !Number.isSafeInteger(dry.frames) ||
    dry.frames < 1 ||
    dry.frames > Math.min(a.renders[0]!.frames, b.renders[0]!.frames)
  )
    throw new Error(
      'Use reamps of the same saved dry phrase, channel and sample rate.',
    );

  const validGate = (gate: unknown) => gate === null || Number.isFinite(gate);
  if (
    left.processing !== right.processing ||
    !(
      left.processing === 'none' ||
      (left.processing === 'current' &&
        Number.isFinite(left.input?.input_trim_db) &&
        left.input.input_trim_db === right.input?.input_trim_db &&
        validGate(left.input?.gate_db) &&
        left.input.gate_db === right.input?.gate_db)
    )
  )
    throw new Error(
      'Use the same input processing, guitar trim and gate for both reamps.',
    );
  return dry.frames;
}

export function reductions(a: number, b: number): [number, number] {
  return [Math.max(-18, Math.min(0, b - a)), Math.max(-18, Math.min(0, a - b))];
}

/** Oxidal exports a canonical 44-byte PCM header with packed 24-bit samples. */
export async function loadAudition(
  asset: Asset,
  phraseFrames: number,
  signal: AbortSignal,
) {
  const { channels, frames, rate } = asset.renders[0]!;
  const dataBytes = frames * channels * 3;
  const expected = 44 + dataBytes + (dataBytes % 2);
  if (expected > MAX_WAV_BYTES)
    throw new Error('This reamp is too large to audition.');

  const response = await fetch(wavPath(asset.id), {
    signal,
    cache: 'no-store',
  });
  const reader = response.body?.getReader();
  if (!response.ok || !reader)
    throw new Error(
      'Could not download the reamp audio. Reopen the audition to refresh the Library.',
    );
  const bytes = new Uint8Array(expected);
  try {
    let written = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (written + value.length > expected)
        throw new Error('The reamp is larger than its Library entry.');
      bytes.set(value, written);
      written += value.length;
    }
    const header = new DataView(bytes.buffer);
    if (
      written !== expected ||
      header.getUint32(0) !== 0x52494646 || // RIFF
      header.getUint32(8) !== 0x57415645 || // WAVE
      header.getUint32(12) !== 0x666d7420 || // fmt
      header.getUint32(16, true) !== 16 ||
      header.getUint16(20, true) !== 1 ||
      header.getUint16(22, true) !== channels ||
      header.getUint32(24, true) !== rate ||
      header.getUint16(34, true) !== 24 ||
      header.getUint32(36) !== 0x64617461 || // data
      header.getUint32(40, true) !== dataBytes
    )
      throw new Error('The reamp audio no longer matches its Library entry.');
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  const samples = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  let sum = 0;
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of samples) {
      const pcm =
        ((bytes[offset]! << 8) |
          (bytes[offset + 1]! << 16) |
          (bytes[offset + 2]! << 24)) >>
        8;
      offset += 3;
      if (pcm <= -FULL_SCALE + 1 || pcm >= FULL_SCALE - 1)
        throw new Error(
          'A reamp reached digital full scale. Make a quieter render before matching.',
        );
      const sample = pcm / FULL_SCALE;
      channel[frame] = sample;
      if (frame < phraseFrames) sum += sample * sample;
    }
  }
  const rms = 10 * Math.log10(sum / (phraseFrames * channels));
  if (!Number.isFinite(rms) || rms < -70)
    throw new Error(
      'The dry phrase is too quiet in a reamp to match reliably.',
    );
  return { rms, rate, frames, samples };
}
