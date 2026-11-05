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
p.add_argument('--topology', choices=['serial', 'pre', 'reverb', 'parallel'], default='serial')
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

REVERBS = [u for u in uris if 'reverb' in u or 'zita' in u]

def build(count, topology):
    m = copy.deepcopy(base)
    ox = m['oxidal']
    nodes = {n['id']: n for n in ox['graph']['nodes']}
    nat = next(n['id'] for n in ox['graph']['nodes'] if n['kind'] == 'tone3000')
    labels = m['extensions']['urn:oxidal:authoring']['labels']
    ox['lv2'] = []
    pool = REVERBS if topology == 'reverb' else uris
    fx = []
    for i in range(count):
        node_t, ctl_t = templates[pool[i % len(pool)]]
        nid = f'fx-{uuid.uuid4()}'
        n = copy.deepcopy(node_t); n['id'] = nid; n['instance'] = nid
        c = copy.deepcopy(ctl_t); c['id'] = nid
        ox['lv2'].append(c); labels[nid] = f'Cap fx {i + 1}'; fx.append(n)
    edges = []
    def e(f, fp, t, tp): edges.append({'from': {'node': f, 'port': fp}, 'to': {'node': t, 'port': tp}})
    def chain(src, nodes_):  # src: [(node, port)] x2 -> returns the final pair
        for n in nodes_:
            for ch in (0, 1): e(src[ch][0], src[ch][1], n['id'], ch)
            src = [(n['id'], 0), (n['id'], 1)]
        return src
    keep = [nodes['in'], nodes['split-left'], nodes['split-right'], nodes[nat]]
    out = {'id': 'out', 'kind': 'output', 'audioInputs': 2, 'audioOutputs': 0}
    if topology == 'parallel':
        # B = count + 1 branches (NAM + fx) per channel via nested binary split/merge.
        branches = [nat] + [n['id'] for n in fx]
        B = len(branches)
        extra = []
        for ch, side in ((0, 'L'), (1, 'R')):
            src = ('in', ch)
            for k in range(B - 1):
                sid = f'split-{side}{k}'
                extra.append({'id': sid, 'kind': 'split', 'audioInputs': 1, 'audioOutputs': 2})
                e(src[0], src[1], sid, 0)
                e(sid, 0, branches[k], ch)
                src = (sid, 1)
            e(src[0], src[1], branches[B - 1], ch)
            nxt = (branches[B - 1], ch)
            for k in range(B - 2, -1, -1):
                mid = f'merge-{side}{k}'
                extra.append({'id': mid, 'kind': 'merge', 'audioInputs': 2, 'audioOutputs': 1, 'inputGains': [1.0, 1.0]})
                e(branches[k], ch, mid, 0)
                e(nxt[0], nxt[1], mid, 1)
                nxt = (mid, 0)
            e(nxt[0], nxt[1], 'out', ch)
        ox['graph']['nodes'] = [nodes['in'], nodes[nat]] + fx + extra + [out]
    else:
        e('in', 0, 'split-left', 0)  # placeholder replaced below
        edges.clear()
        if topology == 'pre':
            end = chain([('in', 0), ('in', 1)], fx)
            e(end[0][0], end[0][1], 'split-left', 0); e(end[1][0], end[1][1], 'split-right', 0)
            e('split-left', 0, nat, 0); e('split-right', 0, nat, 1)
            e(nat, 0, 'out', 0); e(nat, 1, 'out', 1)
        else:
            e('in', 0, 'split-left', 0); e('in', 1, 'split-right', 0)
            e('split-left', 0, nat, 0); e('split-right', 0, nat, 1)
            end = chain([(nat, 0), (nat, 1)], fx)
            e(end[0][0], end[0][1], 'out', 0); e(end[1][0], end[1][1], 'out', 1)
        ox['graph']['nodes'] = keep + fx + [out]
    ox['graph']['edges'] = edges
    m['id'] = str(uuid.uuid4()); m['name'] = f'Cap · {topology} {count}'
    return m

rows = []
for count in (int(x) for x in a.counts.split(',')):
    m = build(count, a.topology)
    bindings = {r['id']: {'kind': 'original', 'preset': r['sha256']} for r in base['resources']}
    try:
        doc = post('/presets/rigs', {'manifest_json': json.dumps(m), 'resources': bindings})
    except Exception as e:
        body = getattr(e, 'read', lambda: b'')().decode()[:300]
        rows.append(dict(fx=count, ok=False, error=f'publish: {e} {body}')); print(rows[-1], flush=True); break
    row = dict(topology=a.topology, fx=count, revision=doc['revision'])
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
