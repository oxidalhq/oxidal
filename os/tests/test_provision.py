import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('provision', Path(__file__).parents[1] / 'scripts/provision.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


class ProvisionTests(unittest.TestCase):
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
