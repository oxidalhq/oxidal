#!/usr/bin/env python3
"""Exercise a prepared set with a muted reference riff and frequent telemetry.
See docs/factory-collection.md. Restores the supplied rig on normal/error exit unless another rig has taken over.
No boot settings, preset content or unit levels are written.
"""
import argparse
import copy
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--api', default='http://127.0.0.1:3230')
parser.add_argument('--settings', help='StartRig settings, or a record containing settings')
parser.add_argument('--revisions', help='Comma-separated revisions; reuse the restore snapshot stream')
parser.add_argument('--restore', required=True, help='Saved GET /api/v1/rig-audio snapshot')
parser.add_argument('--output', required=True)
parser.add_argument('--seconds', type=int, default=3600)
parser.add_argument('--frames', type=int, help='Override both period sizes for this test only')
parser.add_argument('--capture-last-hold', action='store_true', help='Capture every Hold voice in the last prepared preset')
args = parser.parse_args()
if not 1 <= args.seconds <= 86400:
    parser.error('--seconds must be between 1 and 86400')
original = json.loads(Path(args.restore).read_text())
if bool(args.settings) == bool(args.revisions):
    parser.error('use exactly one of --settings or --revisions')
if args.revisions:
    selected = [revision.strip() for revision in args.revisions.split(',') if revision.strip()]
    if len(selected) < 2 or not original.get('configured'):
        parser.error('--revisions needs at least two revisions and a configured restore snapshot')
    settings = {
        'revision': selected[0],
        'stream': copy.deepcopy(original['configured']['stream']),
        'recall': None,
        'prepared': [{'revision': revision, 'recall': None} for revision in selected[1:]],
        'midi': None,
    }
else:
    settings = json.loads(Path(args.settings).read_text())
    settings = copy.deepcopy(settings.get('settings', settings))
settings['stream']['hear_yourself'] = False
if args.frames:
    for direction in ('input', 'output'):
        settings['stream'][direction]['period_frames'] = args.frames
revisions = [settings['revision']] + [p['revision'] for p in settings['prepared']]
if len(revisions) < 2 or not original.get('configured'):
    parser.error('A prepared alternative and a configured restore snapshot are required')
result = dict(settings=settings, rigs=[], readings=[], switches=0, samples=0, required_seconds=args.seconds,
              physical_output_muted=True, observed_peak_us=0, lifetime_peak_us=0, deadline_misses=0, max_poll_gap_s=0,
              max_telemetry_gap_s=0, xruns=0, invalid_samples=0)


def request(body=None):
    req = urllib.request.Request(args.api + '/api/v1/rig-audio',
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.load(response)


def follow_output_offset():
    """Let the daemon reconcile Even Out and intentional Boost after a start."""
    with urllib.request.urlopen(args.api + '/api/v1/boosts', timeout=90) as response:
        return json.load(response)


def action(body):
    s = request()
    return request({'session': s['session'], 'expected_revision': s['revision'], 'action': body})


def rig_catalog():
    entries = []
    after = None
    while True:
        query = '?' + urllib.parse.urlencode({'after': after}) if after else ''
        with urllib.request.urlopen(args.api + '/api/v1/presets/rigs' + query, timeout=90) as response:
            page = json.load(response)
        entries.extend(page['presets'])
        after = page.get('next')
        if not after:
            return {entry['revision']: entry for entry in entries}


def settle():
    end = time.monotonic() + 90
    while time.monotonic() < end:
        s = request()
        if s['phase'] not in ('starting', 'stopping'):
            return s
        time.sleep(.1)
    raise RuntimeError('Transport timeout')


def start(config):
    action({'kind': 'stop'})
    settle()
    action({'kind': 'start', 'settings': config})
    s = settle()
    if s['phase'] != 'running':
        raise RuntimeError(s.get('error') or 'Transport did not start')
    return s


def wait_for_configuration(expected, seconds=5):
    """Wait for the authoritative configured readback after a successful start."""
    end = time.monotonic() + seconds
    state = request()
    while time.monotonic() < end:
        if state.get('configured') == expected:
            return state
        if state.get('phase') != 'running':
            raise RuntimeError('Restored transport stopped before configuration settled')
        time.sleep(.1)
        state = request()
    return state


def owns_set(state):
    configured = state.get('configured') or {}
    present = {configured.get('revision')} | {p['revision'] for p in configured.get('prepared', [])}
    return present == set(revisions)


def switch(revision):
    state = request()
    if not owns_set(state):
        raise RuntimeError('Another rig took over the audio device')
    c = state['control']
    action({'kind': 'switch', 'command': {'session': c['session'],
        'expected_revision': c['revision'], 'revision': revision, 'fade_frames': 480}})


def save():
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')


try:
    s = start(settings)
    owner = s['session']
    catalog = rig_catalog()
    result['rigs'] = [catalog.get(revision, {
        'revision': revision,
        'missing_from_library': True,
    }) for revision in revisions]
    result['worker'] = {
        'buffer_bytes': s['control']['buffer_bytes'],
        'latency_frames': s['control']['latency_frames'],
        'prepared': s['control'].get('prepared', []),
    }
    action({'kind': 'host_utility', 'command': {'kind': 'output_mute', 'enabled': True}})
    # Allow the temporary monitor fade to settle before starting measurement.
    time.sleep(.15)
    action({'kind': 'host_utility', 'command': {'kind': 'reference', 'enabled': True, 'peak_db': -18}})
    if args.capture_last_hold:
        switch(revisions[-1])
        time.sleep(3)
        controls = request()['control']['controls']
        targets = [v['target'] for v in controls if v['target'].get('kind') == 'lv2'
                   and v['target'].get('symbol') == 'hold']
        if not targets:
            raise RuntimeError('Last prepared preset has no Hold controls')
        for target in targets:
            c = request()['control']
            action({'kind': 'control', 'command': {'session': c['session'],
                'expected_revision': c['revision'], 'target': target, 'value': 1}})
        result['held_voices'] = len(targets)
        time.sleep(2)
    begin = last_poll = last_telemetry = time.monotonic()
    next_switch = begin
    next_save = begin
    next_log = begin + 60
    cursor = 0
    previous_frames = 0
    telemetry_frames = 0
    while time.monotonic() - begin < args.seconds:
        if time.monotonic() >= next_switch:
            revision = revisions[cursor % len(revisions)]
            cursor += 1
            if request()['control']['source_revision'] != revision:
                switch(revision)
                result['switches'] += 1
            next_switch = time.monotonic() + 1
        s = request()
        now = time.monotonic()
        t = s.get('telemetry')
        if s['session'] != owner or s['phase'] != 'running' or not t:
            raise RuntimeError('Audio owner stopped or changed')
        if s['processed_frames'] < previous_frames:
            raise RuntimeError('Audio clock moved backwards')
        previous_frames = s['processed_frames']
        result['samples'] += 1
        result['max_poll_gap_s'] = max(result['max_poll_gap_s'], now - last_poll)
        last_poll = now
        if t['frames'] != telemetry_frames:
            result['max_telemetry_gap_s'] = max(result['max_telemetry_gap_s'], now - last_telemetry)
            telemetry_frames = t['frames']
            last_telemetry = now
        elif now - last_telemetry > 2:
            raise RuntimeError('Audio telemetry stopped progressing')
        result['elapsed_seconds'] = now - begin
        result['observed_peak_us'] = max(result['observed_peak_us'], t['process_us_max'])
        if 'process_us_peak' not in t or 'deadline_misses' not in t:
            raise RuntimeError('Worker lacks cumulative deadline telemetry')
        result['lifetime_peak_us'] = max(result['lifetime_peak_us'], t['process_us_peak'])
        result['deadline_misses'] = max(result['deadline_misses'], t['deadline_misses'])
        result['xruns'] = max(result['xruns'], t['xruns'])
        result['invalid_samples'] = max(result['invalid_samples'], t['invalid_samples'])
        failure = t['xruns'] or t['invalid_samples'] or t['deadline_misses'] or t['process_us_peak'] >= t['deadline_us']
        if now >= next_save or failure:
            result['readings'].append({'elapsed_s': now - begin, 'frames': previous_frames, 'telemetry': t})
            save()
            next_save = now + 10
        if not t['monitoring']['output_muted'] or not t['monitoring'].get('reference'):
            raise RuntimeError('Muted reference measurement stopped')
        if failure:
            raise RuntimeError('Audio error or measured callback exceeded deadline')
        if now >= next_log:
            print('Seconds', round(now - begin), 'switches', result['switches'],
                  'peak', result['observed_peak_us'], 'xruns', result['xruns'], flush=True)
            next_log = now + 60
        time.sleep(.1)
    result['passed'] = True
except Exception as error:
    result['error'] = str(error)
    raise
finally:
    save()
    try:
        state = request()
        if not owns_set(state):
            result['restore_skipped_external_change'] = True
            print('Another rig is selected; leaving it unchanged', flush=True)
        else:
            restored = start(original['configured'])
            # Playback start is confirmed before the API's preset/scene output
            # follower runs. Trigger the same reconciliation as the player UI,
            # then compare the final authoritative configuration.
            follow_output_offset()
            restored = wait_for_configuration(original['configured'])
            result['restored_configuration'] = restored['configured'] == original['configured']
            print('Restored', restored['configured']['revision'], flush=True)
    except Exception as restore_error:
        result['restore_error'] = str(restore_error)
        raise
    finally:
        save()
