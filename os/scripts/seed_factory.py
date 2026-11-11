"""Install asset-free examples once through the local daemon; never starts audio.

The image carries no third-party effect packs: the player installs those. An
example is saved here only when every effect it uses is already on the unit;
the others are left for the web interface, which saves each one as soon as its
pack is installed. The persistent completion marker prevents deleted examples
reappearing on reboot.
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


GENRES = {'Clean', 'Edge of breakup', 'Funk', 'Blues', 'Country', 'Jazz', 'Pop', 'Classic rock',
    'Hard rock', 'Modern metal', 'Progressive', 'Ambient', 'Post-rock', 'Synth', 'Bass', 'Lo-fi',
    'Experimental'}
ENGINES = {'lv2', 'tone3000-a2-lite', 'tone3000-a2-full', 'hybrid'}
COMPLEXITIES = {'simple', 'layered', 'complex'}


def check_metadata(metadata):
    """Sound metadata is optional; when present it must match the daemon's rules."""
    if metadata is None:
        return
    genres = metadata.get('genres')
    if (not isinstance(genres, list) or not 1 <= len(genres) <= 3 or len(set(genres)) != len(genres)
            or any(g not in GENRES for g in genres)):
        raise ValueError('Factory metadata needs one to three listed genres')
    if metadata.get('engine') not in ENGINES or metadata.get('complexity') not in COMPLEXITIES:
        raise ValueError('Factory metadata has an unknown engine or complexity')
    # Image examples carry no captures, so they never need NAM instances.
    if metadata.get('engine') != 'lv2' or metadata.get('nam_instances', 0) != 0:
        raise ValueError('Factory seed metadata must describe an LV2-only sound')


def playable(sound, plugins, layouts):
    """Whether this unit has every effect of the example, exactly as it was designed."""
    manifest = json.loads(sound['request']['manifest_json'])
    for effect in manifest['oxidal']['lv2']:
        plugin = plugins.get(effect['pluginUri'])
        if not plugin or plugin['unsupported']:
            return False
        if any(p['atom'] for p in plugin['ports']):
            actual = {'controls': sorted(p['symbol'] for p in plugin['ports'] if p['control'] and p['input']),
                      'atoms': sorted(p['symbol'] for p in plugin['ports'] if p['atom'])}
            if layouts.get(plugin['uri']) != actual:
                return False
        controls = {p['symbol']: p for p in plugin['ports'] if p['input'] and p['control']}
        if set(controls) != set(effect['controls']):
            return False
        for symbol, value in effect['controls'].items():
            port = controls[symbol]
            if ((port['minimum'] is not None and value < port['minimum'])
                    or (port['maximum'] is not None and value > port['maximum'])):
                return False
    return True


def seed(catalog, marker, api=request):
    if marker.exists():
        return 0
    if catalog.stat().st_size > 1024 * 1024:
        raise ValueError('Factory catalog exceeds budget')
    data = json.loads(catalog.read_text())
    sounds = data.get('sounds', [])
    if data.get('version') != 1 or not 1 <= len(sounds) <= 64:
        raise ValueError('Invalid factory catalog')
    # Validate the entire bank before making the first publication.
    for sound in sounds:
        body = sound['request']
        check_metadata(sound.get('metadata'))
        manifest = json.loads(body['manifest_json'])
        if (body['resources'] or manifest['resources'] or manifest['tone3000']['instances']
                or manifest['extensions']['urn:oxidal:authoring']['origin'] != 'oxidal_example'):
            raise ValueError('Factory seed must contain asset-free Oxidal examples')
    plugins = {p['uri']: p for p in api('plugins/lv2?sample_rate=48000')['plugins']}
    sounds = [sound for sound in sounds if playable(sound, plugins, data.get('scalar_layouts', {}))]
    revisions = []
    for sound in sounds:
        published = api('presets/rigs', sound['request'])
        details = api('presets/details')
        update = {'expected_revision': details['revision'], 'entry_kind': 'rig',
            'id': published['revision'], 'description': sound['description'], 'categories': sound['categories']}
        if sound.get('metadata') is not None:
            update['metadata'] = sound['metadata']
        api('presets/details', update)
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
