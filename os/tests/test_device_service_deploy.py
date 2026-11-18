"""Administrative updates use temporary files and fake service calls, never the host."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('device_deploy', Path(__file__).parents[1] / 'scripts/development_deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def binary():
    data = bytearray(64)
    data[:7] = b'\x7fELF\x02\x01\x01'
    struct.pack_into('<HH', data, 16, 3, 183)
    return bytes(data)


class Services:
    def __init__(self, daemon=True, device=True, fail_start=False, fail_unit='oxidal-device.service'):
        self.active = {'oxidald.service': daemon, 'oxidal-device.service': device}
        self.calls = []
        self.fail_start = fail_start
        self.fail_unit = fail_unit

    def __call__(self, command, check, **kwargs):
        self.calls.append(command)
        if command[1] == 'is-active':
            return subprocess.CompletedProcess(command, 0 if self.active[command[-1]] else 3)
        action, unit = command[1:]
        if action == 'start' and unit == self.fail_unit and self.fail_start:
            self.fail_start = False
            raise subprocess.CalledProcessError(1, command)
        self.active[unit] = action == 'start'
        return subprocess.CompletedProcess(command, 0)


def probe(command, **kwargs):
    if command == 'packs':
        return {'error': None, 'packs': {'available': True, 'job': None}}
    if command == 'network_capabilities':
        return {'error': None, 'state': {'capabilities': {'schema_version': 1, 'saved_connect': True}}}
    raise AssertionError('Unexpected probe')


class DeviceServiceDeployTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='oxidal-device-deploy-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / 'app'
        self.state = Path(temporary.name) / 'state'
        self.state.mkdir()
        self.target = self.root / 'bin/oxidal-device-service'
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(b'previous service executable')
        self.target.chmod(0o751)
        self.files = {'oxidal-device-service': binary()}

    def install(self, services, query=probe):
        deploy.deploy_device_service(self.files, self.root, self.state, services, query)

    def test_archive_allows_only_bounded_arm64_executable_and_keeps_bins_prohibition(self):
        archive = self.root / 'device.tgz'
        def pack(name, data):
            with tarfile.open(archive, 'w:gz') as stream:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                stream.addfile(info, io.BytesIO(data))
            return hashlib.sha256(archive.read_bytes()).hexdigest()
        digest = pack('oxidal-device-service', binary())
        self.assertEqual(deploy.read_archive(archive, digest, 'device-service'), self.files)
        with self.assertRaisesRegex(ValueError, 'unapproved'):
            deploy.read_archive(archive, digest, 'bins')
        for name, data in [('oxidald', binary()), ('../oxidal-device-service', binary()), ('oxidal-device-service', b'not ELF')]:
            digest = pack(name, data)
            with self.assertRaises(ValueError):
                deploy.read_archive(archive, digest, 'device-service')
        for field, value in [(4, 1), (5, 2), (18, 62)]:
            wrong = bytearray(binary())
            wrong[field] = value
            with self.assertRaises(ValueError):
                deploy.device_binary(wrong)
        with self.assertRaises(ValueError):
            deploy.device_binary(b'x' * (deploy.DEVICE_SERVICE_MAX_BYTES + 1))
        with patch.object(deploy.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(SystemExit, 'Administrator approval'):
                deploy.main(['device-service', '0' * 64])

    def test_success_preserves_activity_and_retains_private_rollback(self):
        services = Services()
        self.install(services)
        self.assertEqual(self.target.read_bytes(), binary())
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o755)
        previous = self.root / 'deploy-rollback/device-service/oxidal-device-service'
        self.assertEqual(previous.read_bytes(), b'previous service executable')
        self.assertEqual(previous.stat().st_mode & 0o777, 0o600)
        self.assertEqual(previous.parent.stat().st_mode & 0o777, 0o700)
        self.assertTrue(all(services.active.values()))
        self.assertLess(services.calls.index(['systemctl', 'stop', 'oxidald.service']), services.calls.index(['systemctl', 'stop', 'oxidal-device.service']))
        self.assertEqual(services.calls[-1], ['systemctl', 'start', 'oxidald.service'])

    def test_inactive_services_stay_inactive_and_are_not_probed(self):
        for daemon_active in [False, True]:
            services = Services(daemon_active, False)
            def no_probe(*args, **kwargs):
                self.fail('An inactive service must not be started or probed')
            self.install(services, no_probe)
            self.assertEqual(services.active, {'oxidald.service': daemon_active, 'oxidal-device.service': False})
            self.assertFalse(any(command[-1] == 'oxidal-device.service' and command[1] != 'is-active' for command in services.calls))
            self.assertEqual(self.target.read_bytes(), binary())

    def test_pending_recovery_and_pack_work_leave_old_binary_and_activity(self):
        pending = self.state / 'pending.json'
        pending.write_text('pending recovery')
        services = Services()
        with self.assertRaisesRegex(ValueError, 'network recovery'):
            self.install(services)
        self.assertEqual(services.calls, [])
        pending.unlink()
        for job in [{'phase': 'running'}, 'invalid']:
            services = Services()
            def busy(command, **kwargs):
                return {'error': None, 'packs': {'available': True, 'job': job}}
            with self.assertRaisesRegex(ValueError, 'effect-pack work'):
                self.install(services, busy)
            self.assertEqual(self.target.read_bytes(), b'previous service executable')
            self.assertTrue(all(services.active.values()))
            self.assertNotIn(['systemctl', 'stop', 'oxidal-device.service'], services.calls)
        services = Services()
        def raced(command, **kwargs):
            pending.write_text('transaction completed admission before the daemon stopped')
            return probe(command, **kwargs)
        with self.assertRaisesRegex(ValueError, 'network recovery'):
            self.install(services, raced)
        self.assertTrue(all(services.active.values()))
        self.assertNotIn(['systemctl', 'stop', 'oxidal-device.service'], services.calls)

    def test_failed_restart_or_capability_check_restores_original_executable_and_activity(self):
        for start_failure in [False, True]:
            services = Services(fail_start=start_failure)
            def wrong_version(command, **kwargs):
                if command == 'packs':
                    return probe(command, **kwargs)
                return {'error': None, 'state': {'capabilities': {'schema_version': 2, 'saved_connect': True}}}
            with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                self.install(services, wrong_version)
            self.assertEqual(self.target.read_bytes(), b'previous service executable')
            self.assertEqual(self.target.stat().st_mode & 0o777, 0o751)
            self.assertTrue(all(services.active.values()))

    def test_daemon_restart_failure_also_restores_previous_device_service(self):
        services = Services(fail_start=True, fail_unit='oxidald.service')
        with self.assertRaises(subprocess.CalledProcessError):
            self.install(services)
        self.assertEqual(self.target.read_bytes(), b'previous service executable')
        self.assertTrue(all(services.active.values()))

    def test_unsafe_target_or_unreadable_activity_fails_before_changes(self):
        services = Services()
        original = self.target.with_suffix('.old')
        self.target.rename(original)
        self.target.symlink_to(original)
        with self.assertRaisesRegex(ValueError, 'unsafe'):
            self.install(services)
        self.assertEqual(services.calls, [])
        self.target.unlink()
        original.rename(self.target)
        def unknown(command, **kwargs):
            return subprocess.CompletedProcess(command, 4)
        with self.assertRaisesRegex(ValueError, 'activity'):
            self.install(unknown)
        self.assertEqual(self.target.read_bytes(), b'previous service executable')

    def test_capability_health_is_bounded_and_rejects_invalid_records(self):
        with patch.object(deploy.time, 'monotonic', side_effect=[0, 11]):
            with self.assertRaisesRegex(ValueError, 'timed out'):
                deploy.device_service_ready(lambda *args, **kwargs: self.fail('Deadline already passed'))
        for capabilities in [None, {'schema_version': True, 'saved_connect': True}, {'schema_version': 1, 'saved_connect': False}]:
            with self.assertRaises(ValueError):
                deploy.device_service_ready(lambda *args, **kwargs: {'error': None, 'state': {'capabilities': capabilities}})

    def test_probe_bounds_frames_and_checks_root_peer_before_sending(self):
        class Socket:
            def __init__(self, payload, uid=0):
                self.payload = payload
                self.uid = uid
                self.sent = False
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def settimeout(self, value): pass
            def connect(self, path): self.path = path
            def getsockopt(self, *args): return struct.pack('3i', 12, self.uid, 0)
            def sendall(self, data): self.sent = True
            def recv(self, count):
                value, self.payload = self.payload[:count], self.payload[count:]
                return value
        body = json.dumps(probe('packs')).encode()
        for payload, uid, valid in [(struct.pack('!I', len(body)) + body, 0, True), (struct.pack('!I', 65537), 0, False), (struct.pack('!I', 20) + b'{}', 0, False), (b'', 1000, False)]:
            client = Socket(payload, uid)
            with patch.object(deploy.socket, 'SO_PEERCRED', 17, create=True), patch.object(deploy.socket, 'socket', return_value=client):
                if valid:
                    self.assertEqual(deploy.query_device_service('packs'), probe('packs'))
                else:
                    with self.assertRaises(ValueError): deploy.query_device_service('packs')
            if uid:
                self.assertFalse(client.sent)
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            deploy.query_device_service('join')
