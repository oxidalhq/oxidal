"""Sanitize a private library backup into an image overlay; never includes accounts.

Only use for owner-authorized development images, never public distribution.
The original archive remains a separate recovery copy. No arbitrary extraction.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

OMIT = {'accounts', 'control-audit', 'monitor-history', 'native-runtime',
        'audio-runtime', 'rig-runtime', 'graph-runtime', 'create-runtime',
        'save-runtime', 'boot-audio.json', 'last-audio-session.json', 'last-rig-session.json'}
MAX_BYTES = 16 * 1024**3


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024**2), b''):
            digest.update(block)
    return digest.hexdigest()


def inspect(archive):
    seen, selected, total, manifests = set(), [], 0, {}
    members = archive.getmembers()
    if len(members) > 200000:
        raise ValueError('Library has too many archive entries')
    for entry in members:
        name = entry.name.rstrip('/')
        parts = name.split('/')
        if (not name or len(name) > 4096 or any(p in ('', '.', '..') for p in parts)
                or '\\' in name or any(ord(c) < 32 for c in name)
                or PurePosixPath(name).is_absolute() or name in seen):
            raise ValueError('Unsafe or duplicate library path')
        seen.add(name)
        if parts[0] not in ('manifest.json', 'presets', 'mappings.json'):
            raise ValueError('Unexpected library root')
        if parts[0] != 'presets' and len(parts) != 1:
            raise ValueError('Unexpected root-file children')
        if not (entry.isfile() or entry.isdir()):
            raise ValueError('Library links/devices are not accepted')
        if entry.size < 0 or entry.size > 4 * 1024**3:
            raise ValueError('Invalid library file size')
        total += entry.size
        if total > MAX_BYTES:
            raise ValueError('Library exceeds private image budget')
        if name == 'manifest.json':
            if not entry.isfile() or entry.size > 65536:
                raise ValueError('Invalid library manifest')
            value = json.load(archive.extractfile(entry))
            if value.get('format') != 1 or value.get('content') != 'Oxidal library backup':
                raise ValueError('Not an Oxidal library backup')
            continue
        if parts[0] == 'presets' and len(parts) > 1 and parts[1] in OMIT:
            continue
        if entry.isfile() and name.startswith('presets/bundles/') and name.endswith('/manifest.json'):
            if entry.size > 8 * 1024**2:
                raise ValueError('Oversized preset manifest')
            manifests[parts[2]] = json.load(archive.extractfile(entry))
        selected.append(entry)
    if 'manifest.json' not in seen or 'presets' not in seen:
        raise ValueError('Incomplete library backup')
    # A regular file must never be the parent of another retained entry.
    files = {x.name.rstrip('/') for x in selected if x.isfile()}
    for entry in selected:
        if any(str(p) in files for p in PurePosixPath(entry.name).parents):
            raise ValueError('Library file/directory collision')
    return selected, manifests


def overlay(source, destination):
    """Validate everything first, then stream a root-owned tar with content hashes."""
    source, destination = Path(source), Path(destination)
    if not source.is_file() or source.is_symlink() or destination.exists():
        raise ValueError('Use a regular backup and a new overlay path')
    with tarfile.open(source, 'r:') as archive:
        selected, manifests = inspect(archive)
        report = {'version': 1, 'private_development_only': True,
                  'backup_sha256': sha(source), 'files': [],
                  'rig_revisions': sorted(manifests),
                  'factory_revisions': sorted(key for key, value in manifests.items()
                    if value.get('extensions', {}).get('urn:oxidal:authoring', {}).get('origin') == 'oxidal_example'),
                  'excluded': sorted(OMIT), 'audio_start_on_boot': False}
        try:
            with destination.open('xb') as raw:
                destination.chmod(0o600)
                with tarfile.open(fileobj=raw, mode='w') as output:
                    for entry in selected:
                        name = entry.name.rstrip('/')
                        target = tarfile.TarInfo('var/lib/oxidal/' + name)
                        target.mode = 0o700 if entry.isdir() else 0o600
                        target.type = tarfile.DIRTYPE if entry.isdir() else tarfile.REGTYPE
                        target.size = entry.size if entry.isfile() else 0
                        if entry.isdir():
                            output.addfile(target)
                            continue
                        # Hash streaming contents without retaining large NAM/IR files in RAM.
                        stream = archive.extractfile(entry)
                        digest = hashlib.sha256()
                        class Reader:
                            def read(self, size):
                                data = stream.read(size)
                                digest.update(data)
                                return data
                        output.addfile(target, Reader())
                        report['files'].append({'path': name, 'bytes': entry.size, 'sha256': digest.hexdigest()})
                    def add_json(name, value):
                        data = (json.dumps(value, indent=2) + '\n').encode()
                        info = tarfile.TarInfo(name)
                        info.mode, info.size = 0o600, len(data)
                        output.addfile(info, io.BytesIO(data))
                    add_json('usr/share/oxidal/development-library.json', report)
                    # Preserve the owner's bank exactly, without duplicating clean-image defaults.
                    add_json('var/lib/oxidal/factory-installed.json', {'version': 1,
                        'development_library': True, 'revisions': report['factory_revisions']})
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
    destination.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = overlay(args.backup, args.output)
    print(json.dumps({'files': len(result['files']), 'bytes': sum(f['bytes'] for f in result['files']),
                      'rigs': len(result['rig_revisions']), 'factory': len(result['factory_revisions'])}))
