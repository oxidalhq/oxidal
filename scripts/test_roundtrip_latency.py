import importlib.util
import math
import tempfile
import unittest
import wave
from pathlib import Path


MODULE = Path(__file__).with_name('roundtrip-latency.py')
SPEC = importlib.util.spec_from_file_location('roundtrip_latency', MODULE)
roundtrip = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(roundtrip)


class RoundtripLatencyTest(unittest.TestCase):
    def test_detects_known_first_arrival_delay(self):
        sample_rate = 48000
        delay = 240
        with tempfile.TemporaryDirectory() as directory:
            stimulus = Path(directory) / 'stimulus.wav'
            capture = Path(directory) / 'capture.wav'
            roundtrip.write_stimulus(stimulus, sample_rate, 8, 0.5)
            with wave.open(str(stimulus), 'rb') as source:
                mono = source.readframes(source.getnframes())
            values = [
                int.from_bytes(mono[index:index + 2], 'little', signed=True)
                for index in range(0, len(mono), 2)
            ]
            response = [0] * len(values)
            for index, value in enumerate(values[:-delay]):
                response[index + delay] = round(value * 0.35)
                if index + delay + 3 < len(response):
                    response[index + delay + 3] += round(value * 0.08)
            frames = bytearray()
            for index, reference in enumerate(values):
                noise = round(3 * math.sin(index / 17))
                frames.extend(int(reference + noise).to_bytes(2, 'little', signed=True))
                frames.extend(int(response[index] + noise).to_bytes(2, 'little', signed=True))
            with wave.open(str(capture), 'wb') as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(sample_rate)
                output.writeframes(frames)
            result = roundtrip.analyse(capture, 0, 1, 1, 20, 250)
            self.assertEqual(result['events_detected'], 8)
            self.assertEqual(result['events_measured'], 8)
            self.assertAlmostEqual(result['latency_frames']['median'], delay, delta=2)
            self.assertLessEqual(result['latency_frames']['jitter'], 2)


if __name__ == '__main__':
    unittest.main()
