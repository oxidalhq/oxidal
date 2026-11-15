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

    def test_ui_root_is_traversable_after_atomic_install(self):
        current = self.root / 'ui'
        current.mkdir()
        (current / 'index.html').write_bytes(b'old')

        deploy.deploy_ui({
            'index.html': b'new',
            'assets/app.js': b'app',
        }, self.root)

        self.assertEqual((current.stat().st_mode & 0o777), 0o755)
        self.assertEqual((current / 'index.html').read_bytes(), b'new')
        self.assertEqual((current / 'assets/app.js').read_bytes(), b'app')
        self.assertEqual(
            (self.root / 'deploy-rollback/ui/index.html').read_bytes(),
            b'old',
        )

    def splitter_entries(self, model=b'graph'):
        digest = hashlib.sha256(model).hexdigest()
        return [
            ('bin/demucs-onnx', b'#!/bin/sh', tarfile.REGTYPE),
            ('bin/demucs-onnx.real', b'runner', tarfile.REGTYPE),
            ('lib/libonnxruntime.so.1.23.2', b'ort', tarfile.REGTYPE),
            ('models/htdemucs.onnx', model, tarfile.REGTYPE),
            ('models/htdemucs.json', b'{}', tarfile.REGTYPE),
            ('models/SHA256SUMS', f'{digest}  htdemucs.onnx\n'.encode(), tarfile.REGTYPE),
            ('notices/rust-dependencies/ort/LICENSE-MIT', b'MIT', tarfile.REGTYPE),
        ]

    def test_splitter_release_is_streamed_and_made_current_by_symlink(self):
        releases = self.root / 'data/oxidal-splitter/releases'
        current = self.root / 'opt/splitter/current'
        path, digest = self.archive(self.splitter_entries())
        release = deploy.install_splitter(path, digest, releases, current)
        self.assertEqual(current.resolve(), release.resolve())
        self.assertEqual((current / 'bin/demucs-onnx.real').stat().st_mode & 0o777, 0o755)
        self.assertEqual((current / 'models/htdemucs.onnx').read_bytes(), b'graph')
        self.assertEqual(release.stat().st_mode & 0o777, 0o755)

        # A second release switches the link and keeps the first for rollback.
        path, second = self.archive(self.splitter_entries(b'graph two'))
        newer = deploy.install_splitter(path, second, releases, current)
        self.assertEqual(current.resolve(), newer.resolve())
        self.assertTrue(release.is_dir())
        path, third = self.archive(self.splitter_entries(b'graph three'))
        deploy.install_splitter(path, third, releases, current)
        self.assertFalse(release.exists())
        self.assertEqual(
            sorted(entry.name for entry in releases.iterdir()),
            sorted([second[:16], third[:16]]),
        )

    def test_splitter_rejects_unlisted_files_bad_models_and_checksums(self):
        releases = self.root / 'releases'
        current = self.root / 'current'
        path, digest = self.archive(self.splitter_entries())
        with self.assertRaisesRegex(ValueError, 'checksum'):
            deploy.install_splitter(path, '0' * 64, releases, current)
        for extra in [('bin/sh', b'x'), ('../escape', b'x'), ('models/other.onnx', b'x')]:
            path, digest = self.archive(self.splitter_entries() + [(*extra, tarfile.REGTYPE)])
            with self.assertRaisesRegex(ValueError, 'unapproved'):
                deploy.install_splitter(path, digest, releases, current)
        entries = self.splitter_entries()
        entries[3] = ('models/htdemucs.onnx', b'tampered', tarfile.REGTYPE)
        path, digest = self.archive(entries)
        with self.assertRaisesRegex(ValueError, 'Model checksum'):
            deploy.install_splitter(path, digest, releases, current)
        path, digest = self.archive(self.splitter_entries()[2:])
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            deploy.install_splitter(path, digest, releases, current)
        self.assertFalse(current.exists())
        self.assertEqual([e.name for e in releases.iterdir()], [])


if __name__ == '__main__':
    unittest.main()
