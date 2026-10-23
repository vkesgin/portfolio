"""Local forward proxy: resolve and pin public IPs on every new connection.

Both yt-dlp and Chromium use this proxy. Redirects cannot escape into private
networks, even when a public hostname changes DNS answers between requests.
"""
import ipaddress
import select
import socket
import socketserver
from urllib.parse import urlsplit


def public_addresses(host, port):
    if not host or host.lower().rstrip('.') in ('localhost', 'metadata.google.internal'):
        raise ValueError('Özel ağ adresleri desteklenmiyor.')
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(x[4][0]).is_global for x in addresses):
        raise ValueError('Özel ağ adresleri desteklenmiyor.')
    return addresses


def connect_public(host, port):
    if port not in (80, 443):
        raise ValueError('Yalnızca standart web bağlantıları destekleniyor.')
    addresses = public_addresses(host, port)
    for family, kind, proto, _, address in addresses:
        stream = socket.socket(family, kind, proto)
        stream.settimeout(15)
        try:
            stream.connect(address)
            return stream
        except OSError:
            stream.close()
    raise OSError('Kaynağa bağlanılamadı.')


class Proxy(socketserver.StreamRequestHandler):
    rbufsize = 0
    def handle(self):
        remote = None
        try:
            self.connection.settimeout(15)
            first = self.rfile.readline(8193)
            if len(first) > 8192:
                return
            method, target, protocol = first.decode('latin1').strip().split(' ', 2)
            lines = []
            total = 0
            while True:
                line = self.rfile.readline(8193)
                total += len(line)
                if total > 65536 or not line:
                    return
                if line == b'\r\n':
                    break
                lines.append(line)
            if method == 'CONNECT':
                parsed = urlsplit('https://' + target)
                remote = connect_public(parsed.hostname, parsed.port or 443)
                self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
                self.wfile.flush()
            else:
                parsed = urlsplit(target)
                if parsed.scheme != 'http' or parsed.username or parsed.password:
                    raise ValueError('Desteklenmeyen bağlantı.')
                remote = connect_public(parsed.hostname, parsed.port or 80)
                path = parsed.path or '/'
                if parsed.query:
                    path += '?' + parsed.query
                headers = [x for x in lines if not x.lower().startswith((b'proxy-', b'connection:', b'host:'))]
                host = parsed.hostname.encode('idna')
                remote.sendall(method.encode() + b' ' + path.encode('latin1') + b' HTTP/1.1\r\n' + b''.join(headers) + b'Host: ' + host + b'\r\nConnection: close\r\n\r\n')
            # No request URLs, addresses, headers, or bodies are logged.
            while True:
                readable, _, _ = select.select([self.connection, remote], [], [], 60)
                if not readable:
                    break
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (remote if source is self.connection else self.connection).sendall(data)
        except Exception:
            try:
                self.wfile.write(b'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
            except Exception:
                pass
        finally:
            if remote:
                remote.close()


class ProxyServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True
