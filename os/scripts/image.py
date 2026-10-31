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


def capture(*args):
    return subprocess.check_output(
        args, text=True, env={**os.environ, 'LIBGUESTFS_BACKEND': 'direct'}
    )


def require_partition_layout(image):
    """Refuse to format unless resize produced the fixed boot/root/data layout."""
    partitions = capture(
        'guestfish', '--ro', '-a', str(image), 'run', ':', 'list-partitions'
    ).splitlines()
    expected = ['/dev/sda1', '/dev/sda2', '/dev/sda3']
    if partitions != expected:
        raise ValueError(
            'Expected exactly the boot, root and data partitions after resize; '
            f'found {partitions!r}'
        )


def regular(path):
    path = Path(path).absolute()
    if path.is_symlink() or any(p.is_symlink() for p in path.parents) or not path.is_file():
        raise ValueError('Expected a regular file without symlinks')
    return path


def build(base, bundle, access, destination, boot_splash=False, development_presets=None,
          profile_name='appliance'):
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
        with raw.open('xb') as stream:
            subprocess.run(['xz', '-dc', str(base)], stdout=stream, check=True)
        appliance = provision.manifest()['appliance']
        if profile_name not in appliance['profiles']:
            raise ValueError('Unknown image profile')
        image_profile = appliance['profiles'][profile_name]
        with destination.open('xb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.truncate(appliance['image_bytes'])
        root_size = appliance['root_partition_bytes'] // 1024**2
        run(
            'virt-resize', '--format', 'raw', '--output-format', 'raw',
            '--resize', f'/dev/sda2={root_size}M', str(raw), str(destination),
        )
        require_partition_layout(destination)
        data_uuid = capture(
            'guestfish', '-a', str(destination), 'run', ':',
            'mkfs', 'ext4', '/dev/sda3', ':',
            'set-label', '/dev/sda3', appliance['data_partition_label'], ':',
            'vfs-uuid', '/dev/sda3',
        ).strip()
        # Older guestfs cannot resolve this base's PARTUUID firmware entry. Use the
        # existing FAT UUID instead, before package hooks write kernel/initramfs files.
        fstab = work / 'fstab'
        firmware_uuid, root_uuid = capture(
            'guestfish', '--ro', '-a', str(destination), '-i', 'vfs-uuid', '/dev/sda1',
            ':', 'vfs-uuid', '/dev/sda2', ':', 'download', '/etc/fstab', str(fstab),
        ).splitlines()
        fstab.write_text(provision.firmware_fstab(fstab.read_text(), firmware_uuid, root_uuid))
        run('guestfish', '-a', str(destination), '-i', 'upload', str(fstab), '/etc/fstab')
        root = work / 'overlay'
        (root / 'etc').mkdir(parents=True)
        (root / 'etc/os-release').write_text('ID=debian\nVERSION_CODENAME=trixie\n')
        (root / '.oxidal-disposable-root').touch()
        provision.provision(root, True, bundle, access, True)
        for relative, contents in provision.storage_layout_files().items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
            target.chmod(0o755 if relative == 'usr/local/sbin/oxidal-grow-data' else 0o644)
        (root / 'usr/share/oxidal/image-profile.json').write_text(json.dumps({
            'name': profile_name,
            'diagnostic_packages': image_profile['diagnostic_packages'],
            'masked_units': image_profile['masked_units'],
        }, indent=2) + '\n')
        if development_presets:
            seed = work / 'development-seed'
            run(str(Path(bundle).resolve() / 'bin/oxidal-preset-seed'), '--development-only', str(Path(development_presets).resolve()), str(seed))
            shutil.copytree(seed / 'presets', root / 'var/lib/oxidal/presets')
            (root / 'usr/share/oxidal').mkdir(parents=True, exist_ok=True)
            shutil.copyfile(seed / 'development-presets.json', root / 'usr/share/oxidal/development-presets.json')
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
        packages = (appliance['runtime_packages'] + image_profile['diagnostic_packages']
                    + (['plymouth', 'plymouth-themes'] if boot_splash else []))
        if boot_splash and not (root / 'usr/share/plymouth/themes/oxidal/boot-splash.png').is_file():
            raise ValueError('Boot splash requires branded web assets in the bundle')
        commands = work / 'customize.txt'
        commands.write_text('\n'.join([
            'run-command mountpoint -q /boot/firmware && test -s /boot/firmware/cmdline.txt',
            'hostname oxidal',
            'install ' + ','.join(packages),
            'run-command tar -xf /tmp/oxidal-overlay.tar -C / && rm /tmp/oxidal-overlay.tar',
            'run-command getent group audio >/dev/null',
            'run-command getent group oxidal-control >/dev/null || groupadd --system oxidal-control',
            'run-command getent passwd oxidal-debug >/dev/null || useradd --system --no-create-home --home-dir /run/oxidal-debug --shell /usr/sbin/nologin --gid oxidal-control oxidal-debug',
            'run-command IFS=: read -r name hash < /tmp/oxidal-recovery.shadow; /usr/lib/userconf-pi/userconf "$name" "$hash" && rm /tmp/oxidal-recovery.shadow',

            'run-command systemctl enable ' + ' '.join(appliance['enabled_services']),
            'run-command systemctl mask ' + ' '.join([
                'systemd-networkd.service', 'systemd-networkd-wait-online.service',
                *image_profile['masked_units'],
            ]),
            'run-command systemctl set-default multi-user.target',
            "run-command sed -i 's/^LOGIN_TIMEOUT[[:space:]].*/LOGIN_TIMEOUT 180/' /etc/login.defs",
            'run-command systemd-analyze verify /etc/systemd/system/oxidald.service /etc/systemd/system/oxidal-regdomain.service /etc/systemd/system/oxidal-device.service /etc/systemd/system/oxidal-debug.service /etc/systemd/system/oxidal-terminal.service /etc/systemd/system/oxidal-admin-terminal.service /etc/systemd/system/oxidal-grow-data.service',
            'run-command nginx -t',
            *(['run-command plymouth-set-default-theme -R oxidal',
               "run-command sed -i '1s/$/ splash plymouth.ignore-serial-consoles/' /boot/firmware/cmdline.txt"] if boot_splash else []),
            'run-command dpkg-query -W > /usr/share/oxidal/installed-packages.txt',
        ]) + '\n')
        run('virt-customize', '-a', str(destination), '--upload', f'{overlay}:/tmp/oxidal-overlay.tar', '--upload', f'{access}/recovery.shadow:/tmp/oxidal-recovery.shadow', '--commands-from-file', str(commands))

        # Seed the writable partition only after package installation has completed,
        # then make it authoritative for state on the next boot.
        var_lib = work / 'var-lib.tar'
        connections = work / 'network-connections.tar'
        run('guestfish', '--ro', '-a', str(destination), '-m', '/dev/sda2',
            'tar-out', '/var/lib', str(var_lib), 'numericowner:true', 'xattrs:true', 'acls:true')
        run('guestfish', '--ro', '-a', str(destination), '-m', '/dev/sda2',
            'tar-out', '/etc/NetworkManager/system-connections', str(connections),
            'numericowner:true', 'xattrs:true', 'acls:true')
        run('guestfish', '-a', str(destination), '-m', '/dev/sda3',
            'mkdir-p', '/oxidal-system-connections', ':',
            'tar-in', str(var_lib), '/', 'xattrs:true', 'acls:true', ':',
            'tar-in', str(connections), '/oxidal-system-connections', 'xattrs:true', 'acls:true')
        fstab.write_text(provision.storage_fstab(fstab.read_text(), data_uuid))
        run('guestfish', '-a', str(destination), '-m', '/dev/sda2',
            'upload', str(fstab), '/etc/fstab')
        run('virt-customize', '-a', str(destination), '--run-command',
            'mount -a && OXIDAL_TEST_INSTALLED=1 python3 -m unittest discover -s /opt/oxidal/qualification -v > /usr/share/oxidal/installed-tests.log 2>&1')
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
        'hardware_qualified': False, 'physical_sd_written': False, 'boot_splash': boot_splash,
        'image_profile': profile_name, 'masked_units': image_profile['masked_units'],
        'development_presets': bool(development_presets), 'firmware_uuid': firmware_uuid,
        'root_uuid': root_uuid, 'data_uuid': data_uuid,
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
    parser.add_argument('--boot-splash', action='store_true', help='Enable the Oxidal Plymouth boot splash; console diagnostics remain available')
    parser.add_argument('--development-presets', help='Opt-in private development seed from a local native-preset directory; never for distribution')
    parser.add_argument('--profile', choices=('appliance', 'development'), default='appliance')
    args = parser.parse_args()
    print(json.dumps(build(args.base, args.bundle, args.access, args.output, args.boot_splash, args.development_presets, args.profile), indent=2))
