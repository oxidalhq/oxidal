#!/usr/bin/env python3
"""Generate and analyse a physical two-channel round-trip latency capture.

The reference and processed return must be recorded by the same capture device:
channel 1 receives a direct split of the stimulus, while channel 2 receives the
Oxidal/Jogg analog output. Their first-arrival difference includes the Jogg input
converter, ALSA stream, graph and output converter without relying on buffer math.

See docs/audio.md#physical-round-trip-latency.
"""

import argparse
import json
import math
import statistics
import struct
import sys
import wave
from pathlib import Path


def write_stimulus(path: Path, sample_rate: int, count: int, interval_s: float) -> None:
    lead_s = 1.0
    tail_s = 1.0
    burst_s = 0.004
    frequency = 2000.0
    amplitude = 10 ** (-18 / 20)
    frames = int((lead_s + (count - 1) * interval_s + tail_s) * sample_rate)
    signal = [0.0] * frames
    burst_frames = max(8, round(burst_s * sample_rate))
    for event in range(count):
        start = round((lead_s + event * interval_s) * sample_rate)
        for offset in range(burst_frames):
            window = math.sin(math.pi * offset / (burst_frames - 1)) ** 2
            signal[start + offset] = (
                amplitude
                * window
                * math.sin(2 * math.pi * frequency * offset / sample_rate)
            )
    pcm = b''.join(struct.pack('<h', round(value * 32767)) for value in signal)
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(pcm)


def decode_sample(data: bytes, width: int) -> float:
    if width == 1:
        return (data[0] - 128) / 128
    if width == 2:
        return int.from_bytes(data, 'little', signed=True) / 32768
    if width == 3:
        raw = int.from_bytes(data, 'little', signed=False)
        if raw & 0x800000:
            raw -= 1 << 24
        return raw / (1 << 23)
    if width == 4:
        return int.from_bytes(data, 'little', signed=True) / (1 << 31)
    raise ValueError(f'Unsupported PCM sample width: {width} bytes')


def read_pcm(path: Path) -> tuple[int, list[list[float]]]:
    with wave.open(str(path), 'rb') as source:
        channels = source.getnchannels()
        width = source.getsampwidth()
        sample_rate = source.getframerate()
        frames = source.getnframes()
        compression = source.getcomptype()
        raw = source.readframes(frames)
    if compression != 'NONE':
        raise ValueError('Only uncompressed PCM WAV captures are supported')
    decoded = [[] for _ in range(channels)]
    frame_bytes = channels * width
    if len(raw) != frames * frame_bytes:
        raise ValueError('Truncated WAV capture')
    for frame in range(frames):
        base = frame * frame_bytes
        for channel in range(channels):
            offset = base + channel * width
            decoded[channel].append(decode_sample(raw[offset:offset + width], width))
    return sample_rate, decoded


def smoothed_envelope(samples: list[float], width: int) -> list[float]:
    width = max(1, width)
    envelope = [0.0] * len(samples)
    running = 0.0
    for index, sample in enumerate(samples):
        running += abs(sample)
        if index >= width:
            running -= abs(samples[index - width])
        envelope[index] = running / min(index + 1, width)
    return envelope


def rms(samples: list[float]) -> float:
    if not samples:
        return 0.0
    return math.sqrt(sum(value * value for value in samples) / len(samples))


def find_reference_events(
    samples: list[float], sample_rate: int, minimum_gap_ms: float
) -> list[int]:
    envelope = smoothed_envelope(samples, max(1, sample_rate // 4000))
    peak = max(envelope, default=0.0)
    noise = rms(samples[:max(1, sample_rate // 2)])
    # Use the same relative first-arrival threshold as the return channel so
    # level differences do not bias the measured frame delta.
    threshold = max(noise * 10, peak * 0.1)
    if peak <= 0 or threshold >= peak:
        raise ValueError('No reference impulses were found')
    gap = round(minimum_gap_ms * sample_rate / 1000)
    events: list[int] = []
    index = 1
    while index < len(envelope):
        if envelope[index] >= threshold and envelope[index - 1] < threshold:
            events.append(index)
            index += gap
        else:
            index += 1
    if len(events) < 2:
        raise ValueError('Fewer than two reference impulses were found')
    return events


def first_arrival(
    response: list[float], sample_rate: int, reference: int,
    minimum_ms: float, maximum_ms: float,
) -> tuple[int, float]:
    start = reference + round(minimum_ms * sample_rate / 1000)
    stop = min(len(response), reference + round(maximum_ms * sample_rate / 1000))
    if start >= stop:
        raise ValueError('Response search window is outside the capture')
    envelope = smoothed_envelope(response, max(1, sample_rate // 4000))
    pre_start = max(0, reference - sample_rate // 10)
    noise = rms(response[pre_start:reference])
    local_peak = max(envelope[start:stop], default=0.0)
    threshold = max(noise * 8, local_peak * 0.1)
    if local_peak <= 0 or threshold >= local_peak:
        raise ValueError('No processed return followed a reference impulse')
    hold = max(2, sample_rate // 16000)
    for index in range(start, stop - hold):
        if all(envelope[position] >= threshold for position in range(index, index + hold)):
            snr_db = 20 * math.log10(local_peak / max(noise, 1e-12))
            return index, snr_db
    raise ValueError('Processed return did not cross the first-arrival threshold')


def analyse(
    path: Path, reference_channel: int, response_channel: int,
    minimum_ms: float, maximum_ms: float, minimum_gap_ms: float,
) -> dict:
    sample_rate, channels = read_pcm(path)
    if reference_channel >= len(channels) or response_channel >= len(channels):
        raise ValueError(f'Capture has {len(channels)} channels')
    events = find_reference_events(channels[reference_channel], sample_rate, minimum_gap_ms)
    measurements = []
    for reference in events:
        try:
            response, snr_db = first_arrival(
                channels[response_channel], sample_rate, reference,
                minimum_ms, maximum_ms,
            )
        except ValueError:
            continue
        samples = response - reference
        measurements.append({
            'reference_frame': reference,
            'response_frame': response,
            'latency_frames': samples,
            'latency_ms': samples * 1000 / sample_rate,
            'return_snr_db': snr_db,
        })
    if len(measurements) < 2:
        raise ValueError('Fewer than two valid round-trip measurements remain')
    latencies = [item['latency_frames'] for item in measurements]
    median_frames = statistics.median(latencies)
    return {
        'capture': str(path),
        'sample_rate': sample_rate,
        'channels': len(channels),
        'reference_channel': reference_channel + 1,
        'response_channel': response_channel + 1,
        'method': 'two-channel first-arrival difference',
        'events_detected': len(events),
        'events_measured': len(measurements),
        'latency_frames': {
            'median': median_frames,
            'minimum': min(latencies),
            'maximum': max(latencies),
            'jitter': max(latencies) - min(latencies),
        },
        'latency_ms': {
            'median': median_frames * 1000 / sample_rate,
            'minimum': min(latencies) * 1000 / sample_rate,
            'maximum': max(latencies) * 1000 / sample_rate,
            'jitter': (max(latencies) - min(latencies)) * 1000 / sample_rate,
        },
        'measurements': measurements,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    generate = commands.add_parser('generate', help='write the reference stimulus')
    generate.add_argument('--output', type=Path, required=True)
    generate.add_argument('--sample-rate', type=int, default=48000)
    generate.add_argument('--count', type=int, default=8)
    generate.add_argument('--interval', type=float, default=0.5)
    analyse_command = commands.add_parser('analyse', help='analyse a stereo capture')
    analyse_command.add_argument('--input', type=Path, required=True)
    analyse_command.add_argument('--output', type=Path)
    analyse_command.add_argument('--reference-channel', type=int, default=1)
    analyse_command.add_argument('--response-channel', type=int, default=2)
    analyse_command.add_argument('--minimum-ms', type=float, default=1)
    analyse_command.add_argument('--maximum-ms', type=float, default=100)
    analyse_command.add_argument('--minimum-gap-ms', type=float, default=250)
    analyse_command.add_argument('--interface', default='')
    analyse_command.add_argument('--firmware', default='')
    analyse_command.add_argument('--period-frames', type=int)
    analyse_command.add_argument('--period-count', type=int)
    analyse_command.add_argument('--graph-latency-frames', type=int)
    analyse_command.add_argument('--rig', default='')
    args = parser.parse_args()
    if args.command == 'generate':
        if args.sample_rate < 8000 or args.count < 2 or args.interval < 0.1:
            parser.error('use sample-rate >= 8000, count >= 2 and interval >= 0.1')
        write_stimulus(args.output, args.sample_rate, args.count, args.interval)
        return
    if args.reference_channel < 1 or args.response_channel < 1:
        parser.error('channel numbers are one-based')
    if args.minimum_ms < 0 or args.maximum_ms <= args.minimum_ms:
        parser.error('invalid latency search window')
    try:
        result = analyse(
            args.input, args.reference_channel - 1, args.response_channel - 1,
            args.minimum_ms, args.maximum_ms, args.minimum_gap_ms,
        )
    except (OSError, ValueError, wave.Error) as error:
        parser.error(str(error))
    result['test_configuration'] = {
        'interface': args.interface or None,
        'firmware': args.firmware or None,
        'period_frames': args.period_frames,
        'period_count': args.period_count,
        'graph_latency_frames': args.graph_latency_frames,
        'rig': args.rig or None,
    }
    encoded = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(encoded)
    else:
        sys.stdout.write(encoded)


if __name__ == '__main__':
    main()
