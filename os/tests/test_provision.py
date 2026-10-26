import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('provision', Path(__file__).parents[1] / 'scripts/provision.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


class ProvisionTests(unittest.TestCase):
    def test_firmware_uuid_preserves_root_and_rejects_ambiguous_mounts(self):
        original = 'proc /proc proc defaults 0 0\nPARTUUID=12345678-01 /boot/firmware vfat defaults 0 2\nPARTUUID=12345678-02 / ext4 defaults,noatime 0 1\n'
        root_uuid = '12345678-abcd-0123-abcd-0123456789ab'
        updated = provision.firmware_fstab(original, 'ABCD-0123', root_uuid)
        self.assertIn('UUID=ABCD-0123 /boot/firmware vfat defaults 0 2', updated)
        self.assertIn('UUID=' + root_uuid + ' / ext4 defaults,noatime 0 1', updated)
        self.assertEqual(provision.firmware_fstab(updated, 'ABCD-0123', root_uuid), updated)
        for text, uuid in [(original, '../invalid'), ('', 'ABCD-0123'), (original + original, 'ABCD-0123')]:
            with self.assertRaises(ValueError):
                provision.firmware_fstab(text, uuid, root_uuid)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='os-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        (self.root / 'etc').mkdir()
        (self.root / 'etc/os-release').write_text('ID=debian\nVERSION_CODENAME=trixie\n')
        (self.root / '.oxidal-disposable-root').touch()

    def test_dry_run_is_read_only_and_apply_is_idempotent(self):
        before = sorted(str(p) for p in self.root.rglob('*'))
        self.assertEqual(len(provision.provision(self.root)['changes']), 2)
        self.assertEqual(before, sorted(str(p) for p in self.root.rglob('*')))
        self.assertEqual(len(provision.provision(self.root, True)['changes']), 2)
        self.assertEqual(provision.provision(self.root, True)['changes'], [])
        self.assertEqual(provision.provision(self.root)['services_enabled'], [])

    def test_refuses_host_unmarked_wrong_base_and_symlink_escape(self):
        for root in ['/', '/dev/null']:
            with self.assertRaises((ValueError, OSError)): provision.provision(root, True)
        (self.root / '.oxidal-disposable-root').unlink()
        with self.assertRaises(ValueError): provision.provision(self.root, True)
        (self.root / '.oxidal-disposable-root').touch()
        (self.root / 'etc/os-release').write_text('VERSION_CODENAME=bookworm\n')
        with self.assertRaises(ValueError): provision.provision(self.root, True)
        (self.root / 'etc/os-release').write_text('VERSION_CODENAME=trixie\n')
        (self.root / 'usr').symlink_to(Path('/tmp'), target_is_directory=True)
        with self.assertRaises(ValueError): provision.provision(self.root, True)
        self.assertFalse((self.root / 'etc/systemd').exists())

    def test_rejects_wrong_image_hash(self):
        image = self.root / 'not-an-image.xz'
        image.write_bytes(b'not-an-image')
        with self.assertRaises(ValueError): provision.verify_image(image)
        self.assertEqual(provision.manifest()['architecture'], 'arm64')

class ApplianceTests(ProvisionTests):
    def setUp(self):
        super().setUp()
        import hashlib
        import json
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        files = {}
        elf = bytearray(32)
        elf[:6] = b'\x7fELF\x02\x01'
        elf[18:20] = (183).to_bytes(2, 'little')
        for name in ('bin/oxidald', 'bin/oxidal-native-worker', 'bin/oxidal-audio-worker', 'bin/oxidal-graph-worker', 'bin/oxidal-device-service', 'bin/oxidal-debug-service', 'bin/oxidal-preset-seed', 'lib/liboxidal_tone3000.so', 'ui/index.html'):
            file = self.bundle / name
            file.parent.mkdir(exist_ok=True)
            file.write_bytes(bytes(elf) if name != 'ui/index.html' else b'<html>fixture</html>')
            files[name] = hashlib.sha256(file.read_bytes()).hexdigest()
        (self.bundle / 'manifest.json').write_text(json.dumps({'format': 2, 'engine_available': True, 'target': 'linux-arm64', 'files': files}))

    def test_native_bundle_integrity_install_and_idempotence(self):
        result = provision.provision(self.root, bundle=self.bundle)
        self.assertIn('opt/oxidal/bin/oxidald', result['changes'])
        self.assertFalse((self.root / 'opt').exists())
        provision.provision(self.root, True, self.bundle)
        self.assertEqual((self.root / 'opt/oxidal/bin/oxidald').stat().st_mode & 0o777, 0o755)
        self.assertEqual(provision.provision(self.root, True, self.bundle)['changes'], [])
        self.assertIn(b'O X I D A L', (self.root / 'etc/issue.d/90-oxidal.issue').read_bytes())
        helper = (self.root / 'etc/systemd/system/oxidal-device.service').read_text()
        self.assertIn('RestrictAddressFamilies=AF_UNIX', helper)
        self.assertIn('NoNewPrivileges=yes', helper)
        self.assertNotIn('sudo', (self.root / 'etc/systemd/system/oxidald.service').read_text())
        (self.bundle / 'bin/oxidald').write_bytes(b'corrupted')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            provision.provision(self.root, True, self.bundle)

    def test_bundle_symlinks_architecture_and_traversal_rejected(self):
        import json
        manifest = self.bundle / 'manifest.json'
        data = json.loads(manifest.read_text())
        data['target'] = 'linux-x64'
        manifest.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, 'architecture'):
            provision.provision(self.root, True, self.bundle)
        data['target'] = 'linux-arm64'
        data['files']['../escape'] = '0' * 64
        manifest.write_text(json.dumps(data))
        with self.assertRaises(ValueError):
            provision.provision(self.root, True, self.bundle)
        del data['files']['../escape']
        manifest.write_text(json.dumps(data))
        (self.bundle / 'bin/oxidald').unlink()
        (self.bundle / 'bin/oxidald').symlink_to('/bin/sh')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            provision.provision(self.root, True, self.bundle)
        self.assertFalse((self.root / 'opt').exists())

    def test_temporary_symlink_is_rejected_before_any_write(self):
        (self.root / 'usr/share/oxidal').mkdir(parents=True)
        (self.root / 'usr/share/oxidal/base-manifest.json.oxidal-tmp').symlink_to('/tmp')
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            provision.provision(self.root, True, self.bundle)
        self.assertFalse((self.root / 'etc/systemd').exists())

    def test_hotspot_image_clears_vendor_radio_disabled_state(self):
        import json
        access = self.root / 'access'
        access.mkdir()
        for name in ('server.crt', 'server.key', 'access.htpasswd'):
            (access / name).write_text('fixture')
        (access / 'hotspot.json').write_text(json.dumps({'ssid': 'Oxidal-abcdef', 'password': 'test-only-password-123', 'country': 'NZ'}))
        state = self.root / 'var/lib/NetworkManager/NetworkManager.state'
        state.parent.mkdir(parents=True)
        state.write_text('[main]\nWirelessEnabled=false\n')
        provision.provision(self.root, bundle=self.bundle, access=access, hotspot=True)
        self.assertIn('WirelessEnabled=false', state.read_text())
        provision.provision(self.root, True, self.bundle, access, True)
        self.assertIn('WirelessEnabled=true', state.read_text())
        self.assertEqual(state.stat().st_mode & 0o777, 0o600)
        self.assertEqual(provision.provision(self.root, True, self.bundle, access, True)['changes'], [])
