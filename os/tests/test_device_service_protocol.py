"""Read-only new-helper protocol in an explicitly disposable Linux container."""
import importlib.util
import os
from pathlib import Path
import subprocess
import time
import unittest

spec = importlib.util.spec_from_file_location('protocol_deploy', Path(__file__).parents[1] / 'scripts/development_deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


@unittest.skipUnless(os.environ.get('OXIDAL_TEST_DEVICE') == '1', 'Disposable Linux device-service protocol qualification')
class DeviceServiceProtocolTests(unittest.TestCase):
    def test_real_arm64_helper_exposes_versioned_capabilities_and_idle_pack_state(self):
        self.assertEqual(os.geteuid(), 0)
        runtime = Path('/run/oxidal-device')
        state = Path('/var/lib/oxidal-device')
        path = runtime / 'control.sock'
        self.assertFalse(path.exists(), 'Refuse to replace a running or stale real helper socket')
        self.assertFalse(state.exists() and any(state.iterdir()), 'Refuse existing device state; use a disposable host')
        created_runtime = not runtime.exists()
        created_state = not state.exists()
        runtime.mkdir(mode=0o750, exist_ok=True)
        process = subprocess.Popen([os.environ['OXIDAL_DEVICE_BINARY']], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    self.fail('Device helper exited before becoming ready')
                if path.exists():
                    break
                time.sleep(.05)
            self.assertEqual(path.stat().st_mode & 0o777, 0o660)
            deploy.device_service_ready(deploy.query_device_service)
            reply = deploy.query_device_service('network_capabilities')
            self.assertEqual(reply['state']['capabilities'], {'schema_version': 1, 'saved_connect': True, 'open_join': True, 'hotspot_radio': True, 'guarded_power': True})
            packs = deploy.query_device_service('packs')['packs']
            self.assertTrue(packs['available'])
            self.assertIsNone(packs['job'])
            self.assertFalse(any(state.iterdir()), 'Read probes must not publish network state')
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stderr.close()
            path.unlink(missing_ok=True)
            if created_runtime:
                runtime.rmdir()
            if created_state and state.exists() and not any(state.iterdir()):
                state.rmdir()
