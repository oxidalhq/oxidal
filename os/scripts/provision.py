"""Stage an Oxidal recipe into an explicitly marked disposable root, never a block device.

@see docs/architecture.md
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import secrets
import subprocess

HERE = Path(__file__).resolve().parents[1]
if not (HERE / 'manifests').is_dir():
    HERE = Path(__file__).resolve().parent


def manifest():
    """Load and validate the pinned image/service recipe. @see docs/architecture.md"""
    data = json.loads((HERE / 'manifests/base.json').read_text())
    if data['schema_version'] != 1 or data['debian_codename'] != 'trixie' or data['architecture'] != 'arm64':
        raise ValueError('Unsupported image manifest')
    if not re.fullmatch(r'[a-f0-9]{64}', data['image']['sha256']):
        raise ValueError('Invalid image checksum')
    if '/latest' in data['image']['url'] or not data['image']['url'].startswith('https://downloads.raspberrypi.com/'):
        raise ValueError('Image must use a versioned official URL')
    if data['services']['enable'] or not data['requires_fresh_sd_card']:
        raise ValueError('PoC only stages services onto a fresh disposable root')
    return data


def target_root(path):
    """Reject host roots, devices, and symlink traversal before any write. @see docs/architecture.md"""
    raw = Path(path).absolute()
    if any(part.is_symlink() for part in [raw, *raw.parents]):
        raise ValueError('Symlinked target roots are not allowed')
    root = raw.resolve(strict=True)
    if root in (Path('/'), Path.home(), HERE.parent) or any(root == Path(p) or Path(p) in root.parents for p in ('/dev', '/proc', '/sys', '/etc', '/System', '/Library', '/Applications')):
        raise ValueError('Refusing host root or device path')
    if not root.is_dir() or not (root / '.oxidal-disposable-root').is_file():
        raise ValueError('Target needs an explicit .oxidal-disposable-root marker')
    for relative in ('.oxidal-disposable-root', 'etc/os-release'):
        inside(root, relative)
    release = (root / 'etc/os-release').read_text()
    if not re.search(r'^VERSION_CODENAME=["\']?trixie["\']?$', release, re.M):
        raise ValueError('Target must declare Debian Trixie')
    return root


def inside(root, relative):
    """Constrain every managed destination to non-symlink paths under the target."""
    destination = root / relative
    if not destination.is_relative_to(root):
        raise ValueError('Target escape')
    for part in [destination, *destination.parents]:
        if part == root:
            break
        if part.is_symlink():
            raise ValueError('Symlink in managed target path')
    return destination


def bundle_files(path):
    """Verify an extracted, native Linux bundle before touching any target files."""
    bundle = Path(path).resolve(strict=True)
    data = json.loads((bundle / 'manifest.json').read_text())
    if data.get('format') != 2 or not data.get('engine_available') or data.get('target') not in ('linux-arm64', 'linux-x64'):
        raise ValueError('A complete native Linux appliance bundle is required')
    result = {}
    for name, checksum in data['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Invalid bundle path')
        source = inside(bundle, name)
        if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
            raise ValueError(f'Bundle checksum mismatch: {name}')
        result['opt/oxidal/' + name] = source.read_bytes()
    required = ['bin/oxidald', 'bin/oxidal-native-worker', 'bin/oxidal-audio-worker', 'bin/oxidal-graph-worker', 'bin/oxidal-rig-worker', 'bin/oxidal-device-service', 'bin/oxidal-debug-service', 'bin/oxidal-terminal-service', 'bin/oxidal-preset-seed', 'lib/liboxidal_tone3000.so', 'ui/index.html']
    if any('opt/oxidal/' + name not in result for name in required):
        raise ValueError('Incomplete appliance bundle')
    machine = 183 if data['target'] == 'linux-arm64' else 62
    for name in required[:-1]:
        elf = result['opt/oxidal/' + name]
        if elf[:6] != b'\x7fELF\x02\x01' or int.from_bytes(elf[18:20], 'little') != machine:
            raise ValueError('Bundle ELF architecture mismatch')
    result['opt/oxidal/manifest.json'] = (bundle / 'manifest.json').read_bytes()
    return result, data


def firmware_fstab(text, uuid, root_uuid):
    """Use the firmware filesystem UUID so guestfs and the Pi mount the same FAT partition."""
    if not re.fullmatch(r'[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}', uuid):
        raise ValueError('Invalid firmware FAT UUID')
    result, count = re.subn(r'^\S+(\s+/boot/firmware\s+vfat\s+[^\n]*)$',
                            lambda match: 'UUID=' + uuid + match.group(1), text, flags=re.M)
    if count != 1:
        raise ValueError('Expected exactly one firmware mount in the pinned base')
    if not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', root_uuid):
        raise ValueError('Invalid root filesystem UUID')
    result, count = re.subn(r'^\S+(\s+/\s+ext4\s+[^\n]*)$',
                            lambda match: 'UUID=' + root_uuid + match.group(1), result, flags=re.M)
    if count != 1:
        raise ValueError('Expected exactly one root mount in the pinned base')
    return result


def create_access(path):
    """Generate per-device credentials locally; never print passwords or install them in web assets."""
    directory = Path(path).absolute()
    if directory.exists():
        raise ValueError('Access directory already exists; keep existing credentials or choose a new path')
    directory.mkdir(parents=True, mode=0o700)
    password = secrets.token_urlsafe(24)
    wifi = secrets.token_urlsafe(18)
    recovery = secrets.token_urlsafe(24)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '3650',
                    '-keyout', str(directory / 'ca.key'), '-out', str(directory / 'ca.crt'),
                    '-subj', '/CN=Oxidal personal device CA', '-addext', 'basicConstraints=critical,CA:TRUE',
                    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash'],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['openssl', 'req', '-new', '-newkey', 'rsa:3072', '-nodes',
                    '-keyout', str(directory / 'server.key'), '-out', str(directory / 'server.csr'),
                    '-subj', '/CN=oxidal.local'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    (directory / 'server.ext').write_text('subjectAltName=DNS:oxidal.local,IP:10.42.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n')
    subprocess.run(['openssl', 'x509', '-req', '-in', str(directory / 'server.csr'), '-CA', str(directory / 'ca.crt'),
                    '-CAkey', str(directory / 'ca.key'), '-CAcreateserial', '-out', str(directory / 'server.crt'),
                    '-days', '365', '-extfile', str(directory / 'server.ext')], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    hashed = subprocess.check_output(['openssl', 'passwd', '-6', '-stdin'], input=password + '\n', text=True).strip()
    (directory / 'access.htpasswd').write_text('oxidal:' + hashed + '\n')
    recovery_hash = subprocess.check_output(['openssl', 'passwd', '-6', '-stdin'], input=recovery + '\n', text=True).strip()
    (directory / 'recovery.shadow').write_text('oxidal-admin:' + recovery_hash + '\n')
    profile = {'ssid': 'Oxidal-' + secrets.token_hex(3), 'password': wifi, 'country': 'NZ'}
    (directory / 'hotspot.json').write_text(json.dumps(profile) + '\n')
    (directory / 'access.txt').write_text(f"Device URL: https://oxidal.local (hotspot: https://10.42.0.1)\nUsername: oxidal\nPassword: {password}\nWi-Fi: {profile['ssid']}\nWi-Fi password: {wifi}\nRecovery SSH user: oxidal-admin\nRecovery SSH password: {recovery}\nInstall ca.crt as a trusted CA on your own devices before connecting. Keep this folder private.\n")
    for file in directory.iterdir():
        file.chmod(0o600)
    return {'created': str(directory), 'credentials_printed': False}


def appliance_files(bundle, access, hotspot):
    files, data = bundle_files(bundle)
    files['etc/systemd/system/oxidald.service'] = (HERE / 'config/oxidald.service').read_bytes()
    files['etc/systemd/system/oxidal-admin-terminal.service'] = (HERE / 'config/oxidal-admin-terminal.service').read_bytes()
    files['etc/systemd/system/oxidal-terminal.service'] = (HERE / 'config/oxidal-terminal.service').read_bytes()
    files['etc/systemd/system/oxidal-debug.service'] = (HERE / 'config/oxidal-debug.service').read_bytes()
    files['etc/systemd/system/oxidal-device.service'] = (HERE / 'config/oxidal-device.service').read_bytes()
    banner = (HERE / 'config/branding/banner.txt').read_bytes()
    files['etc/issue.d/90-oxidal.issue'] = banner
    files['etc/motd'] = banner
    for name in ('oxidal.plymouth', 'oxidal.script'):
        files['usr/share/plymouth/themes/oxidal/' + name] = (HERE / 'config/branding' / name).read_bytes()
    splash = files.get('opt/oxidal/ui/brand/boot-splash.png')
    if splash:
        files['usr/share/plymouth/themes/oxidal/boot-splash.png'] = splash

    if access:
        access = Path(access).resolve(strict=True)
        for name in ('server.crt', 'server.key'):
            files['etc/oxidal/tls/' + name] = inside(access, name).read_bytes()
        files['etc/oxidal/access.htpasswd'] = inside(access, 'access.htpasswd').read_bytes()
        files['etc/nginx/conf.d/oxidal.conf'] = (HERE / 'config/oxidal-nginx.conf').read_bytes()
    if hotspot:
        if not access or data['target'] != 'linux-arm64':
            raise ValueError('Pi hotspot requires per-device access credentials and an ARM64 bundle')
        profile = json.loads(inside(access, 'hotspot.json').read_text())
        if not re.fullmatch(r'Oxidal-[a-f0-9]{6}', profile['ssid']) or not re.fullmatch(r'[A-Za-z0-9_-]{16,64}', profile['password']) or profile['country'] != 'NZ':
            raise ValueError('Invalid hotspot profile')
        files['etc/NetworkManager/system-connections/oxidal.nmconnection'] = f"""[connection]
id=oxidal-hotspot
type=wifi
interface-name=wlan0
autoconnect=true
autoconnect-priority=-100
[wifi]
mode=ap
ssid={profile['ssid']}
band=bg
[wifi-security]
key-mgmt=wpa-psk
proto=rsn
psk={profile['password']}
[ipv4]
method=shared
address1=10.42.0.1/24
[ipv6]
method=disabled
""".encode()
        # Discovery is local to the recovery hotspot; ordinary Linux installs
        # and NetworkManager client DNS configuration are left untouched.
        files['etc/nginx/conf.d/oxidal-portal.conf'] = (HERE / 'config/oxidal-portal.conf').read_bytes()
        files['etc/NetworkManager/dnsmasq-shared.d/oxidal-portal.conf'] = (HERE / 'config/oxidal-portal-dns.conf').read_bytes()
        files['usr/share/oxidal/portal/index.html'] = (HERE / 'config/oxidal-welcome.html').read_bytes()
        # Vendor images may persist radio-off independently of rfkill.
        files['var/lib/NetworkManager/NetworkManager.state'] = b'[main]\nWirelessEnabled=true\n'
        files['etc/default/oxidal-wireless'] = b'COUNTRY=NZ\n'
        files['etc/systemd/system/oxidal-regdomain.service'] = b"[Unit]\nDescription=Oxidal wireless region\nBefore=NetworkManager.service\n[Service]\nType=oneshot\nEnvironmentFile=/etc/default/oxidal-wireless\nExecStartPre=/usr/sbin/rfkill unblock wifi\nExecStart=/usr/sbin/iw reg set ${COUNTRY}\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n"
    return files, data


def provision(path, apply=False, bundle=None, access=None, hotspot=False):
    """Return an idempotent plan; apply only when explicitly requested. @see docs/architecture.md"""
    data = manifest()
    root = target_root(path)
    files = {
        'etc/systemd/system/oxidald.service': (HERE / 'config/oxidald.service').read_bytes(),
        'usr/share/oxidal/base-manifest.json': (json.dumps(data, indent=2) + '\n').encode(),
    }
    if bundle:
        payload, bundle_manifest = appliance_files(bundle, access, hotspot)
        files.update(payload)
    elif access or hotspot:
        raise ValueError("Access configuration requires a bundle")
    # Validate all destinations before the first write.
    destinations = {name: inside(root, name) for name in files}
    for name in files:
        inside(root, name + '.oxidal-tmp')
    changes = [name for name, content in files.items() if not destinations[name].exists() or destinations[name].read_bytes() != content]
    if apply:
        for name in changes:
            target = destinations[name]
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = inside(root, name + '.oxidal-tmp')
            with open(temporary, 'wb') as stream:
                stream.write(files[name])
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(0o755 if name.startswith('opt/oxidal/bin/') else (0o600 if name.endswith('.key') or name.endswith('.nmconnection') or name == 'var/lib/NetworkManager/NetworkManager.state' else 0o644))
            os.replace(temporary, target)
    return {'mode': 'apply' if apply else 'dry-run', 'root': str(root), 'changes': changes, 'services_enabled': [], 'device_writes': False}


def verify_image(path):
    """Verify the compressed image without extracting, mounting, or flashing it."""
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != manifest()['image']['sha256']:
        raise ValueError('Image checksum mismatch')
    return {'sha256': digest.hexdigest(), 'verified': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target-root')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--verify-image')
    parser.add_argument('--check-manifest', action='store_true')
    parser.add_argument('--bundle')
    parser.add_argument('--access')
    parser.add_argument('--hotspot', action='store_true')
    parser.add_argument('--create-access')
    args = parser.parse_args()
    try:
        if args.create_access:
            result = create_access(args.create_access)
        elif args.check_manifest:
            result = manifest()
        elif args.verify_image:
            result = verify_image(args.verify_image)
        elif args.target_root:
            result = provision(args.target_root, args.apply, args.bundle, args.access, args.hotspot)
        else:
            parser.error('Specify --check-manifest, --verify-image, or --target-root')
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
