"""Build a disposable Pi image from the pinned base and verified ARM64 bundle.

Only regular image files are accepted; this command never opens a block device.
Requires a native ARM64 Linux host with libguestfs-tools, qemu, xz and openssl.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile

import provision


def run(*args):
    subprocess.run(args, check=True, env={**os.environ, 'LIBGUESTFS_BACKEND': 'direct'})


def regular(path):
    path = Path(path).absolute()
    if path.is_symlink() or any(p.is_symlink() for p in path.parents) or not path.is_file():
        raise ValueError('Expected a regular file without symlinks')
    return path


def build(base, bundle, access, destination):
    if platform.system() != 'Linux' or platform.machine() not in ('aarch64', 'arm64'):
        raise ValueError('Build this Pi image on native ARM64 Linux, including an ARM64 Linux container')
    base = regular(base)
    provision.verify_image(base)
    _, payload = provision.bundle_files(bundle)
    if payload['target'] != 'linux-arm64':
        raise ValueError('Pi image requires ARM64 binaries')
    destination = Path(destination).absolute()
    if destination.exists() or destination.suffix != '.img' or any(p.is_symlink() for p in destination.parents):
        raise ValueError('Choose a new .img file, never an existing image or device')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Never stage TLS CA private keys or the plaintext device passwords into the image.
    access = Path(access).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix='oxidal-image-', dir=destination.parent) as temporary:
        work = Path(temporary)
        raw = work / 'base.img'
        with raw.open('xb') as output:
            subprocess.run(['xz', '-dc', str(base)], stdout=output, check=True)
        with destination.open('xb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.truncate(8 * 1024**3)
        run('virt-resize', '--expand', '/dev/sda2', str(raw), str(destination))
        root = work / 'overlay'
        (root / 'etc').mkdir(parents=True)
        (root / 'etc/os-release').write_text('ID=debian\nVERSION_CODENAME=trixie\n')
        (root / '.oxidal-disposable-root').touch()
        provision.provision(root, True, bundle, access, True)
        (root / '.oxidal-disposable-root').unlink()
        (root / 'etc/os-release').unlink()  # Keep the vendor's full release identity.
        (root / 'etc/cloud').mkdir(parents=True, exist_ok=True)
        (root / 'etc/cloud/cloud-init.disabled').touch()  # This image already supplies its device/account/network identity.
        tests = root / 'opt/oxidal/qualification'
        tests.mkdir(parents=True)
        shutil.copyfile(provision.HERE / 'tests/test_installed.py', tests / 'test_installed.py')
        overlay = work / 'overlay.tar'
        with tarfile.open(overlay, 'w') as archive:
            for file in sorted(root.rglob('*')):
                archive.add(file, arcname=str(file.relative_to(root)), recursive=False)
        profile = provision.manifest()['appliance']
        packages = profile['runtime_packages']
        commands = work / 'customize.txt'
        commands.write_text('\n'.join([
            'hostname oxidal',
            'install ' + ','.join(packages),
            'run-command tar -xf /tmp/oxidal-overlay.tar -C / && rm /tmp/oxidal-overlay.tar',
            'run-command getent group audio >/dev/null',
            'run-command IFS=: read -r name hash < /tmp/oxidal-recovery.shadow; /usr/lib/userconf-pi/userconf "$name" "$hash" && rm /tmp/oxidal-recovery.shadow',

            'run-command systemctl enable ' + ' '.join(profile['enabled_services']),
            'run-command systemctl mask systemd-networkd.service systemd-networkd-wait-online.service',
            'run-command systemctl set-default multi-user.target',
            'run-command systemd-analyze verify /etc/systemd/system/oxidald.service /etc/systemd/system/oxidal-regdomain.service',
            'run-command nginx -t',
            'run-command dpkg-query -W > /usr/share/oxidal/installed-packages.txt',
            'run-command OXIDAL_TEST_INSTALLED=1 python3 -m unittest discover -s /opt/oxidal/qualification -v > /usr/share/oxidal/installed-tests.log 2>&1',
        ]) + '\n')
        run('virt-customize', '-a', str(destination), '--upload', f'{overlay}:/tmp/oxidal-overlay.tar', '--upload', f'{access}/recovery.shadow:/tmp/oxidal-recovery.shadow', '--commands-from-file', str(commands))
        # Export evidence from the finished filesystem, not the staging tree.
        evidence = destination.with_suffix('.evidence')
        evidence.mkdir()
        run('guestfish', '--ro', '-a', str(destination), '-i', 'download', '/usr/share/oxidal/installed-packages.txt', str(evidence / 'installed-packages.txt'), ':', 'download', '/usr/share/oxidal/installed-tests.log', str(evidence / 'installed-tests.log'))
    digest = hashlib.sha256()
    with destination.open('rb') as image:
        for block in iter(lambda: image.read(4 * 1024**2), b''):
            digest.update(block)
    report = {
        'schema': 1, 'image_sha256': digest.hexdigest(), 'base': provision.manifest()['image'],
        'bundle_manifest': payload, 'installed_qualification': 'passed',
        'hardware_qualified': False, 'physical_sd_written': False,
        'first_boot': 'Connect to the generated hotspot or wired LAN; trust the supplied CA; open https://oxidal.local.',
        'pending_hardware': ['Pi boot', 'Wi-Fi radio/hotspot', 'physical audio and latency', 'thermal and power-loss testing'],
    }
    destination.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
    destination.with_suffix('.sha256').write_text(digest.hexdigest() + '  ' + destination.name + '\n')
    return {'image': str(destination), 'sha256': digest.hexdigest(), 'hardware_qualified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--access', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.base, args.bundle, args.access, args.output), indent=2))
