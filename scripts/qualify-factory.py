#!/usr/bin/env python3
"""Real-device factory smoke/scene qualification. See docs/factory-collection.md.
Replaces the playing rig temporarily; a built-in riff is measured with output muted.
Restores the supplied owner snapshot on every normal/error exit. Never writes boot state.
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--api', default='http://127.0.0.1:3230')
parser.add_argument('--published', required=True)
parser.add_argument('--restore', required=True, help='Saved GET /api/v1/rig-audio snapshot')
parser.add_argument('--output', required=True)
args = parser.parse_args()
original = json.loads(Path(args.restore).read_text())
items = json.loads(Path(args.published).read_text())
results = []


def request(body=None):
    req = urllib.request.Request(args.api + '/api/v1/rig-audio',
        data=json.dumps(body).encode() if body else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


def action(value):
    state = request()
    return request({'session': state['session'], 'expected_revision': state['revision'], 'action': value})


def settle():
    end = time.monotonic() + 90
    while time.monotonic() < end:
        state = request()
        if state['phase'] not in ('starting', 'stopping'):
            return state
        time.sleep(.2)
    raise RuntimeError('Transport did not settle')


def reference(enabled):
    action({'kind': 'host_utility', 'command': {'kind': 'reference', 'enabled': enabled, 'peak_db': -18}})


def start(settings):
    action({'kind': 'stop'})
    settle()
    action({'kind': 'start', 'settings': settings})
    state = settle()
    if state['phase'] != 'running':
        raise RuntimeError(state.get('error') or state['phase'])
    return state


try:
    for item in items:
        record = dict(item, scenes=[])
        try:
            state = start(dict(revision=item['revision'], stream=original['configured']['stream'],
                               recall=None, prepared=[], midi=None))
            for scene in state['control']['scenes']['scenes']:
                current = request()['control']
                action({'kind': 'scene', 'command': {'session': current['session'],
                       'expected_revision': current['revision'], 'scene': scene['id'], 'release_ms': 750}})
                reference(True)
                time.sleep(4.5)
                measured = request()
                reference(False)
                telemetry = measured['telemetry']
                reading = telemetry['monitoring'].get('reference')
                record['scenes'].append(dict(scene=scene, reference=reading, telemetry=telemetry))
                if not reading or reading.get('lufs') is None:
                    raise RuntimeError('No measured output from reference riff')
            # Rapid scene retargets exercise Blend while the input is non-silent.
            reference(True)
            for i in range(40):
                current = request()['control']
                action({'kind': 'scene', 'command': {'session': current['session'],
                       'expected_revision': current['revision'],
                       'scene': state['control']['scenes']['scenes'][i % 4]['id'], 'release_ms': 750}})
                time.sleep(.04)
            record['final'] = request()['telemetry']
            reference(False)
        except Exception as error:
            record['error'] = str(error)
        results.append(record)
        Path(args.output).write_text(json.dumps(results, indent=2))
        t = record.get('final', {})
        print(item['id'], record.get('error', 'measured'), 'xruns', t.get('xruns'),
              'p95/max', t.get('process_us_p95'), t.get('process_us_max'), flush=True)
finally:
    action({'kind': 'stop'})
    settle()
    if original['phase'] == 'running':
        restored = start(original['configured'])
        print('Restored', restored['configured']['revision'], flush=True)
