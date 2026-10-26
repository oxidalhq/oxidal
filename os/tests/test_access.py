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
