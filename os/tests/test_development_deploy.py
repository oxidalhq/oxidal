import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'development_deploy', Path(__file__).parents[1] / 'scripts/development_deploy.py'
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DevelopmentDeployTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='oxidal-deploy-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def archive(self, entries):
        path = self.root / 'payload.tgz'
        with tarfile.open(path, 'w:gz') as archive:
            for name, body, kind in entries:
                info = tarfile.TarInfo(name)
                info.size = len(body)
                info.type = kind
                archive.addfile(info, io.BytesIO(body))
        return path, hashlib.sha256(path.read_bytes()).hexdigest()

    def test_binary_archive_is_checksum_and_allowlist_bound(self):
        path, digest = self.archive([('oxidald', b'new daemon', tarfile.REGTYPE)])
        self.assertEqual(deploy.read_archive(path, digest, 'bins'), {'oxidald': b'new daemon'})
        with self.assertRaisesRegex(ValueError, 'Unknown'):
            deploy.read_archive(path, digest, 'other')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            deploy.read_archive(path, '0' * 64, 'bins')
        path, digest = self.archive([('oxidal-device-service', b'root helper', tarfile.REGTYPE)])
        with self.assertRaisesRegex(ValueError, 'unapproved'):
            deploy.read_archive(path, digest, 'bins')

    def test_ui_requires_index_and_rejects_links_or_traversal(self):
        path, digest = self.archive([
            ('index.html', b'<html></html>', tarfile.REGTYPE),
            ('assets/app.js', b'app', tarfile.REGTYPE),
        ])
        self.assertEqual(set(deploy.read_archive(path, digest, 'ui')), {'index.html', 'assets/app.js'})
        for name, kind in [('../escape', tarfile.REGTYPE), ('link', tarfile.SYMTYPE)]:
            path, digest = self.archive([(name, b'x', kind)])
            with self.assertRaisesRegex(ValueError, 'unsafe|incomplete'):
                deploy.read_archive(path, digest, 'ui')

    def test_binary_failure_restores_previous_files(self):
        binary = self.root / 'bin/oxidald'
        binary.parent.mkdir()
        binary.write_bytes(b'old daemon')
        calls = []

        def run(command, check):
            calls.append(command)
            if command[:2] == ['systemctl', 'start'] and len(calls) == 2:
                raise RuntimeError('start failed')

        with self.assertRaisesRegex(RuntimeError, 'start failed'):
            deploy.deploy_bins({'oxidald': b'bad daemon'}, self.root, run)
        self.assertEqual(binary.read_bytes(), b'old daemon')
        self.assertEqual(calls[-1], ['systemctl', 'start', 'oxidald.service'])


if __name__ == '__main__':
    unittest.main()
