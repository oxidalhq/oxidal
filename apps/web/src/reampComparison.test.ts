import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaLibrary } from './api';
import { auditionPair, loadAudition, reductions } from './reampComparison';

type Asset = MediaLibrary['assets'][number];

const dry: Asset = {
  schema: 1,
  kind: 'di',
  id: 'dry',
  title: 'Dry guitar',
  created_at: '2026-11-21T03:00:00.000Z',
  renders: [
    {
      channels: 1,
      file: 'play-48000.f32',
      frames: 2,
      rate: 48000,
      sha256: 'dry',
    },
  ],
};

const reamp = (id: string): Asset => ({
  ...dry,
  kind: 'reamp',
  id,
  renders: [{ ...dry.renders[0]!, channels: 2, frames: 3, sha256: id }],
  provenance: {
    complete: true,
    lost_samples: 0,
    source: { id: dry.id, sha256: dry.renders[0]!.sha256, channel: 0 },
    processing: 'current',
    input: { input_trim_db: -6, gate_db: null },
  },
});

function wav(samples: number[]) {
  const bytes = new ArrayBuffer(44 + samples.length * 3);
  const view = new DataView(bytes);
  view.setUint32(0, 0x52494646);
  view.setUint32(8, 0x57415645);
  view.setUint32(12, 0x666d7420);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true);
  view.setUint16(34, 24, true);
  view.setUint32(36, 0x64617461);
  view.setUint32(40, samples.length * 3, true);
  samples.forEach((value, index) => {
    const offset = 44 + index * 3;
    const pcm = Math.round(value * 8388608);
    view.setUint16(offset, pcm & 65535, true);
    view.setUint8(offset + 2, (pcm >> 16) & 255);
  });
  return new Response(bytes);
}

afterEach(() => vi.unstubAllGlobals());

describe('saved dry phrase audition', () => {
  it('requires complete reamps of the same dry content and applied input settings', () => {
    const a = reamp('a');
    const b = reamp('b');
    expect(auditionPair(a, b, [dry])).toBe(2);
    expect(() => auditionPair(a, b, [])).toThrow('same saved dry phrase');
    b.provenance!.input.gate_db = -50;
    expect(() => auditionPair(a, b, [dry])).toThrow('same input processing');
    b.provenance!.lost_samples = 2;
    expect(() => auditionPair(a, b, [dry])).toThrow('complete reamps');
  });

  it('measures 24-bit stereo RMS over the dry phrase and attenuates only the louder side', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(wav([0.5, -0.5, 0.5, -0.5, 0.95, 0.95])),
    );
    const reading = await loadAudition(
      reamp('a'),
      2,
      new AbortController().signal,
    );
    expect(reading.rms).toBeCloseTo(20 * Math.log10(0.5), 6);
    expect(reading.samples[1]![0]).toBe(-0.5);
    expect(reductions(reading.rms, reading.rms + 6)).toEqual([0, -6]);
    expect(reductions(reading.rms - 30, reading.rms)).toEqual([0, -18]);
  });

  it('rejects clipped audio and changed render lengths', async () => {
    const signal = new AbortController().signal;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(wav([0.5, -0.5, 0.5, -0.5, -1, 0.5]))
      .mockResolvedValueOnce(wav([0.5, -0.5, 0.5, -0.5]));
    vi.stubGlobal('fetch', fetch);
    await expect(loadAudition(reamp('a'), 2, signal)).rejects.toThrow(
      'digital full scale',
    );
    await expect(loadAudition(reamp('a'), 2, signal)).rejects.toThrow(
      'no longer matches',
    );
  });
});
