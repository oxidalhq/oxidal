#!/usr/bin/env python3
"""Effects matrix: publish serial stereo-LV2 chains after one NAM and measure each prepared against a baseline.

Runs on the device. Rigs are named 'Cap · fx N' so they are easy to remove.
"""
import argparse, copy, json, subprocess, sys, time, urllib.request, uuid
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--api', default='http://127.0.0.1:3210')
p.add_argument('--restore', required=True)
p.add_argument('--base-name', default='Bogner Fullstack + Octave')
p.add_argument('--baseline-name', default='Oxidal · Clear Current')
p.add_argument('--counts', default='2,4,8,12')
p.add_argument('--frames', type=int, default=128)
p.add_argument('--seconds', type=int, default=30)
p.add_argument('--out', required=True)
p.add_argument('--publish-only', action='store_true')
a = p.parse_args()
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

def get(path):
    return json.load(urllib.request.urlopen(a.api + '/api/v1' + path, timeout=90))

def post(path, body):
    r = urllib.request.Request(a.api + '/api/v1' + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=180))

rigs = get('/presets/rigs')['presets']
by_name = {r['name']: r for r in rigs if not r['name'].startswith('Cap')}
base = get('/presets/rigs/' + by_name[a.base_name]['revision'])['manifest']
baseline = by_name[a.baseline_name]['revision']

# Stereo (2 in / 2 out) LV2 templates harvested from existing rigs.
templates = {}
for r in rigs:
    m = get('/presets/rigs/' + r['revision'])['manifest']['oxidal']
    ctl = {x['id']: x for x in m.get('lv2', [])}
    for n in m['graph']['nodes']:
        if n['kind'] == 'lv2' and (n['audioInputs'], n['audioOutputs']) == (2, 2) and n['id'] in ctl:
            templates.setdefault(ctl[n['id']]['pluginUri'], (n, ctl[n['id']]))
uris = sorted(templates)
print('stereo lv2 templates:', len(uris), flush=True)

def build(count):
    m = copy.deepcopy(base)
    ox = m['oxidal']
    drop = {x['id'] for x in ox['lv2']}
    ox['graph']['nodes'] = [n for n in ox['graph']['nodes'] if n['id'] not in drop and n['kind'] != 'merge' and n['id'] != 'out']
    ox['graph']['edges'] = [e for e in ox['graph']['edges'] if e['from']['node'] not in drop | {'split-left', 'split-right'} or e['from']['node'].startswith('split') and e['to']['node'].startswith('native')]
    ox['graph']['edges'] = [e for e in ox['graph']['edges'] if e['to']['node'] in {'split-left', 'split-right'} or e['to']['node'].startswith('native')]
    ox['lv2'] = []
    labels = m['extensions']['urn:oxidal:authoring']['labels']
    nat = next(n['id'] for n in ox['graph']['nodes'] if n['kind'] == 'tone3000')
    ox['graph']['nodes'] += [{'id': 'out', 'kind': 'output', 'audioInputs': 2, 'audioOutputs': 0}]
    ox['graph']['nodes'] += [{'id': 'merge-left', 'kind': 'merge', 'audioInputs': 1, 'audioOutputs': 1},
                             {'id': 'merge-right', 'kind': 'merge', 'audioInputs': 1, 'audioOutputs': 1}]
    # NAM outputs go straight to the first effect (or output); merges keep a stable id per channel.
    prev = [(nat, 0), (nat, 1)]
    for i in range(count):
        node_t, ctl_t = templates[uris[i % len(uris)]]
        nid = f'fx-{uuid.uuid4()}'
        n = copy.deepcopy(node_t); n['id'] = nid; n['instance'] = nid
        c = copy.deepcopy(ctl_t); c['id'] = nid
        ox['graph']['nodes'].append(n); ox['lv2'].append(c); labels[nid] = f'Cap fx {i + 1}'
        for ch in (0, 1):
            ox['graph']['edges'].append({'from': {'node': prev[ch][0], 'port': prev[ch][1]}, 'to': {'node': nid, 'port': ch}})
        prev = [(nid, 0), (nid, 1)]
    for ch in (0, 1):
        ox['graph']['edges'].append({'from': {'node': prev[ch][0], 'port': prev[ch][1]}, 'to': {'node': 'out', 'port': ch}})
    ox['graph']['nodes'] = [n for n in ox['graph']['nodes'] if n['kind'] != 'merge']
    m['id'] = str(uuid.uuid4()); m['name'] = f'Cap · fx {count}'
    return m

rows = []
for count in (int(x) for x in a.counts.split(',')):
    m = build(count)
    bindings = {r['id']: {'kind': 'original', 'preset': r['sha256']} for r in base['resources']}
    try:
        doc = post('/presets/rigs', {'manifest_json': json.dumps(m), 'resources': bindings})
    except Exception as e:
        body = getattr(e, 'read', lambda: b'')().decode()[:300]
        rows.append(dict(fx=count, ok=False, error=f'publish: {e} {body}')); print(rows[-1], flush=True); break
    row = dict(fx=count, revision=doc['revision'])
    if not a.publish_only:
        dest = out / f'fx{count}.json'
        proc = subprocess.run([sys.executable, str(Path(__file__).with_name('qualify-prepared.py')), '--api', a.api,
            '--revisions', f"{doc['revision']},{baseline}", '--restore', a.restore, '--output', str(dest),
            '--seconds', str(a.seconds), '--frames', str(a.frames)], capture_output=True, text=True)
        if dest.exists():
            d = json.loads(dest.read_text())
            row.update({k: d.get(k) for k in ('passed', 'xruns', 'deadline_misses', 'observed_peak_us')})
        row['error'] = proc.stderr.strip()[-200:] or None
        row['ok'] = bool(row.get('passed')) and proc.returncode == 0
    rows.append(row); print(json.dumps(row), flush=True)
    (out / 'matrix.json').write_text(json.dumps(rows, indent=1))
    if not row.get('ok', True): break
