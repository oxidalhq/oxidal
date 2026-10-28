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
from pathlib import Path

def get(path):
    with urllib.request.urlopen('http://127.0.0.1:3210' + path, timeout=3) as reply:
        return json.loads(reply.read())

qualified = False
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
    for service in ('oxidald', 'nginx', 'NetworkManager', 'avahi-daemon', 'oxidal-device', 'oxidal-debug', 'oxidal-terminal', 'oxidal-admin-terminal'):
        subprocess.run(['systemctl', 'is-active', '--quiet', service], check=True)
    pid = subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', 'oxidald'], text=True).strip()
    with open('/proc/' + pid + '/status') as file:
        assert not any(line.startswith('Uid:\t0\t') for line in file), 'Daemon must be unprivileged'
    import pwd, grp
    daemon_uid = pwd.getpwnam('oxidald').pw_uid
    assert daemon_uid != 0, 'The dynamic daemon identity must resolve through NSS'
    network = get('/api/v1/device/network')
    assert network['available'], network
    account = pwd.getpwnam('oxidal-admin')
    assert account.pw_uid >= 1000 and account.pw_shell == '/bin/bash'
    assert 'oxidal-admin' in grp.getgrnam('sudo').gr_mem
    with open('/etc/shadow') as shadow:
        recovery = next(line.split(':')[1] for line in shadow if line.startswith('oxidal-admin:'))
    assert recovery.startswith('$6$') and len(recovery) > 50
    import re
    with open('/etc/login.defs') as file:
        assert re.search(r'^LOGIN_TIMEOUT\s+180\s*$', file.read(), re.M)
    ssh_config = subprocess.check_output(['/usr/sbin/sshd', '-T'], text=True)
    assert 'passwordauthentication yes' in ssh_config
    subprocess.run(['systemctl', 'is-active', '--quiet', 'ssh'], check=True)
    assert get('/api/v1/audio')['phase'] == 'stopped'
    assert get('/api/v1/graph-audio')['phase'] == 'stopped'
    assert get('/api/v1/rig-audio')['phase'] == 'stopped'
    # The installed daemon must serve optional development originals unchanged.
    from pathlib import Path
    seed = Path('/usr/share/oxidal/development-presets.json')
    if seed.exists():
        import hashlib
        manifest = json.loads(seed.read_text())
        library = get('/api/v1/presets')
        assert len(library['presets']) == len(manifest['files']) > 0
        for original in manifest['files']:
            with urllib.request.urlopen('http://127.0.0.1:3210/api/v1/presets/' + original['sha256'] + '/original', timeout=5) as reply:
                data = reply.read()
            assert len(data) == original['bytes']
            assert hashlib.sha256(data).hexdigest() == original['sha256']
    # Full unprivileged PTY: actual identity, retained state, output, Ctrl-C and cgroup cleanup.
    import os, re
    terminal_mode = 'unprivileged'
    def terminal(command):
        request = urllib.request.Request('http://127.0.0.1:3210/api/v1/terminal/' + terminal_mode,
            data=json.dumps(command).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=5) as reply:
            return json.loads(reply.read())
    for attempt in range(30):
        try:
            terminal({'type': 'read', 'id': None, 'cursor': 0})
            break
        except Exception:
            time.sleep(.2)
    else:
        raise AssertionError('Terminal service unavailable')
    terminal_id = 'c' * 32
    terminal({'type': 'start', 'id': terminal_id, 'cols': 80, 'rows': 24})
    terminal_cursor = 0
    terminal_sequence = 0
    def type_terminal(text):
        global terminal_sequence
        terminal({'type': 'input', 'id': terminal_id, 'sequence': terminal_sequence, 'bytes': list(text.encode())})
        terminal_sequence += 1
    def read_terminal(marker, seconds=10):
        global terminal_cursor
        deadline = time.monotonic() + seconds
        output = ''
        while time.monotonic() < deadline:
            session = terminal({'type': 'read', 'id': terminal_id, 'cursor': terminal_cursor})['session']
            terminal_cursor = session['cursor']
            output += bytes(session['bytes']).decode(errors='replace')
            if re.search(marker, output):
                return output
            time.sleep(.1)
        raise AssertionError('Terminal marker missing: ' + marker + ': ' + output)
    type_terminal("cd /tmp; export OXIDAL_SESSION_TEST=retained; id -un; grep NoNewPrivs /proc/$$/status; printf 'READY_%s\n' done\r")
    output = read_terminal('READY_done')
    assert 'oxidal-debug' in output and re.search(r'NoNewPrivs:\s+1', output), output
    terminal({'type':'resize','id':terminal_id,'cols':97,'rows':29})
    type_terminal("stty size; printf 'STATE_%s\n' \"$OXIDAL_SESSION_TEST\"\r")
    output = read_terminal('STATE_retained')
    assert '29 97' in output, output
    type_terminal("head -c 20000 /dev/zero | base64; sleep 31; printf '\nLONG_%s\n' done\r")
    output = read_terminal('LONG_done', 45)
    assert len(output) > 8192
    type_terminal('sleep 60\r')
    time.sleep(.2)
    type_terminal('\x03')
    type_terminal("setsid sh -c 'echo ESCAPED=$$; exec sleep 60' &\r")
    output = read_terminal(r'ESCAPED=\d+')
    match = re.search(r'ESCAPED=(\d+)', output)
    assert match, output
    escaped = int(match.group(1))
    os.kill(escaped, 0)
    terminal({'type': 'end', 'id': terminal_id})
    for attempt in range(100):
        if not os.path.exists('/proc/' + str(escaped)):
            break
        time.sleep(.1)
    else:
        raise AssertionError('Terminal descendant survived cgroup cleanup')
    # This credential is created only in the throwaway boot-test overlay and restored.
    # Never use or log the image's actual administrator password.
    import secrets
    original_hash = next(line.split(':')[1] for line in Path('/etc/shadow').read_text().splitlines() if line.startswith('oxidal-admin:'))
    test_password = secrets.token_hex(16)
    try:
        subprocess.run(['chpasswd'], input='oxidal-admin:' + test_password + '\n', text=True, check=True, capture_output=True)
        terminal_mode = 'admin'
        terminal_id = 'd' * 32
        terminal_cursor = 0
        terminal_sequence = 0
        terminal({'type': 'start', 'id': terminal_id, 'cols': 80, 'rows': 24})
        type_terminal("id -un; sudo -k; sudo -p 'ADMIN_PASSWORD: ' sh -c 'id -u; printf ROOT_%s done'\r")
        output = read_terminal('ADMIN_PASSWORD: $')
        assert 'oxidal-admin' in output
        type_terminal(test_password + '\r')
        output = read_terminal('ROOT_done')
        assert re.search(r'(^|[\r\n])0[\r\n]', output), 'sudo did not obtain root'
        assert test_password not in output, 'Password was echoed'
        type_terminal("sudo -k; printf 'ADMIN_%s\n' finished\r")
        read_terminal('ADMIN_finished')
        terminal({'type': 'end', 'id': terminal_id})
    finally:
        subprocess.run(['chpasswd', '-e'], input='oxidal-admin:' + original_hash + '\n', text=True, check=True, capture_output=True)
    monitor = get('/api/v1/monitor')
    assert monitor['audio'] is None, 'Stopped audio must not invent meter readings'
    # Exercise the installed unprivileged debug executor through the real daemon.
    def post(command):
        request = urllib.request.Request('http://127.0.0.1:3210/api/v1/debug', data=json.dumps(command).encode(), headers={'Content-Type':'application/json'}, method='POST')
        with urllib.request.urlopen(request, timeout=5) as reply:
            return json.loads(reply.read())
    for attempt in range(20):
        debug = get('/api/v1/debug')
        if debug['available']:
            break
        time.sleep(.2)
    assert debug['available'] and not debug['enabled'], debug
    assert 'oxidal-debug' in debug['identity']
    post({'type':'enable'})
    before = subprocess.check_output(['systemctl','show','-p','MainPID','--value','oxidal-debug'],text=True).strip()
    job = post({'type':'run','command':'id -u; printf debug-ok'})['job']
    for attempt in range(80):
        result = get('/api/v1/debug')['job']
        if result and result['id'] == job['id'] and result['phase'] != 'running':
            break
        time.sleep(.1)
    else:
        raise AssertionError('Debug command did not finish')
    assert result['exit_code'] == 0 and 'debug-ok' in result['output']
    assert int(result['output'].splitlines()[0]) == pwd.getpwnam('oxidal-debug').pw_uid != 0
    for attempt in range(80):
        after = subprocess.check_output(['systemctl','show','-p','MainPID','--value','oxidal-debug'],text=True).strip()
        if after != before and after != '0':
            break
        time.sleep(.1)
    else:
        raise AssertionError('Debug service did not recycle its cgroup')
    # MainPID becomes visible before the new process has bound its socket. Wait
    # for an actual empty-job response; do not replay a command after a conflict.
    import socket, struct
    for attempt in range(80):
        try:
            with socket.socket(socket.AF_UNIX) as connection:
                connection.settimeout(1)
                connection.connect('/run/oxidal-debug/control.sock')
                request = b'{"type":"status"}'
                connection.sendall(struct.pack('!I', len(request)) + request)
                def read_exact(length):
                    data = b''
                    while len(data) < length:
                        part = connection.recv(length - len(data))
                        if not part:
                            raise OSError('Executor is restarting')
                        data += part
                    return data
                length = struct.unpack('!I', read_exact(4))[0]
                assert 0 < length <= 65536
                reply = json.loads(read_exact(length))
                if reply['state'] and reply['state']['job'] is None:
                    break
        except OSError:
            pass
        time.sleep(.1)
    else:
        raise AssertionError('Restarted debug executor did not become ready')
    # A descendant that escapes the shell process group must still die with its service cgroup.
    job = post({'type':'run','command':"setsid sh -c 'echo $$; exec sleep 60' & wait"})['job']
    escaped = None
    for attempt in range(80):
        result = get('/api/v1/debug')['job']
        if result and result['id'] == job['id'] and result['output'].strip():
            escaped = int(result['output'].strip()); break
        time.sleep(.1)
    assert escaped, 'Missing escaped-child test PID'
    post({'type':'cancel','id':job['id']})
    for attempt in range(80):
        import os
        if not os.path.exists('/proc/' + str(escaped)):
            break
        time.sleep(.1)
    else:
        raise AssertionError('Cancelled debug descendant survived cgroup cleanup')
    post({'type':'disable'})
    assert not get('/api/v1/debug')['enabled']
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
    # Shutdown must travel through the real daemon/helper instead of the probe
    # directly powering off a successful VM. A stalled shutdown fails host timeout.
    request = urllib.request.Request('http://127.0.0.1:3210/api/v1/device/network', data=json.dumps({'type':'power','action':'shutdown'}).encode(), headers={'Content-Type':'application/json'}, method='POST')
    with urllib.request.urlopen(request, timeout=8) as reply:
        assert reply.status == 200
    qualified = True
    print('OXIDAL_BOOT_QUALIFIED', flush=True)
except Exception:
    import traceback
    traceback.print_exc()
    subprocess.run(['journalctl', '-b', '-u', 'oxidald', '-u', 'nginx', '-u', 'oxidal-debug', '-u', 'oxidal-device', '--no-pager', '-n', '60'])
    print('OXIDAL_BOOT_FAILED', flush=True)
finally:
    if not qualified:
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
            self.assertEqual(process.returncode, 0, 'Helper shutdown must end QEMU cleanly')
            (evidence / 'qemu-boot.json').write_text(json.dumps({'systemd_boot': 'passed', 'helper_shutdown': 'passed', 'hardware_qualified': False, 'image_modified': False, 'kernel': kernel.name}) + '\n')
