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

HERE = Path(__file__).resolve().parents[1]


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


def provision(path, apply=False):
    """Return an idempotent plan; apply only when explicitly requested. @see docs/architecture.md"""
    data = manifest()
    root = target_root(path)
    files = {
        'etc/systemd/system/oxidald.service': (HERE / 'config/oxidald.service').read_bytes(),
        'usr/share/oxidal/base-manifest.json': (json.dumps(data, indent=2) + '\n').encode(),
    }
    # Validate all destinations before the first write.
    destinations = {name: inside(root, name) for name in files}
    changes = [name for name, content in files.items() if not destinations[name].exists() or destinations[name].read_bytes() != content]
    if apply:
        for name in changes:
            target = destinations[name]
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = inside(root, name + '.oxidal-tmp')
            temporary.write_bytes(files[name])
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
    args = parser.parse_args()
    try:
        if args.check_manifest:
            result = manifest()
        elif args.verify_image:
            result = verify_image(args.verify_image)
        elif args.target_root:
            result = provision(args.target_root, args.apply)
        else:
            parser.error('Specify --check-manifest, --verify-image, or --target-root')
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
