#!/usr/bin/env python3
"""Resident-count capacity ladder (Sprint 06, 6.1/6.3). Run on the device.

Climbs a ladder of prepared resident sets (most native instances first) at each
buffer size with scripts/qualify-prepared.py, muted, and records one row per rung.
A rung passes only with zero xruns, deadline misses and invalid samples. The
ladder at a buffer size stops at its first failure, which stays in the output.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--rigs', required=True, help='JSON with presets[{revision,name,native_instances}]')
p.add_argument('--restore', required=True, help='GET /api/v1/rig-audio snapshot to restore')
p.add_argument('--api', default='http://127.0.0.1:3210')
p.add_argument('--frames', default='256,128,64')
p.add_argument('--counts', default='2,3,4,6,8,10,12,16')
p.add_argument('--seconds', type=int, default=45)
p.add_argument('--out', required=True)
a = p.parse_args()
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
rigs = [r for r in json.loads(Path(a.rigs).read_text())['presets'] if r.get('native_instances', 0) > 0]
rigs.sort(key=lambda r: -r['native_instances'])
rows = []
for frames in (int(x) for x in a.frames.split(',')):
    for count in (int(x) for x in a.counts.split(',')):
        if count > len(rigs):
            break
        chosen = rigs[:count]
        tag = f'f{frames}-r{count}'
        dest = out / f'{tag}.json'
        t0 = time.time()
        proc = subprocess.run([sys.executable, str(Path(__file__).with_name('qualify-prepared.py')),
            '--api', a.api, '--revisions', ','.join(r['revision'] for r in chosen), '--restore', a.restore,
            '--output', str(dest), '--seconds', str(a.seconds), '--frames', str(frames)],
            capture_output=True, text=True)
        row = dict(frames=frames, residents=count, native_instances=sum(r['native_instances'] for r in chosen),
                   exit=proc.returncode, wall_s=round(time.time() - t0, 1), error=proc.stderr.strip()[-300:] or None)
        if dest.exists():
            d = json.loads(dest.read_text())
            row.update({k: d.get(k) for k in ('passed', 'xruns', 'deadline_misses', 'invalid_samples',
                                              'observed_peak_us', 'lifetime_peak_us', 'switches')})
        row['ok'] = bool(row.get('passed')) and proc.returncode == 0
        rows.append(row)
        print(json.dumps(row), flush=True)
        (out / 'ladder.json').write_text(json.dumps(rows, indent=1))
        if not row['ok']:
            break
