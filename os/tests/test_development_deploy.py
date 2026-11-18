import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    'development_deploy', Path(__file__).parents[1] / 'scripts/development_deploy.py'
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
spec = importlib.util.spec_from_file_location('provision', Path(__file__).parents[1] / 'scripts/provision.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


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

    def lv2_entries(self, effect='moment', body=b'new'):
        bundle = f'oxidal-{effect}.lv2'
        names = ['manifest.ttl', f'{effect}.ttl', f'oxidal_{effect}.so', 'NOTICE']
        return [(f'{bundle}/{name}', body, tarfile.REGTYPE) for name in names]

    def test_lv2_archive_takes_only_whole_listed_bundles(self):
        path, digest = self.archive(self.lv2_entries())
        self.assertEqual(len(deploy.read_archive(path, digest, 'lv2')), 4)
        for name in [
            'oxidal-moment.lv2/extra.so',
            'oxidal-other.lv2/manifest.ttl',
            'oxidal-moment.lv2/nested/manifest.ttl',
            'manifest.ttl',
        ]:
            path, digest = self.archive([*self.lv2_entries(), (name, b'x', tarfile.REGTYPE)])
            with self.assertRaisesRegex(ValueError, 'unapproved'):
                deploy.read_archive(path, digest, 'lv2')
        path, digest = self.archive(self.lv2_entries()[:3])
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            deploy.read_archive(path, digest, 'lv2')

    def test_lv2_install_replaces_the_bundle_and_leaves_nothing_else_beside_it(self):
        directory = self.root / 'lib/lv2'
        old = directory / 'oxidal-moment.lv2'
        old.mkdir(parents=True)
        (old / 'stale.ttl').write_bytes(b'old')
        calls = []
        files = {name: body for name, body, _ in self.lv2_entries()}
        deploy.deploy_lv2(files, directory, self.root / 'opt', lambda c, check: calls.append(c))
        self.assertEqual(
            calls,
            [['systemctl', 'stop', 'oxidald.service'], ['systemctl', 'start', 'oxidald.service']],
        )
        self.assertEqual([p.name for p in directory.iterdir()], ['oxidal-moment.lv2'])
        self.assertFalse((old / 'stale.ttl').exists())
        self.assertEqual((old / 'moment.ttl').read_bytes(), b'new')
        self.assertTrue((old / 'oxidal_moment.so').stat().st_mode & 0o111)
        self.assertEqual(
            (self.root / 'opt/deploy-rollback/lv2/oxidal-moment.lv2/stale.ttl').read_bytes(),
            b'old',
        )
        self.assertEqual([p.name for p in (self.root / 'lib').iterdir()], ['lv2'])

    def test_lv2_failure_restores_the_previous_bundle(self):
        directory = self.root / 'lib/lv2'
        old = directory / 'oxidal-moment.lv2'
        old.mkdir(parents=True)
        (old / 'moment.ttl').write_bytes(b'old')
        calls = []

        def run(command, check):
            calls.append(command)
            if command[1] == 'start' and len(calls) == 2:
                raise RuntimeError('start failed')

        files = {name: body for name, body, _ in self.lv2_entries()}
        with self.assertRaisesRegex(RuntimeError, 'start failed'):
            deploy.deploy_lv2(files, directory, self.root / 'opt', run)
        self.assertEqual((old / 'moment.ttl').read_bytes(), b'old')
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


class PublicCertificateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.certificates = tempfile.TemporaryDirectory(prefix='oxidal-test-ca-')
        cls.addClassCleanup(cls.certificates.cleanup)
        cls.access = Path(cls.certificates.name) / 'access'
        provision.create_access(cls.access)
        cls.other = Path(cls.certificates.name) / 'other'
        provision.create_access(cls.other)

    setUp = DevelopmentDeployTests.setUp
    archive = DevelopmentDeployTests.archive

    def files(self):
        return {'ca.crt': (self.access / 'ca.crt').read_bytes()}

    def install_fixture(self, hotspot=True):
        tls = self.root / 'etc/oxidal/tls'
        tls.mkdir(parents=True)
        (tls / 'server.crt').write_bytes((self.access / 'server.crt').read_bytes())
        # A sentinel proves the public deployment never opens or replaces keys.
        (tls / 'server.key').write_bytes(b'unchanged key sentinel')
        configs = self.root / 'etc/nginx/conf.d'
        configs.mkdir(parents=True)
        for name, block in [('oxidal.conf', deploy.HTTPS_CERTIFICATE_ROUTES), ('oxidal-portal.conf', deploy.HTTP_CERTIFICATE_ROUTES)]:
            if name == 'oxidal-portal.conf' and not hotspot:
                continue
            source = 'oxidal-nginx.conf' if name == 'oxidal.conf' else name
            (configs / name).write_text((provision.HERE / 'config' / source).read_text().replace(block, ''))
        return configs

    def test_metadata_fingerprint_matches_openssl_and_installed_chain(self):
        result = deploy.certificate_files(self.files()['ca.crt'], self.access / 'server.crt', True)
        metadata = json.loads(result['certificate.json'])
        actual = subprocess.check_output(['openssl', 'x509', '-in', str(self.access / 'ca.crt'), '-noout', '-fingerprint', '-sha256'], text=True).strip().split('=', 1)[1]
        self.assertEqual(metadata['fingerprint_sha256'], actual)
        self.assertEqual(metadata['server_names'], ['10.42.0.1', 'oxidal.local'])
        self.assertEqual(metadata['https_download'], '/api/v1/device/certificate')
        self.assertEqual(metadata['hotspot_download'], '/certificate.crt')
        self.assertIsNone(json.loads(deploy.certificate_files(self.files()['ca.crt'], self.access / 'server.crt')['certificate.json'])['hotspot_download'])
        self.assertEqual(set(result), {'ca.crt', 'certificate.json'})

    def test_only_one_bounded_public_ca_matching_the_server_is_accepted(self):
        ca = self.files()['ca.crt']
        for invalid in [b'x' * (deploy.CERTIFICATE_MAX_BYTES + 1), ca + ca, b'-----BEGIN ' + b'PRIVATE KEY-----\nnot a certificate', (self.access / 'server.crt').read_bytes(), (self.other / 'ca.crt').read_bytes()]:
            with self.subTest(size=len(invalid)):
                with self.assertRaises(ValueError):
                    deploy.certificate_files(invalid, self.access / 'server.crt')

    def test_archive_excludes_private_keys_and_other_files(self):
        path, digest = self.archive([('ca.crt', self.files()['ca.crt'], tarfile.REGTYPE)])
        self.assertEqual(deploy.read_archive(path, digest, 'certificate'), self.files())
        for name, body in [('ca.key', b'not included'), ('server.crt', b'not included'), ('ca.crt', b'x' * (deploy.CERTIFICATE_MAX_BYTES + 1))]:
            path, digest = self.archive([(name, body, tarfile.REGTYPE)])
            with self.assertRaisesRegex(ValueError, 'unapproved'):
                deploy.read_archive(path, digest, 'certificate')

    def test_routes_match_provisioning_and_preserve_authentication_and_guards(self):
        for source, block, portal in [('oxidal-nginx.conf', deploy.HTTPS_CERTIFICATE_ROUTES, False), ('oxidal-portal.conf', deploy.HTTP_CERTIFICATE_ROUTES, True)]:
            current = (provision.HERE / 'config' / source).read_text()
            self.assertEqual(current.count(block), 1)
            self.assertEqual(deploy.certificate_locations(current.replace(block, ''), portal), current)
            self.assertEqual(deploy.certificate_locations(current, portal), current)
            for invalid in [current + block, current.replace(block, deploy.CERTIFICATE_MARKER + '\n'), 'unknown configuration']:
                with self.assertRaisesRegex(ValueError, 'Unrecognized'):
                    deploy.certificate_locations(invalid, portal)

    def test_install_is_idempotent_and_never_restarts_audio_or_replaces_keys(self):
        configs = self.install_fixture()
        calls = []
        run = lambda command, check: calls.append(command)
        deploy.deploy_certificate(self.files(), self.root, run)
        self.assertEqual(calls, [['nginx', '-t'], ['systemctl', 'reload', 'nginx.service']])
        self.assertEqual((configs / 'oxidal.conf').read_text(), (provision.HERE / 'config/oxidal-nginx.conf').read_text())
        self.assertEqual((self.root / 'etc/oxidal/tls/server.key').read_bytes(), b'unchanged key sentinel')
        public = self.root / 'usr/share/oxidal/public'
        self.assertEqual(sorted(path.name for path in public.iterdir()), ['ca.crt', 'certificate.json'])
        self.assertEqual((public / 'ca.crt').stat().st_mode & 0o777, 0o644)
        deploy.deploy_certificate(self.files(), self.root, run)
        self.assertEqual(len(calls), 2)

    def test_failed_validation_or_reload_restores_every_previous_file(self):
        for fail_at in [1, 2]:
            with self.subTest(fail_at=fail_at):
                directory = self.root / str(fail_at)
                directory.mkdir()
                original_root = self.root
                self.root = directory
                configs = self.install_fixture()
                before = {path: path.read_bytes() for path in configs.iterdir()}
                public = self.root / 'usr/share/oxidal/public'
                public.mkdir(parents=True)
                (public / 'ca.crt').write_bytes(b'old public file')
                calls = []
                def run(command, check):
                    calls.append(command)
                    if len(calls) == fail_at:
                        raise RuntimeError('nginx rejected the update')
                with self.assertRaisesRegex(RuntimeError, 'nginx rejected'):
                    deploy.deploy_certificate(self.files(), self.root, run)
                self.assertEqual({path: path.read_bytes() for path in configs.iterdir()}, before)
                self.assertEqual((public / 'ca.crt').read_bytes(), b'old public file')
                self.assertFalse((public / 'certificate.json').exists())
                self.assertEqual(calls[-1], ['systemctl', 'reload', 'nginx.service'])
                self.root = original_root

    def test_wrong_ca_fails_before_writes_or_reload(self):
        self.install_fixture(False)
        before = {str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}
        calls = []
        with self.assertRaisesRegex(ValueError, 'does not verify'):
            deploy.deploy_certificate({'ca.crt': (self.other / 'ca.crt').read_bytes()}, self.root, lambda command, check: calls.append(command))
        self.assertEqual(calls, [])
        self.assertEqual({str(path.relative_to(self.root)): path.read_bytes() for path in self.root.rglob('*') if path.is_file()}, before)


if __name__ == '__main__':
    unittest.main()
