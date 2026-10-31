"""Install asset-free examples once through the local daemon; never starts audio.

The persistent completion marker prevents deleted examples reappearing on reboot.
Partial retries reuse deterministic immutable manifests. No credentials or network
providers are accessed. @see docs/factory-collection.md
"""
import argparse
from functools import partial
import json
import os
from pathlib import Path
import time
import urllib.request


def request(path, body=None, port=3210):
    req = urllib.request.Request(f'http://127.0.0.1:{port}/api/v1/' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def seed(catalog, marker, api=request):
    if marker.exists():
        return 0
    if catalog.stat().st_size > 1024 * 1024:
        raise ValueError('Factory catalog exceeds budget')
    data = json.loads(catalog.read_text())
    sounds = data.get('sounds', [])
    if data.get('version') != 1 or not 1 <= len(sounds) <= 32:
        raise ValueError('Invalid factory catalog')
    # Validate the entire bank before making the first publication.
    for sound in sounds:
        body = sound['request']
        manifest = json.loads(body['manifest_json'])
        if (body['resources'] or manifest['resources'] or manifest['tone3000']['instances']
                or manifest['extensions']['urn:oxidal:authoring']['origin'] != 'oxidal_example'):
            raise ValueError('Factory seed must contain asset-free Oxidal examples')
    plugins = {p['uri']: p for p in api('plugins/lv2?sample_rate=48000')['plugins']}
    for sound in sounds:
        manifest = json.loads(sound['request']['manifest_json'])
        for effect in manifest['oxidal']['lv2']:
            plugin = plugins.get(effect['pluginUri'])
            if not plugin or plugin['unsupported'] or any(p['atom'] for p in plugin['ports']):
                raise ValueError('Factory effect unavailable: ' + effect['pluginUri'])
            controls = {p['symbol']: p for p in plugin['ports'] if p['input'] and p['control']}
            if set(controls) != set(effect['controls']):
                raise ValueError('Factory effect controls changed')
            for symbol, value in effect['controls'].items():
                port = controls[symbol]
                if ((port['minimum'] is not None and value < port['minimum'])
                        or (port['maximum'] is not None and value > port['maximum'])):
                    raise ValueError('Factory effect control out of range')
    revisions = []
    for sound in sounds:
        published = api('presets/rigs', sound['request'])
        details = api('presets/details')
        api('presets/details', {'expected_revision': details['revision'], 'entry_kind': 'rig',
            'id': published['revision'], 'description': sound['description'], 'categories': sound['categories']})
        revisions.append(published['revision'])
    marker.parent.mkdir(parents=True, exist_ok=True)
    pending = marker.with_suffix('.pending')
    with pending.open('w') as stream:
        stream.write(json.dumps({'version': 1, 'revisions': revisions}) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    pending.replace(marker)
    directory = os.open(marker.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return len(revisions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=Path('/opt/oxidal/factory/catalog.json'))
    parser.add_argument('--marker', type=Path, default=Path('/var/lib/oxidal/factory-installed.json'))
    parser.add_argument('--port', type=int, default=3210, help='Local daemon port, for isolated qualification')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        raise ValueError('Invalid loopback port')
    api = partial(request, port=args.port)
    if args.marker.exists():
        return
    for attempt in range(90):
        try:
            api('health')
            break
        except OSError:
            time.sleep(.5)
    else:
        raise RuntimeError('Factory seed could not reach the local daemon')
    print('Installed factory examples:', seed(args.catalog, args.marker, api))


if __name__ == '__main__':
    main()
