"""Boot the assembled root filesystem under QEMU using a disposable copy-on-write overlay.

This qualifies systemd services and permissions, not the Raspberry Pi kernel or radio.
Set OXIDAL_TEST_BOOT_IMAGE, OXIDAL_TEST_BOOT_KERNEL and OXIDAL_TEST_BOOT_INITRD.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest

PROBE = r'''
import json, subprocess, time, urllib.request

def get(path):
    with urllib.request.urlopen('http://127.0.0.1:3210' + path, timeout=3) as reply:
        return json.loads(reply.read())

try:
    for attempt in range(150):
        try:
            health = get('/api/v1/health')
            native = get('/api/v1/native')
            break
        except Exception:
            time.sleep(.2)
    else:
        raise AssertionError('Daemon/native editor not ready after real systemd boot')
    assert health['native_editor'] and 'session' in native
    for service in ('oxidald', 'nginx', 'NetworkManager', 'avahi-daemon'):
        subprocess.run(['systemctl', 'is-active', '--quiet', service], check=True)
    pid = subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', 'oxidald'], text=True).strip()
    with open('/proc/' + pid + '/status') as file:
        assert not any(line.startswith('Uid:\t0\t') for line in file), 'Daemon must be unprivileged'
    import pwd, grp
    account = pwd.getpwnam('oxidal-admin')
    assert account.pw_uid >= 1000 and account.pw_shell == '/bin/bash'
    assert 'oxidal-admin' in grp.getgrnam('sudo').gr_mem
    with open('/etc/shadow') as shadow:
        recovery = next(line.split(':')[1] for line in shadow if line.startswith('oxidal-admin:'))
    assert recovery.startswith('$6$') and len(recovery) > 50
    ssh_config = subprocess.check_output(['/usr/sbin/sshd', '-T'], text=True)
    assert 'passwordauthentication yes' in ssh_config
    subprocess.run(['systemctl', 'is-active', '--quiet', 'ssh'], check=True)
    assert get('/api/v1/audio')['phase'] == 'stopped'
    assert get('/api/v1/graph-audio')['phase'] == 'stopped'
    # A real TLS listener must reject unauthenticated access after systemd starts nginx.
    import ssl, http.client, socket
    context = ssl.create_default_context(cafile='/opt/oxidal/boot-test-ca.crt')
    conn = http.client.HTTPSConnection('127.0.0.1', context=context)
    conn.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', 443), timeout=5), server_hostname='oxidal.local')
    conn.request('GET', '/', headers={'Host': 'oxidal.local'})
    assert conn.getresponse().status == 401
    conn.close()
    subprocess.run(['systemctl', 'restart', 'oxidald'], check=True)
    for attempt in range(100):
        try:
            state = get('/api/v1/native')
            assert state['session'] != native['session']
            break
        except Exception:
            time.sleep(.2)
    else:
        raise AssertionError('Service restart failed')
    print('OXIDAL_BOOT_QUALIFIED', flush=True)
except Exception:
    import traceback
    traceback.print_exc()
    subprocess.run(['journalctl', '-b', '-u', 'oxidald', '-u', 'nginx', '--no-pager', '-n', '60'])
    print('OXIDAL_BOOT_FAILED', flush=True)
finally:
    subprocess.run(['systemctl', 'poweroff'])
'''


@unittest.skipUnless(os.environ.get('OXIDAL_TEST_BOOT_IMAGE'), 'Optional assembled-image QEMU boot qualification')
class BootTests(unittest.TestCase):
    def test_systemd_boot_and_restart(self):
        image = Path(os.environ['OXIDAL_TEST_BOOT_IMAGE']).resolve(strict=True)
        kernel = Path(os.environ['OXIDAL_TEST_BOOT_KERNEL']).resolve(strict=True)
        initrd = Path(os.environ['OXIDAL_TEST_BOOT_INITRD']).resolve(strict=True)
        ca = Path(os.environ['OXIDAL_TEST_BOOT_CA']).resolve(strict=True)
        modules = Path('/lib/modules') / kernel.name.removeprefix('vmlinuz-')
        if not modules.is_dir():
            raise ValueError('The QEMU kernel requires its matching host module directory')
        env = {**os.environ, 'LIBGUESTFS_BACKEND': 'direct'}
        with tempfile.TemporaryDirectory(prefix='oxidal-boot-') as directory:
            root = Path(directory)
            overlay = root / 'boot.qcow2'
            subprocess.run(['qemu-img', 'create', '-f', 'qcow2', '-F', 'raw', '-b', str(image), str(overlay)], check=True)
            probe = root / 'probe.py'
            probe.write_text(PROBE)
            unit = root / 'oxidal-boot-test.service'
            unit.write_text('[Unit]\nDescription=Disposable boot qualification\nAfter=oxidald.service nginx.service NetworkManager.service avahi-daemon.service\nWants=oxidald.service nginx.service NetworkManager.service avahi-daemon.service\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 /opt/oxidal/boot-test.py\nStandardOutput=journal+console\nStandardError=journal+console\n[Install]\nWantedBy=multi-user.target\n')
            module_tar = root / 'modules.tar'
            with tarfile.open(module_tar, 'w') as archive:
                archive.add(modules, arcname=modules.name)
            subprocess.run(['guestfish', '-a', str(overlay), '-i', 'tar-in', str(module_tar), '/usr/lib/modules', ':', 'upload', str(probe), '/opt/oxidal/boot-test.py', ':', 'upload', str(ca), '/opt/oxidal/boot-test-ca.crt', ':', 'upload', str(unit), '/etc/systemd/system/oxidal-boot-test.service', ':', 'ln-s', '../oxidal-boot-test.service', '/etc/systemd/system/multi-user.target.wants/oxidal-boot-test.service'], env=env, check=True)
            log = root / 'serial.log'
            with log.open('wb') as output:
                process = subprocess.Popen(['qemu-system-aarch64', '-machine', 'virt', '-cpu', 'cortex-a72', '-m', '1536', '-smp', '2', '-nographic', '-no-reboot', '-kernel', str(kernel), '-initrd', str(initrd), '-append', 'root=/dev/vda2 rw console=ttyAMA0 systemd.show_status=1', '-drive', f'file={overlay},format=qcow2,if=virtio', '-device', 'virtio-rng-pci'], stdout=output, stderr=subprocess.STDOUT)
                try:
                    process.wait(timeout=240)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            text = log.read_text(errors='replace')
            evidence = image.with_suffix('.evidence')
            evidence.mkdir(exist_ok=True)
            (evidence / 'qemu-boot.log').write_text(text)
            self.assertTrue('OXIDAL_BOOT_QUALIFIED' in text, text[max(0, text.find('Traceback')):][:6000] if 'Traceback' in text else text[-6000:])
            self.assertNotIn('OXIDAL_BOOT_FAILED', text)
            (evidence / 'qemu-boot.json').write_text(json.dumps({'systemd_boot': 'passed', 'hardware_qualified': False, 'image_modified': False, 'kernel': kernel.name}) + '\n')
