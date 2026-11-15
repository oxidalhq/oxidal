#!/usr/bin/python3
"""Scoped local deployment for private development images only.

Accepts one fixed /tmp archive, verifies its caller-supplied SHA-256 and a
strict file allowlist, then atomically replaces only Oxidal application files.
It never installs the root device helper or accepts a caller-selected path.

The splitter runtime (runner, ONNX Runtime and model files) is too large to
hold in memory. It is streamed into a release directory on the data partition
and made current by switching one symlink; the daemon finds it on the next
split without a restart.
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
    'splitter': Path('/tmp/oxidal-splitter.tgz'),
}
MAX_FILES = 4096
MAX_BYTES = 128 * 1024 * 1024
SPLITTER_MAX_BYTES = 1024 * 1024 * 1024
# The splitter runtime must live outside the daemon's private StateDirectory
# (DynamicUser makes /var/lib/oxidal unreadable to exec) and on the data
# partition, which has the space.
SPLITTER_RELEASES = Path('/var/lib/oxidal-splitter/releases')
SPLITTER_CURRENT = Path('/opt/oxidal/splitter/current')
SPLITTER_KEEP = 2
SPLITTER_FILES = [
    (re.compile(r'bin/demucs-onnx(\.real)?'), 0o755),
    (re.compile(r'lib/libonnxruntime(_providers_shared)?\.so(\.[0-9]+)*'), 0o644),
    (re.compile(r'models/(htdemucs|htdemucs_6s)\.(onnx|json)'), 0o644),
    (re.compile(r'models/SHA256SUMS'), 0o644),
    (re.compile(r'notices/[A-Za-z0-9._+-]+(/[A-Za-z0-9._+-]+){0,3}'), 0o644),
]
SPLITTER_REQUIRED = {'bin/demucs-onnx', 'bin/demucs-onnx.real'}


def splitter_mode(name):
    """File mode for an allowlisted splitter path, or None."""
    for pattern, mode in SPLITTER_FILES:
        if pattern.fullmatch(name) and '..' not in name.split('/'):
            return mode
    return None


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


def install_splitter(
    path,
    expected,
    releases=SPLITTER_RELEASES,
    current=SPLITTER_CURRENT,
):
    """Stream a verified splitter runtime into a release and make it current."""
    path = Path(path)
    if not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('Expected a lowercase SHA-256')
    if (
        not path.is_file()
        or path.is_symlink()
        or path.stat().st_size > SPLITTER_MAX_BYTES
        or archive_digest(path) != expected
    ):
        raise ValueError('Deployment archive checksum mismatch')
    releases.mkdir(parents=True, exist_ok=True)
    os.chmod(releases.parent, 0o755)
    os.chmod(releases, 0o755)
    release = releases / expected[:16]
    if not release.is_dir():
        stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=releases))
        stage.chmod(0o755)
        try:
            names = set()
            total = 0
            with tarfile.open(path, 'r:gz') as archive:
                for member in archive:
                    if member.isdir():
                        continue
                    name = str(PurePosixPath(member.name))
                    mode = splitter_mode(name)
                    if not member.isfile() or mode is None or name in names:
                        raise ValueError(f'Splitter archive has an unapproved entry: {name}')
                    total += member.size
                    if len(names) >= MAX_FILES or total > SPLITTER_MAX_BYTES:
                        raise ValueError('Deployment archive exceeds its budget')
                    names.add(name)
                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError('Deployment archive entry is unreadable')
                    target = stage / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    for directory in [target.parent, *target.parent.parents]:
                        if directory == stage:
                            break
                        directory.chmod(0o755)
                    with target.open('wb') as stream:
                        shutil.copyfileobj(source, stream, 1024 * 1024)
                        stream.flush()
                        os.fsync(stream.fileno())
                    target.chmod(mode)
            if not SPLITTER_REQUIRED <= names or not any(
                name.startswith('lib/libonnxruntime.so') for name in names
            ):
                raise ValueError('Splitter archive is incomplete')
            if not any(name.endswith('.onnx') for name in names):
                raise ValueError('Splitter archive has no model')
            sums = stage / 'models/SHA256SUMS'
            if sums.is_file():
                for line in sums.read_text().splitlines():
                    digest, _, name = line.strip().partition('  ')
                    model = stage / 'models' / PurePosixPath(name).name
                    if digest and (not model.is_file() or archive_digest(model) != digest):
                        raise ValueError(f'Model checksum mismatch: {name}')
            os.replace(stage, release)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    current.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(current.parent, 0o755)
    if current.exists() and not current.is_symlink():
        os.replace(current, current.with_name(f'previous-{expected[:16]}'))
    link = current.with_name('.current-next')
    link.unlink(missing_ok=True)
    os.symlink(release, link)
    os.replace(link, current)
    # Keep the current release and the one before it for a manual rollback.
    others = sorted(
        (entry for entry in releases.iterdir() if entry.is_dir() and entry != release
         and not entry.name.startswith('.')),
        key=lambda entry: entry.stat().st_mtime,
        reverse=True,
    )
    for old in others[SPLITTER_KEEP - 1:]:
        shutil.rmtree(old)
    return release


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
        raise SystemExit('usage: oxidal-development-deploy bins|ui|splitter SHA256')
    mode, expected = argv
    if mode == 'splitter':
        print(install_splitter(ARCHIVES[mode], expected))
        return
    files = read_archive(ARCHIVES[mode], expected, mode)
    if mode == 'bins':
        deploy_bins(files)
    else:
        deploy_ui(files)


if __name__ == '__main__':
    main()
