#!/usr/bin/python3
"""Scoped local deployment for private development images only.

Accepts one fixed /tmp archive, verifies its caller-supplied SHA-256 and a
strict file allowlist, then atomically replaces Oxidal application files or
installs the matching public CA and fixed nginx download locations.
It never installs the root device helper or accepts a caller-selected path.

The splitter runtime (runner, ONNX Runtime and model files) is too large to
hold in memory. It is streamed into a release directory on the data partition
and made current by switching one symlink; the daemon finds it on the next
split without a restart.
"""

import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import struct
import subprocess
import sys
import tarfile
import tempfile
import time


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
    'lv2': Path('/tmp/oxidal-lv2.tgz'),
    'certificate': Path('/tmp/oxidal-certificate.tgz'),
    'device-service': Path('/run/oxidal-deploy/oxidal-device-service.tgz'),
}
CERTIFICATE_MAX_BYTES = 16384
DEVICE_SERVICE_MAX_BYTES = 16 * 1024 * 1024
CERTIFICATE_MARKER = '# Oxidal public certificate'
OLD_NETWORK_GUARDS = '''    if ($host !~ ^(oxidal\\.local|10\\.42\\.0\\.1)$) { return 403; }
    if ($oxidal_origin_ok = 0) { return 403; }
'''
NETWORK_GUARDS = '''    # Oxidal current IPv4 address: exact local socket, never forwarded headers.
    set $oxidal_host_ok 0;
    if ($host ~ ^(oxidal\\.local|10\\.42\\.0\\.1)$) { set $oxidal_host_ok 1; }
    if ($host = $server_addr) { set $oxidal_host_ok 1; }
    if ($oxidal_host_ok = 0) { return 403; }
    set $oxidal_request_origin_ok $oxidal_origin_ok;
    if ($http_origin = "https://$server_addr") { set $oxidal_request_origin_ok 1; }
    if ($oxidal_request_origin_ok = 0) { return 403; }
'''
HTTPS_CERTIFICATE_ROUTES = '''    # Oxidal public certificate: exact public files, still authenticated.
    location = /api/v1/device/certificate {
        if ($request_method !~ ^(GET|HEAD)$) { return 405; }
        default_type application/x-x509-ca-cert;
        add_header Cache-Control "no-store" always;
        alias /usr/share/oxidal/public/ca.crt;
    }
    location = /api/v1/device/certificate.json {
        if ($request_method !~ ^(GET|HEAD)$) { return 405; }
        default_type application/json;
        add_header Cache-Control "no-store" always;
        alias /usr/share/oxidal/public/certificate.json;
    }
'''
HTTP_CERTIFICATE_ROUTES = '''    # Oxidal public certificate: hotspot bootstrap only, never an API proxy.
    location = /certificate.crt {
        default_type application/x-x509-ca-cert;
        alias /usr/share/oxidal/public/ca.crt;
    }
    location = /certificate.json {
        default_type application/json;
        alias /usr/share/oxidal/public/certificate.json;
    }
'''
# Oxidal's own Rust effects. Bundles are replaced whole, in the directory the
# daemon's LV2_PATH reads. Nothing temporary may sit in that directory: the
# LV2 host loads every bundle it finds there, hidden ones included.
LV2_EFFECTS = ('bloom', 'sustain', 'echo', 'motion', 'moment', 'fuzz', 'wah')
LV2_BUNDLE_FILES = {
    **{
        f'oxidal-{effect}.lv2': {
            'manifest.ttl',
            f'{effect}.ttl',
            f'oxidal_{effect}.so',
            'NOTICE',
        }
        for effect in LV2_EFFECTS
    },
    'littlefly.lv2': {'manifest.ttl', 'LittleFly.ttl', 'LittleFly.so', 'LICENSE', 'README.md'},
}
LV2_DIRECTORY = Path('/usr/local/lib/lv2')
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


def lv2_bundle_files(effect):
    """The exact files of one effect's bundle."""
    return LV2_BUNDLE_FILES.get(f'oxidal-{effect}.lv2', set())


def lv2_file_allowed(name):
    """Whether an archive path is a listed file of a listed effect's bundle."""
    parts = PurePosixPath(name).parts
    if len(parts) != 2:
        return False
    return parts[0] in LV2_BUNDLE_FILES and parts[1] in LV2_BUNDLE_FILES[parts[0]]


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
            if mode == 'device-service' and (str(name) != 'oxidal-device-service' or member.size > DEVICE_SERVICE_MAX_BYTES):
                raise ValueError('Device-service archive contains an unapproved file or size')
            if mode == 'lv2' and not lv2_file_allowed(str(name)):
                raise ValueError('LV2 archive contains an unapproved file')
            if mode == 'certificate' and (str(name) != 'ca.crt' or member.size > CERTIFICATE_MAX_BYTES):
                raise ValueError('Certificate archive contains an unapproved file or size')
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
    if mode == 'device-service':
        if set(files) != {'oxidal-device-service'}:
            raise ValueError('Device-service archive is incomplete')
        device_binary(files['oxidal-device-service'])
    if mode == 'lv2':
        for bundle in {PurePosixPath(name).parts[0] for name in files}:
            required = LV2_BUNDLE_FILES.get(bundle, set())
            if any(f'{bundle}/{name}' not in files for name in required):
                raise ValueError('LV2 archive has an incomplete bundle')
    return files


def certificate_files(ca, server, hotspot=False):
    """Validate a public CA against existing TLS; no private keys are read.

    @see docs/device-service.md
    """
    if len(ca) > CERTIFICATE_MAX_BYTES:
        raise ValueError('Expected one bounded public CA certificate')
    match = re.fullmatch(rb'\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\r\n]+)-----END CERTIFICATE-----\s*', ca)
    if not match:
        raise ValueError('Expected one bounded public CA certificate')
    try:
        der = base64.b64decode(b''.join(match[1].split()), validate=True)
    except ValueError as error:
        raise ValueError('Invalid public CA encoding') from error
    with tempfile.TemporaryDirectory(prefix='oxidal-public-ca-') as directory:
        path = Path(directory) / 'ca.crt'
        path.write_bytes(ca)
        try:
            details = subprocess.run(['openssl', 'x509', '-in', str(path), '-noout', '-text'], check=True, capture_output=True, text=True, timeout=10).stdout
            if not re.search(r'X509v3 Basic Constraints:[^\n]*\n\s*CA:TRUE(?:\s*,|\s*$)', details, re.MULTILINE):
                raise ValueError('The public certificate is not a CA')
            subprocess.run(['openssl', 'verify', '-CAfile', str(path), str(server)], check=True, capture_output=True, timeout=10)
            server_details = subprocess.run(['openssl', 'x509', '-in', str(server), '-noout', '-text'], check=True, capture_output=True, text=True, timeout=10).stdout
        except (subprocess.SubprocessError, OSError) as error:
            raise ValueError('Public CA does not verify the existing server certificate') from error
    names = sorted(set(re.findall(r'DNS:([A-Za-z0-9.-]+)|IP Address:([0-9A-Fa-f:.]+)', server_details)))
    names = sorted({dns or ip for dns, ip in names})
    if not {'oxidal.local', '10.42.0.1'}.issubset(names):
        raise ValueError('Server certificate lacks the Oxidal network names')
    digest = hashlib.sha256(der).hexdigest().upper()
    metadata = {
        'schema_version': 1,
        'fingerprint_sha256': ':'.join(digest[i:i + 2] for i in range(0, len(digest), 2)),
        'file_name': 'oxidal-ca.crt',
        'https_download': '/api/v1/device/certificate',
        'hotspot_download': '/certificate.crt' if hotspot else None,
        'server_names': names,
    }
    return {'ca.crt': ca, 'certificate.json': (json.dumps(metadata, sort_keys=True) + '\n').encode()}


def certificate_locations(config, portal=False):
    """Add fixed routes without replacing authentication, host or origin policy."""
    block = HTTP_CERTIFICATE_ROUTES if portal else HTTPS_CERTIFICATE_ROUTES
    if config.count(block) == 1 and config.count(CERTIFICATE_MARKER) == 1:
        return config
    anchor = '    location = /welcome {' if portal else '    location / {'
    if CERTIFICATE_MARKER in config or config.count(anchor) != 1:
        raise ValueError('Unrecognized certificate route configuration; review it before updating')
    return config.replace(anchor, block + anchor, 1)


def network_address_locations(config):
    """Admit only the actual current local address in addition to named hosts."""
    if config.count(NETWORK_GUARDS) == 1 and OLD_NETWORK_GUARDS not in config:
        return config
    if config.count(OLD_NETWORK_GUARDS) != 1 or 'Oxidal current IPv4 address' in config:
        raise ValueError('Unrecognized network guards; review them before updating')
    return config.replace(OLD_NETWORK_GUARDS, NETWORK_GUARDS, 1)


def deploy_certificate(files, filesystem=Path('/'), run=subprocess.run):
    """Install only the matching public CA and exact routes, with rollback."""
    if set(files) != {'ca.crt'}:
        raise ValueError('Certificate archive is incomplete')
    config = filesystem / 'etc/nginx/conf.d/oxidal.conf'
    portal = filesystem / 'etc/nginx/conf.d/oxidal-portal.conf'
    public = filesystem / 'usr/share/oxidal/public'
    validated = certificate_files(files['ca.crt'], filesystem / 'etc/oxidal/tls/server.crt', portal.exists())
    updates = {public / name: data for name, data in validated.items()}
    updates[config] = certificate_locations(network_address_locations(config.read_text())).encode()
    if portal.exists():
        updates[portal] = certificate_locations(portal.read_text(), True).encode()
    previous = {path: path.read_bytes() if path.exists() else None for path in updates}
    if all(previous[path] == data for path, data in updates.items()):
        return
    try:
        for path, data in updates.items():
            atomic_file(path, data, 0o644)
        run(['nginx', '-t'], check=True)
        run(['systemctl', 'reload', 'nginx.service'], check=True)
    except BaseException:
        for path, data in previous.items():
            if data is None:
                path.unlink(missing_ok=True)
            else:
                atomic_file(path, data, 0o644)
        # The old worker continues serving if a reload is rejected. Try the
        # restored configuration without masking the original failure.
        try:
            run(['nginx', '-t'], check=True)
            run(['systemctl', 'reload', 'nginx.service'], check=True)
        except Exception:
            pass
        raise


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


def device_binary(data):
    """Accept only a bounded Linux ARM64 executable for the fixed service path."""
    if (
        len(data) < 64 or len(data) > DEVICE_SERVICE_MAX_BYTES
        or data[:7] != b'\x7fELF\x02\x01\x01'
        or struct.unpack_from('<H', data, 16)[0] not in (2, 3)
        or struct.unpack_from('<H', data, 18)[0] != 183
    ):
        raise ValueError('Expected a bounded Linux ARM64 device-service executable')


def query_device_service(command, timeout=2):
    """One fixed-socket, root-peer-checked request; never a network change.

    @see docs/device-service.md
    """
    if command not in ('packs', 'network_capabilities'):
        raise ValueError('Unsupported deployment probe')
    if not hasattr(socket, 'SO_PEERCRED'):
        raise ValueError('Device-service installation requires Linux')
    deadline = time.monotonic() + timeout
    def remaining():
        value = deadline - time.monotonic()
        if value <= 0:
            raise TimeoutError('Device-service probe timed out')
        return value
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(remaining())
        client.connect('/run/oxidal-device/control.sock')
        _, uid, _ = struct.unpack('3i', client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != 0:
            raise ValueError('Device-service peer is not root')
        data = json.dumps({'type': command}).encode()
        client.settimeout(remaining())
        client.sendall(struct.pack('!I', len(data)) + data)
        def read(length):
            result = b''
            while len(result) < length:
                client.settimeout(remaining())
                block = client.recv(length - len(result))
                if not block:
                    raise ValueError('Truncated device-service reply')
                result += block
            return result
        length = struct.unpack('!I', read(4))[0]
        if not 0 < length <= 65536:
            raise ValueError('Invalid device-service reply length')
        reply = json.loads(read(length))
        if not isinstance(reply, dict) or 'error' not in reply or reply['error'] is not None:
            raise ValueError('Device-service probe failed')
        return reply


def device_service_ready(query):
    deadline = time.monotonic() + 10
    while (remaining := deadline - time.monotonic()) > 0:
        try:
            reply = query('network_capabilities', timeout=min(1, remaining))
        except OSError:
            time.sleep(min(.1, max(0, deadline - time.monotonic())))
            continue
        if not isinstance(reply, dict) or reply.get('error', True) is not None:
            raise ValueError('Device-service capability check failed')
        state = reply.get('state')
        capabilities = state.get('capabilities') if isinstance(state, dict) else None
        if (
            not isinstance(capabilities, dict)
            or type(capabilities.get('schema_version')) is not int
            or capabilities['schema_version'] != 1
            or capabilities.get('saved_connect') is not True
        ):
            raise ValueError('Device-service capabilities are incompatible')
        return
    raise ValueError('Device-service capability check timed out')


def deploy_device_service(
    files, root=Path('/opt/oxidal'), state=Path('/var/lib/oxidal-device'),
    run=subprocess.run, query=query_device_service,
):
    """Explicit administrator update; ordinary app archives cannot replace this service.

    @see docs/device-service.md
    """
    if set(files) != {'oxidal-device-service'}:
        raise ValueError('Device-service archive is incomplete or unapproved')
    device_binary(files['oxidal-device-service'])
    target = root / 'bin/oxidal-device-service'
    if root.is_symlink() or target.parent.is_symlink() or target.is_symlink() or not target.is_file():
        raise ValueError('Existing device-service executable is unavailable or unsafe')
    pending = state / 'pending.json'
    def check_pending():
        if pending.exists() or pending.is_symlink():
            raise ValueError('Finish network recovery before updating the device service')
    check_pending()
    def active(unit):
        result = run(['systemctl', 'is-active', '--quiet', unit], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode not in (0, 3):
            raise ValueError('Service activity could not be read')
        return result.returncode == 0
    daemon_active = active('oxidald.service')
    device_active = active('oxidal-device.service')
    previous = target.read_bytes()
    previous_mode = target.stat().st_mode & 0o777
    replaced = False
    stopped = False
    daemon_started = False
    try:
        if daemon_active:
            run(['systemctl', 'stop', 'oxidald.service'], check=True)
        check_pending()
        if device_active:
            reply = query('packs')
            packs = reply.get('packs') if isinstance(reply, dict) else None
            if (
                not isinstance(reply, dict) or reply.get('error', True) is not None
                or not isinstance(packs, dict) or packs.get('available') is not True
                or 'job' not in packs or packs['job'] is not None
            ):
                raise ValueError('Finish effect-pack work before updating the device service')
            check_pending()
            run(['systemctl', 'stop', 'oxidal-device.service'], check=True)
            stopped = True
        rollback = root / 'deploy-rollback/device-service/oxidal-device-service'
        rollback.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(rollback.parent, 0o700)
        atomic_file(rollback, previous, 0o600)
        atomic_file(target, files['oxidal-device-service'], 0o755)
        replaced = True
        if device_active:
            run(['systemctl', 'start', 'oxidal-device.service'], check=True)
            device_service_ready(query)
        if daemon_active:
            run(['systemctl', 'start', 'oxidald.service'], check=True)
            daemon_started = True
    except BaseException:
        if replaced:
            if device_active:
                run(['systemctl', 'stop', 'oxidal-device.service'], check=False)
            atomic_file(target, previous, previous_mode)
        if stopped:
            run(['systemctl', 'start', 'oxidal-device.service'], check=True)
        raise
    finally:
        if daemon_active and not daemon_started:
            run(['systemctl', 'start', 'oxidald.service'], check=True)


def deploy_lv2(files, directory=LV2_DIRECTORY, root=Path('/opt/oxidal'), run=subprocess.run):
    """Replace whole effect bundles while the daemon is stopped."""
    rollback = root / 'deploy-rollback/lv2'
    directory.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.oxidal-lv2-', dir=directory.parent))
    stage.chmod(0o755)
    replaced = []
    try:
        for name, data in files.items():
            mode = 0o755 if name.endswith('.so') else 0o644
            atomic_file(stage / name, data, mode)
        bundles = sorted({PurePosixPath(name).parts[0] for name in files})
        for bundle in bundles:
            (stage / bundle).chmod(0o755)
        if rollback.exists():
            shutil.rmtree(rollback)
        rollback.mkdir(parents=True)
        run(['systemctl', 'stop', 'oxidald.service'], check=True)
        try:
            for bundle in bundles:
                current = directory / bundle
                if current.exists():
                    shutil.move(str(current), str(rollback / bundle))
                replaced.append(bundle)
                os.replace(stage / bundle, current)
            run(['systemctl', 'start', 'oxidald.service'], check=True)
        except BaseException:
            for bundle in replaced:
                current = directory / bundle
                if current.exists():
                    shutil.rmtree(current)
                if (rollback / bundle).exists():
                    shutil.move(str(rollback / bundle), str(current))
            run(['systemctl', 'start', 'oxidald.service'], check=False)
            raise
    finally:
        shutil.rmtree(stage, ignore_errors=True)


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
        raise SystemExit('usage: oxidal-development-deploy bins|ui|splitter|lv2|certificate|device-service SHA256')
    mode, expected = argv
    if mode == 'device-service' and os.geteuid() != 0:
        raise SystemExit('Administrator approval is required for device-service updates')
    if mode == 'splitter':
        print(install_splitter(ARCHIVES[mode], expected))
        return
    files = read_archive(ARCHIVES[mode], expected, mode)
    if mode == 'bins':
        deploy_bins(files)
    elif mode == 'device-service':
        deploy_device_service(files)
    elif mode == 'lv2':
        deploy_lv2(files)
    elif mode == 'certificate':
        deploy_certificate(files)
    else:
        deploy_ui(files)


if __name__ == '__main__':
    main()
