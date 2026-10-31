"""Qualify next-boot storage switching on a disposable QEMU overlay.

Uses OXIDAL_TEST_STORAGE_IMAGE and the kernel/initrd settings from test_boot.
This exercises the real daemon/helper across four boots; it is not a physical
SD power-loss, Pi firmware, USB or radio qualification.
"""
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

PROBE = r'''
import errno, json, subprocess, time, urllib.request
from pathlib import Path

def api(path, body=None):
    request = urllib.request.Request('http://127.0.0.1:3210/api/v1/' + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'})
    # QEMU TCG may run alongside builds; retain the helper's own bounded command
    # deadlines, but do not impose a shorter wall-clock HTTP timeout here.
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)

try:
    for attempt in range(180):
        try:
            state = api('device/storage')
            if state['available']:
                break
        except Exception:
            pass
        time.sleep(.2)
    else:
        raise AssertionError('Storage helper not ready')
    progress = Path('/var/lib/oxidal/storage-qualification.json')
    phase = json.loads(progress.read_text())['next_phase'] if progress.exists() else 0
    expected = 'locked' if phase % 2 else 'unlocked'
    assert phase < 4 and state['current'] == expected, (phase, state)
    assert state['next_boot'] == expected and not state['reboot_required'], state
    for service in ('oxidald', 'oxidal-device', 'nginx', 'NetworkManager', 'ssh'):
        subprocess.run(['systemctl', 'is-active', '--quiet', service], check=True)
    assert subprocess.check_output(['systemctl', 'show', '--value', '-p', 'Result', 'oxidal-grow-data'], text=True).strip() == 'success'
    import shutil
    assert shutil.disk_usage('/var/lib').total > 3 * 1024**3, 'Data partition did not grow on the larger disk'
    assert api('device/network')['available']
    assert api('rig-audio')['phase'] == 'stopped'
    examples = [p for p in api('presets/rigs')['presets'] if p['origin'] == 'oxidal_example']
    if not Path('/usr/share/oxidal/development-library.json').exists():
        expected_examples = len(json.loads(Path('/opt/oxidal/factory/catalog.json').read_text())['sounds'])
        assert len(examples) == expected_examples, 'Factory examples did not survive startup/storage mode'
    # Persistent state survives every locked/unlocked boot, including re-lock.
    marker = Path('/var/lib/oxidal/storage-persistent-marker')
    if phase == 0:
        marker.write_text('presets-and-settings-survive\n')
    else:
        assert marker.read_text() == 'presets-and-settings-survive\n'
    system_marker = Path('/etc/oxidal-storage-write-probe')
    if expected == 'locked':
        try:
            system_marker.write_text('must not write')
        except OSError as error:
            assert error.errno == errno.EROFS, error
        else:
            raise AssertionError('Locked root accepted a write')
        assert system_marker.read_text() == 'unlocked write verified\n'
    else:
        system_marker.write_text('unlocked write verified\n')
    for directory in ('/tmp', '/var/tmp'):
        assert subprocess.check_output(['findmnt', '-n', '-o', 'FSTYPE', '--target', directory], text=True).strip() == 'tmpfs'
    # Drive the same next-boot API as Settings. It must not remount live root.
    next_mode = 'unlocked' if expected == 'locked' else 'locked'
    scheduled = api('device/storage', {'mode': next_mode})
    assert scheduled['current'] == expected and scheduled['next_boot'] == next_mode, scheduled
    assert scheduled['reboot_required']
    progress.write_text(json.dumps({'next_phase': phase + 1}))
    subprocess.run(['sync'], check=True)
    print('OXIDAL_STORAGE_QUALIFIED_' + str(phase), flush=True)
    api('device/network', {'type': 'power', 'action': 'shutdown'})
except Exception:
    import traceback
    traceback.print_exc()
    subprocess.run(['journalctl', '-b', '-u', 'oxidald', '-u', 'oxidal-device', '-u', 'nginx', '-u', 'oxidal-grow-data', '--no-pager', '-n', '50'])
    print('OXIDAL_STORAGE_FAILED', flush=True)
    subprocess.run(['systemctl', 'poweroff'])
'''


@unittest.skipUnless(os.environ.get('OXIDAL_TEST_STORAGE_IMAGE'), 'Optional image storage reboot qualification')
class StorageBootTests(unittest.TestCase):
    def test_unlock_lock_unlock_relock(self):
        image = Path(os.environ['OXIDAL_TEST_STORAGE_IMAGE']).resolve(strict=True)
        kernel = Path(os.environ['OXIDAL_TEST_BOOT_KERNEL']).resolve(strict=True)
        initrd = Path(os.environ['OXIDAL_TEST_BOOT_INITRD']).resolve(strict=True)
        modules = Path('/lib/modules') / kernel.name.removeprefix('vmlinuz-')
        if not modules.is_dir():
            raise ValueError('QEMU kernel modules are missing')
        env = {**os.environ, 'LIBGUESTFS_BACKEND': 'direct'}
        evidence = image.with_suffix('.evidence')
        evidence.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='oxidal-storage-') as directory:
            root = Path(directory)
            overlay = root / 'storage.qcow2'
            subprocess.run(['qemu-img', 'create', '-f', 'qcow2', '-F', 'raw', '-b', str(image), str(overlay)], check=True)
            subprocess.run(['qemu-img', 'resize', str(overlay), '10G'], check=True)
            probe = root / 'probe.py'
            probe.write_text(PROBE)
            unit = root / 'oxidal-storage-test.service'
            unit.write_text('[Unit]\nAfter=oxidald.service nginx.service NetworkManager.service\nWants=oxidald.service nginx.service NetworkManager.service\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 /opt/oxidal/storage-test.py\nStandardOutput=journal+console\nStandardError=journal+console\n[Install]\nWantedBy=multi-user.target\n')
            module_tar = root / 'modules.tar'
            with tarfile.open(module_tar, 'w') as archive:
                archive.add(modules, arcname=modules.name)
            subprocess.run(['guestfish', '-a', str(overlay), '-i', 'tar-in', str(module_tar), '/usr/lib/modules', ':', 'upload', str(probe), '/opt/oxidal/storage-test.py', ':', 'upload', str(unit), '/etc/systemd/system/oxidal-storage-test.service', ':', 'ln-s', '../oxidal-storage-test.service', '/etc/systemd/system/multi-user.target.wants/oxidal-storage-test.service'], env=env, check=True)
            for phase in range(4):
                # Consume the helper's actual persisted boot flags; only substitute
                # the QEMU root/console instead of the Pi firmware device names.
                cmdline = subprocess.check_output(['guestfish', '--ro', '-a', str(overlay), '-i', 'cat', '/boot/firmware/cmdline.txt'], env=env, text=True)
                flags = [token for token in cmdline.split() if token in ('ro', 'rw', 'systemd.volatile=state') or token.startswith('oxidal.storage=')]
                self.assertEqual(sum(flag in ('ro', 'rw') for flag in flags), 1)
                log = evidence / f'qemu-storage-{phase}.log'
                with log.open('wb') as output:
                    process = subprocess.Popen(['qemu-system-aarch64', '-machine', 'virt', '-cpu', 'cortex-a72', '-m', '1536', '-smp', '2', '-nographic', '-no-reboot', '-kernel', str(kernel), '-initrd', str(initrd), '-append', 'root=/dev/vda2 console=ttyAMA0 systemd.show_status=1 ' + ' '.join(flags), '-drive', f'file={overlay},format=qcow2,if=virtio', '-device', 'virtio-rng-pci'], stdout=output, stderr=subprocess.STDOUT)
                    try:
                        process.wait(timeout=240)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                text = log.read_text(errors='replace')
                self.assertIn(f'OXIDAL_STORAGE_QUALIFIED_{phase}', text, text[-9000:])
                self.assertNotIn('OXIDAL_STORAGE_FAILED', text)
                self.assertEqual(process.returncode, 0)
                print(f'Storage boot {phase + 1}/4 passed', flush=True)
        (evidence / 'qemu-storage.json').write_text(json.dumps({'boots': ['unlocked', 'locked', 'unlocked', 'locked'], 'persistent_state': 'passed', 'root_write_enforcement': 'passed', 'next_boot_api': 'passed', 'hardware_qualified': False, 'image_modified': False}) + '\n')
