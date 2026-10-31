"""Qualification inside the final Linux filesystem, without a sound card or SD writer."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest
import urllib.request


@unittest.skipUnless(os.environ.get('OXIDAL_TEST_INSTALLED') == '1', 'Run by the disposable image builder')
class InstalledTests(unittest.TestCase):
    def test_image_profile(self):
        profile = json.loads(Path('/usr/share/oxidal/image-profile.json').read_text())
        self.assertIn(profile['name'], ('appliance', 'development'))
        for unit in profile['masked_units']:
            result = subprocess.run(
                ['systemctl', 'is-enabled', unit], text=True, capture_output=True
            )
            self.assertEqual(result.stdout.strip(), 'masked', (unit, result.stdout, result.stderr))
        for package in profile['diagnostic_packages']:
            subprocess.run(
                ['dpkg-query', '-W', '-f=${db:Status-Status}', package],
                check=True,
                text=True,
                capture_output=True,
            )
        if profile['name'] == 'appliance':
            self.assertEqual(profile['diagnostic_packages'], [])

    def test_writable_data_layout(self):
        marker = Path('/usr/share/oxidal/storage-layout-v1')
        self.assertTrue(marker.is_file())
        source = subprocess.check_output(
            ['findmnt', '-n', '-o', 'SOURCE', '--target', '/var/lib'], text=True
        ).strip()
        device = subprocess.check_output(['readlink', '-f', source], text=True).strip()
        self.assertEqual(
            subprocess.check_output(
                ['blkid', '-s', 'LABEL', '-o', 'value', device], text=True
            ).strip(),
            'OXIDAL_DATA',
        )
        self.assertEqual(
            subprocess.check_output(
                ['findmnt', '-n', '-o', 'FSTYPE', '--target', '/var/lib'], text=True
            ).strip(),
            'ext4',
        )
        profile_mount = subprocess.check_output(
            [
                'findmnt',
                '-n',
                '-o',
                'TARGET',
                '--target',
                '/etc/NetworkManager/system-connections',
            ],
            text=True,
        ).strip()
        self.assertEqual(profile_mount, '/etc/NetworkManager/system-connections')
        for target in ('/tmp', '/var/tmp'):
            self.assertEqual(
                subprocess.check_output(
                    ['findmnt', '-n', '-o', 'FSTYPE', '--target', target], text=True
                ).strip(),
                'tmpfs',
            )
        self.assertIn(
            'Storage=volatile',
            Path('/etc/systemd/journald.conf.d/oxidal-volatile.conf').read_text(),
        )
        probe = Path('/var/lib/oxidal-layout-probe')
        probe.write_text('writable data\n')
        self.assertEqual(probe.read_text(), 'writable data\n')
        probe.unlink()

    def test_firmware_mount_and_optional_boot_branding(self):
        # Kernel package hooks and splash rebuilds must reach the real FAT partition.
        subprocess.run(['mountpoint', '-q', '/boot/firmware'], check=True)
        firmware = Path('/boot/firmware')
        command = (firmware / 'cmdline.txt').read_text().split()
        self.assertTrue(any(item.startswith('root=PARTUUID=') for item in command))
        self.assertTrue((firmware / 'kernel_2712.img').is_file())
        if 'splash' in command:
            contents = subprocess.check_output(['lsinitramfs', str(firmware / 'initramfs_2712')], text=True)
            self.assertIn('usr/share/plymouth/themes/oxidal/boot-splash.png', contents)
            self.assertIn('usr/share/plymouth/themes/oxidal/oxidal.script', contents)

        if Path('/etc/NetworkManager/system-connections/oxidal.nmconnection').is_file():
            dns = Path('/etc/NetworkManager/dnsmasq-shared.d/oxidal-portal.conf')
            self.assertTrue(dns.is_file())
            subprocess.run(['dnsmasq', '--test', '--conf-file=' + str(dns)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self.assertTrue(Path('/etc/nginx/conf.d/oxidal-portal.conf').is_file())
            self.assertIn('Open Oxidal', Path('/usr/share/oxidal/portal/index.html').read_text())
            self.assertIn(b'<svg', Path('/opt/oxidal/ui/brand/wordmark.svg').read_bytes())

    def test_relocated_workers_ui_and_shutdown(self):
        home = Path('/opt/oxidal')
        import hashlib
        notices = home / 'licenses/artwork-https'
        inventory = json.loads((notices / 'manifest.json').read_text())
        for name, entry in inventory.items():
            for relative, digest in entry['licenses'].items():
                contents = (notices / (name + '-' + entry['version']) / relative).read_bytes()
                self.assertEqual(hashlib.sha256(contents).hexdigest(), digest)
        for binary in ['bin/oxidald', 'bin/oxidal-native-worker', 'bin/oxidal-audio-worker', 'bin/oxidal-graph-worker', 'bin/oxidal-rig-worker', 'bin/oxidal-device-service', 'bin/oxidal-debug-service', 'bin/oxidal-terminal-service', 'bin/oxidal-preset-seed', 'lib/liboxidal_tone3000.so']:
            output = subprocess.check_output(['ldd', str(home / binary)], text=True)
            self.assertNotIn('not found', output)
            self.assertNotIn('/tmp/oxidal-', output)
        with tempfile.TemporaryDirectory(prefix='oxidal-installed-') as temporary:
            env = {**os.environ, 'OXIDAL_ADDR': '127.0.0.1:3210', 'OXIDAL_SIMULATOR': '0',
                   'OXIDAL_PRESET_DIR': temporary + '/presets', 'OXIDAL_MAPPING_PATH': temporary + '/mappings.json',
                   'OXIDAL_UI_DIR': str(home / 'ui'), 'LV2_PATH': '/usr/lib/lv2',
                   'OXIDAL_NATIVE_WORKER': str(home / 'bin/oxidal-native-worker'),
                   'OXIDAL_AUDIO_WORKER': str(home / 'bin/oxidal-audio-worker'),
                   'OXIDAL_GRAPH_WORKER': str(home / 'bin/oxidal-graph-worker'),
                   'OXIDAL_RIG_WORKER': str(home / 'bin/oxidal-rig-worker')}
            with open(temporary + '/daemon.log', 'w+') as log:
                daemon = subprocess.Popen([str(home / 'bin/oxidald')], env=env, stdout=log, stderr=log)
                try:
                    def get(path):
                        with urllib.request.urlopen('http://127.0.0.1:3210' + path, timeout=3) as response:
                            return response.read()
                    for _ in range(150):
                        if daemon.poll() is not None:
                            log.seek(0)
                            self.fail(log.read())
                        try:
                            health = json.loads(get('/api/v1/health'))
                            break
                        except OSError:
                            time.sleep(.1)
                    else:
                        self.fail('Daemon did not become ready')
                    self.assertTrue(health['native_editor'])
                    self.assertNotEqual(health['midi_transport'], 'simulator')
                    self.assertEqual(json.loads(get('/api/v1/audio'))['phase'], 'stopped')
                    self.assertEqual(json.loads(get('/api/v1/graph-audio'))['phase'], 'stopped')
                    self.assertEqual(json.loads(get('/api/v1/rig-audio'))['phase'], 'stopped')
                    self.assertIn(b'<html', get('/'))
                    self.assertIn('session', json.loads(get('/api/v1/native')))
                    self.assertTrue(json.loads(get('/api/v1/audio/devices'))['backend_available'])
                    events = urllib.request.urlopen('http://127.0.0.1:3210/api/v1/events', timeout=3)
                    self.assertTrue(events.readline())
                    daemon.send_signal(signal.SIGTERM)
                    self.assertEqual(daemon.wait(timeout=12), 0)
                    events.close()
                finally:
                    if daemon.poll() is None:
                        daemon.kill()
                        daemon.wait()
