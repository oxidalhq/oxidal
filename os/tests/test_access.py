"""Exercise the actual TLS/auth/origin proxy configuration, not a reimplementation."""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('provision', Path(__file__).parents[1] / 'scripts/provision.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


@unittest.skipUnless(shutil.which('nginx') and shutil.which('openssl'), 'Linux OS qualification installs nginx and openssl')
class AccessTests(unittest.TestCase):
    def test_tls_password_origin_host_and_forwarding(self):
        class Backend(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(dict(self.headers)).encode())
            do_POST = do_GET
            def log_message(self, *_):
                pass
        with tempfile.TemporaryDirectory(prefix='oxidal-access-') as temporary:
            root = Path(temporary)
            access = root / 'access'
            provision.create_access(access)
            subprocess.run(['openssl', 'verify', '-x509_strict', '-CAfile', str(access / 'ca.crt'), str(access / 'server.crt')], check=True, stdout=subprocess.DEVNULL)
            self.assertEqual(access.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(ValueError):
                provision.create_access(access)
            password = (access / 'access.txt').read_text().split('Password: ')[1].splitlines()[0]
            backend = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
            thread = threading.Thread(target=backend.serve_forever, daemon=True)
            thread.start()
            self.addCleanup(backend.server_close)
            self.addCleanup(backend.shutdown)
            with socket.socket() as port:
                port.bind(('127.0.0.1', 0))
                proxy_port = port.getsockname()[1]
            conf = (provision.HERE / 'config/oxidal-nginx.conf').read_text()
            conf = conf.replace('listen 443 ssl', f'listen {proxy_port} ssl').replace('listen [::]:443 ssl default_server;', '')
            conf = conf.replace('/etc/oxidal/tls/', str(access) + '/').replace('/etc/oxidal/access.htpasswd', str(access / 'access.htpasswd'))
            conf = conf.replace('127.0.0.1:3210', f'127.0.0.1:{backend.server_port}')
            # The local fixture uses port 443's exact allowlist with a TLS connection to loopback.
            config = root / 'nginx.conf'
            import os
            user = 'user root;\n' if os.geteuid() == 0 else ''
            config.write_text(user + f'pid {root}/nginx.pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{\nclient_body_temp_path {root}/body;\nproxy_temp_path {root}/proxy;\nfastcgi_temp_path {root}/fastcgi;\nuwsgi_temp_path {root}/uwsgi;\nscgi_temp_path {root}/scgi;\n' + conf + '\n}\n')
            process = subprocess.Popen(['nginx', '-c', str(config), '-p', str(root), '-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        self.fail(process.stderr.read().decode())
                    try:
                        with socket.create_connection(('127.0.0.1', proxy_port), timeout=.1):
                            break
                    except OSError:
                        time.sleep(.05)
                # CA verification remains enabled. Resolve the SAN name to localhost for this fixture only.
                context = ssl.create_default_context(cafile=str(access / 'ca.crt'))
                def request(host='oxidal.local', origin=None, auth=True, password_value=password):
                    import http.client
                    conn = http.client.HTTPSConnection('127.0.0.1', proxy_port, context=context)
                    raw = socket.create_connection(('127.0.0.1', proxy_port), timeout=5)
                    conn.sock = context.wrap_socket(raw, server_hostname='oxidal.local')
                    headers = {'Host': host, 'Cookie': 'never-forward-me=1'}
                    if origin is not None:
                        headers['Origin'] = origin
                    if auth:
                        headers['Authorization'] = 'Basic ' + base64.b64encode(('oxidal:' + password_value).encode()).decode()
                    conn.request('POST', '/api/v1/commands', '{}', headers)
                    reply = conn.getresponse()
                    result = reply.status, reply.read()
                    conn.close()
                    return result
                self.assertEqual(request(auth=False)[0], 401)
                self.assertEqual(request(password_value='wrong')[0], 401)
                self.assertEqual(request(origin='https://evil.example')[0], 403)
                self.assertEqual(request(host='evil.example')[0], 403)
                self.assertEqual(request(origin='http://oxidal.local')[0], 403)
                status, body = request(origin='https://oxidal.local')
                self.assertEqual(status, 200)
                headers = json.loads(body)
                self.assertEqual(headers['Host'], f'127.0.0.1:{backend.server_port}')
                self.assertEqual(headers['Origin'], f'http://127.0.0.1:{backend.server_port}')
                self.assertNotIn('Authorization', headers)
                self.assertNotIn('Cookie', headers)
                self.assertEqual(request(host='10.42.0.1', origin='https://10.42.0.1')[0], 200)
            finally:
                process.terminate()
                process.communicate(timeout=10)


    def test_hotspot_welcome_probes_and_isolation(self):
        """Actual nginx, fixed discovery targets, no HTTP app/credential forwarding."""
        import http.client
        import os
        with tempfile.TemporaryDirectory(prefix='oxidal-portal-') as temporary:
            root = Path(temporary)
            html = provision.HERE / 'config/oxidal-welcome.html'
            logo = provision.HERE.parent / 'apps/web/public/brand/wordmark.svg'
            with socket.socket() as port:
                port.bind(('127.0.0.1', 0))
                proxy_port = port.getsockname()[1]
            conf = (provision.HERE / 'config/oxidal-portal.conf').read_text()
            # Substitute only the fixture listener, client subnet, local address
            # and static paths. Production guards remain exercised through HTTP.
            conf = conf.replace('listen 80;', f'listen {proxy_port};')
            conf = conf.replace('10.42.0.0/24 1;', '127.0.0.1/32 1;')
            conf = conf.replace('10.42.0.1 1;', '127.0.0.1 1;')
            conf = conf.replace('/usr/share/oxidal/portal/index.html', str(html))
            conf = conf.replace('/opt/oxidal/ui/brand/wordmark.svg', str(logo))
            config = root / 'nginx.conf'
            user = 'user root;\n' if os.geteuid() == 0 else ''
            config.write_text(user + f'pid {root}/nginx.pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{\n' + conf + '\n}\n')
            process = subprocess.Popen(['nginx', '-c', str(config), '-p', str(root), '-g', 'daemon off;'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            def request(path, host='10.42.0.1', method='GET', source=None):
                conn = http.client.HTTPConnection('127.0.0.1', proxy_port, timeout=3, source_address=source)
                conn.request(method, path, headers={'Host': host, 'X-Forwarded-For': '10.42.0.20'})
                reply = conn.getresponse()
                status, headers, body = reply.status, dict(reply.getheaders()), reply.read()
                conn.close()
                return status, headers, body
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        self.fail(process.stderr.read().decode())
                    try:
                        with socket.create_connection(('127.0.0.1', proxy_port), timeout=.1):
                            break
                    except OSError:
                        time.sleep(.05)
                for host, path in [('captive.apple.com', '/hotspot-detect.html'), ('connectivitycheck.gstatic.com', '/generate_204'), ('clients3.google.com', '/generate_204'), ('connectivitycheck.android.com', '/generate_204'), ('oxidal.local', '/')]:
                    status, headers, body = request(path + '?next=https://evil.example', host)
                    self.assertEqual(status, 302)
                    self.assertEqual(headers['Location'], 'http://10.42.0.1/welcome')
                    self.assertEqual(headers['Cache-Control'], 'no-store')
                status, headers, body = request('/welcome')
                self.assertEqual(status, 200)
                self.assertIn(b'Open Oxidal', body)
                self.assertIn(b'href="https://10.42.0.1/"', body)
                self.assertIn(b'href="https://oxidal.local/"', body)
                self.assertNotIn(b'<form', body)
                self.assertNotIn(b'<script', body)
                self.assertIn("form-action 'none'", headers['Content-Security-Policy'])
                self.assertEqual(request('/wordmark.svg')[2], logo.read_bytes())
                self.assertEqual(request('/welcome', method='HEAD')[2], b'')
                self.assertEqual(request('/api/v1/commands', method='POST')[0], 405)
                self.assertEqual(request('/api/v1/state')[1]['Location'], 'http://10.42.0.1/welcome')
                self.assertEqual(request('/welcome', source=('127.0.0.2', 0))[0], 404, 'Non-hotspot clients cannot use forwarded headers to enter')
                # Simulate the same client reaching a non-hotspot listener.
                config.write_text(config.read_text().replace('127.0.0.1 1;', '127.0.0.3 1;'))
                subprocess.run(['nginx', '-c', str(config), '-p', str(root), '-s', 'reload'], check=True, stderr=subprocess.DEVNULL)
                for _ in range(100):
                    if request('/welcome')[0] == 404:
                        break
                    time.sleep(.02)
                else:
                    self.fail('Portal exposed on a non-hotspot destination')
            finally:
                process.terminate()
                process.communicate(timeout=10)

    @unittest.skipUnless(shutil.which('dnsmasq'), 'Linux OS qualification installs dnsmasq')
    def test_hotspot_dns_discovery_and_unmodified_provider_forwarding(self):
        """Use real dnsmasq and a local fake upstream; never contact public DNS."""
        import os
        import pwd
        import socketserver
        import struct
        forwarded = []
        class Upstream(socketserver.BaseRequestHandler):
            def handle(self):
                packet, sock = self.request
                forwarded.append(packet)
                reply = packet[:2] + struct.pack('!5H', 0x8180, 1, 1, 0, 0) + packet[12:]
                reply += b'\xc0\x0c' + struct.pack('!HHIH', 1, 1, 0, 4) + socket.inet_aton('192.0.2.44')
                sock.sendto(reply, self.client_address)
        upstream = socketserver.UDPServer(('127.0.0.1', 0), Upstream)
        thread = threading.Thread(target=upstream.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(upstream.server_close)
        self.addCleanup(upstream.shutdown)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as free:
            free.bind(('127.0.0.1', 0))
            port = free.getsockname()[1]
        conf = provision.HERE / 'config/oxidal-portal-dns.conf'
        subprocess.run(['dnsmasq', '--test', '--conf-file=' + str(conf)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        process = subprocess.Popen(['dnsmasq', '--keep-in-foreground', '--conf-file=' + str(conf), '--port=' + str(port), '--listen-address=127.0.0.1', '--bind-interfaces', '--no-hosts', '--no-resolv', '--pid-file=', '--user=' + pwd.getpwuid(os.geteuid()).pw_name, '--server=127.0.0.1#' + str(upstream.server_address[1])], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        def query(name, kind=1):
            packet = struct.pack('!6H', 123, 0x0100, 1, 0, 0, 0)
            packet += b''.join(bytes([len(label)]) + label.encode() for label in name.split('.')) + b'\0' + struct.pack('!HH', kind, 1)
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.settimeout(.2)
                client.sendto(packet, ('127.0.0.1', port))
                return client.recv(4096)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    self.fail(process.stderr.read().decode())
                try:
                    query('oxidal.local')
                    break
                except TimeoutError:
                    time.sleep(.02)
            else:
                self.fail('Discovery DNS did not start')
            names = [line.split('=')[1].split(',')[0] for line in conf.read_text().splitlines() if line.startswith('host-record=')]
            for name in names:
                self.assertIn(socket.inet_aton('10.42.0.1'), query(name))
                self.assertEqual(struct.unpack('!H', query(name, 28)[6:8])[0], 0)
            self.assertEqual(forwarded, [], 'Discovery must work without upstream DNS')
            for name in ['www.tone3000.com', 'api.tone3000.com', 'accounts.example.test']:
                self.assertIn(socket.inet_aton('192.0.2.44'), query(name))
            self.assertEqual(len(forwarded), 3, 'Non-discovery names must keep normal upstream routing')
        finally:
            process.terminate()
            process.communicate(timeout=10)
