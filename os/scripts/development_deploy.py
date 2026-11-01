#!/usr/bin/python3
"""Scoped local deployment for private development images only.

Accepts one fixed /tmp archive, verifies its caller-supplied SHA-256 and a
strict file allowlist, then atomically replaces only Oxidal application files.
It never installs the root device helper or accepts a caller-selected path.
"""

import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile


BINARIES = {
    'oxidald': 'bin/oxidald',
    'oxidal-native-worker': 'bin/oxidal-native-worker',
    'oxidal-audio-worker': 'bin/oxidal-audio-worker',
    'oxidal-graph-worker': 'bin/oxidal-graph-worker',
    'oxidal-rig-worker': 'bin/oxidal-rig-worker',
    'liboxidal_tone3000.so': 'lib/liboxidal_tone3000.so',
}
ARCHIVES = {
    'bins': Path('/tmp/oxidal-bins.tgz'),
    'ui': Path('/tmp/oxidal-ui.tgz'),
}
MAX_FILES = 4096
MAX_BYTES = 128 * 1024 * 1024


def archive_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read_archive(path, expected, mode):
    """Return validated regular-file bytes without extracting archive paths."""
    path = Path(path)
    if mode not in ARCHIVES:
        raise ValueError('Unknown deployment mode')
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('Expected a lowercase SHA-256')
    if (
        not path.is_file()
        or path.is_symlink()
        or path.stat().st_size > MAX_BYTES
        or archive_digest(path) != expected
    ):
        raise ValueError('Deployment archive checksum mismatch')
    files = {}
    total = 0
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            name = PurePosixPath(member.name)
            if (
                not member.isfile()
                or name.is_absolute()
                or '..' in name.parts
                or not name.parts
                or len(str(name)) > 512
                or str(name) in files
            ):
                raise ValueError('Deployment archive has an unsafe entry')
            if mode == 'bins' and (len(name.parts) != 1 or name.name not in BINARIES):
                raise ValueError('Binary archive contains an unapproved file')
            if mode == 'ui' and name.parts[0].startswith('.'):
                raise ValueError('UI archive contains a hidden root entry')
            source = archive.extractfile(member)
            if source is None:
                raise ValueError('Deployment archive entry is unreadable')
            data = source.read(MAX_BYTES + 1)
            total += len(data)
            if len(files) >= MAX_FILES or len(data) > MAX_BYTES or total > MAX_BYTES:
                raise ValueError('Deployment archive exceeds its budget')
            files[str(name)] = data
    if not files or (mode == 'ui' and 'index.html' not in files):
        raise ValueError('Deployment archive is incomplete')
    return files


def atomic_file(path, data, mode):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def deploy_bins(files, root=Path('/opt/oxidal'), run=subprocess.run):
    rollback = root / 'deploy-rollback/bins'
    rollback.mkdir(parents=True, exist_ok=True)
    previous = {}
    for name in files:
        destination = root / BINARIES[name]
        previous[name] = destination.read_bytes() if destination.is_file() else None
    run(['systemctl', 'stop', 'oxidald.service'], check=True)
    try:
        for name, data in files.items():
            atomic_file(root / BINARIES[name], data, 0o755)
        run(['systemctl', 'start', 'oxidald.service'], check=True)
    except BaseException:
        for name, data in previous.items():
            destination = root / BINARIES[name]
            if data is None:
                destination.unlink(missing_ok=True)
            else:
                atomic_file(destination, data, 0o755)
        run(['systemctl', 'start', 'oxidald.service'], check=False)
        raise
    for name, data in previous.items():
        if data is not None:
            atomic_file(rollback / name, data, 0o600)


def deploy_ui(files, root=Path('/opt/oxidal')):
    current = root / 'ui'
    previous = root / 'deploy-rollback/ui'
    stage = Path(tempfile.mkdtemp(prefix='.ui-', dir=root))
    # mkdtemp is deliberately private. The installed root must be traversable
    # by the unprivileged daemon after the atomic rename.
    stage.chmod(0o755)
    try:
        for name, data in files.items():
            atomic_file(stage / name, data, 0o644)
        previous.parent.mkdir(parents=True, exist_ok=True)
        if previous.exists():
            shutil.rmtree(previous)
        if current.exists():
            os.replace(current, previous)
        os.replace(stage, current)
    except BaseException:
        if not current.exists() and previous.exists():
            os.replace(previous, current)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 2 or argv[0] not in ARCHIVES:
        raise SystemExit('usage: oxidal-development-deploy bins|ui SHA256')
    mode, expected = argv
    files = read_archive(ARCHIVES[mode], expected, mode)
    if mode == 'bins':
        deploy_bins(files)
    else:
        deploy_ui(files)


if __name__ == '__main__':
    main()
