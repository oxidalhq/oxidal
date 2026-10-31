"""Real helper/NetworkManager boundary in an explicitly opted-in disposable Linux host.

Requires a running system bus and NetworkManager, root, and OXIDAL_DEVICE_BINARY.
No RF hardware is required; these tests do not change network profiles or links.
"""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import time
import unittest


@unittest.skipUnless(os.environ.get('OXIDAL_TEST_DEVICE') == '1', 'Disposable Linux device-service qualification')
class DeviceTests(unittest.TestCase):
    def test_real_networkmanager_helper_protocol_and_permissions(self):
        self.assertEqual(os.geteuid(), 0)
        runtime = Path('/run/oxidal-device')
        state = Path('/var/lib/oxidal-device')
        self.assertFalse((runtime / 'control.sock').exists(), 'Refuse to replace a running helper')
        self.assertFalse((state / 'pending.json').exists(), 'Refuse to touch a pending real network transaction')
        runtime.mkdir(mode=0o750, exist_ok=True)
        process = subprocess.Popen([os.environ['OXIDAL_DEVICE_BINARY']], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            path = runtime / 'control.sock'
            for _ in range(100):
                if process.poll() is not None:
                    self.fail('Device helper exited before becoming ready')
                if path.exists():
                    break
                time.sleep(.05)
            self.assertEqual(path.stat().st_mode & 0o777, 0o660)
            def request(command):
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(30)
                    client.connect(str(path))
                    data = json.dumps(command).encode()
                    client.sendall(struct.pack('!I', len(data)) + data)
                    def read(length):
                        data = b''
                        while len(data) < length:
                            chunk = client.recv(length - len(data))
                            if not chunk:
                                raise AssertionError('Truncated helper response')
                            data += chunk
                        return data
                    length = struct.unpack('!I', read(4))[0]
                    self.assertLessEqual(length, 65536)
                    return json.loads(read(length))
            reply = request({'type': 'status'})
            self.assertIsNone(reply['error'])
            self.assertTrue(reply['state']['available'])
            self.assertIsInstance(reply['state']['interfaces'], list)
            packs = request({'type': 'packs'})
            self.assertIsNone(packs['error'])
            self.assertEqual(len(packs['packs']['packs']), 8)
            self.assertNotIn('lsp', [pack['id'] for pack in packs['packs']['packs']])
            storage = request({'type': 'storage_status'})
            self.assertIsNone(storage['error'])
            self.assertFalse(storage['storage']['available'])
            self.assertIn('writable-data layout', storage['storage']['message'])
            # Unknown commands/fields and invalid inputs cannot reach nmcli.
            for command in ({'type': 'shell', 'command': 'reboot'}, {'type': 'status', 'shell': 'reboot'},
                            {'type': 'join', 'interface': '../invalid', 'ssid': 'Test', 'password': 'never-echo-test'},
                            {'type': 'pack', 'id': '../swh-lv2', 'action': 'install'}):
                result = request(command)
                self.assertIsNone(result['state'])
                self.assertTrue(result['error'])
                self.assertNotIn('never-echo-test', json.dumps(result))
            self.assertFalse((state / 'pending.json').exists())
            # Even accidentally widened socket permissions must not bypass peer UID checks.
            runtime.chmod(0o755)
            path.chmod(0o666)
            try:
                probe = "import socket,struct; s=socket.socket(socket.AF_UNIX); s.settimeout(5); s.connect('/run/oxidal-device/control.sock'); assert s.recv(1)==b''"
                subprocess.run(['/usr/bin/python3', '-c', probe], user=65534, group=65534, check=True, timeout=8)
            finally:
                runtime.chmod(0o750)
                path.chmod(0o660)
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stderr.close()
            (runtime / 'control.sock').unlink(missing_ok=True)
