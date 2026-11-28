"""Operate only the declared kiosk HMI page over loopback CDP; no external packages."""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import time
import urllib.request
from urllib.parse import urlparse


def target(tabs, expected):
    matches = [tab for tab in tabs if tab.get('type') == 'page'
               and tab.get('url', '').split('#')[0] == expected
               and tab.get('webSocketDebuggerUrl')]
    if len(matches) != 1:
        raise RuntimeError('Expected exactly one declared HMI page')
    return matches[0]


def receive(sock, size):
    data = b''
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise RuntimeError('CDP connection closed')
        data += chunk
    return data


def reload_page(ws_url, port):
    parsed = urlparse(ws_url)
    if parsed.scheme != 'ws' or parsed.hostname not in ['127.0.0.1', 'localhost'] or parsed.port != port:
        raise RuntimeError('CDP websocket must remain on declared loopback port')
    with socket.create_connection(('127.0.0.1', port), timeout=5) as sock:
        key = base64.b64encode(os.urandom(16)).decode()
        request = (f'GET {parsed.path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n'
                   f'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n'
                   'Sec-WebSocket-Version: 13\r\n\r\n')
        sock.sendall(request.encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += receive(sock, 1)
            if len(header) > 16384:
                raise RuntimeError('CDP handshake too large')
        accept = base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if b' 101 ' not in header.split(b'\r\n')[0] or accept not in header:
            raise RuntimeError('CDP handshake rejected')
        payload = json.dumps({'id': 1, 'method': 'Page.reload', 'params': {'ignoreCache': True}}).encode()
        mask = os.urandom(4)
        sock.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            frame = receive(sock, 2)
            length = frame[1] & 127
            if length == 126:
                length = struct.unpack('!H', receive(sock, 2))[0]
            elif length == 127:
                length = struct.unpack('!Q', receive(sock, 8))[0]
            if length > 1048576 or frame[1] & 128:
                raise RuntimeError('Invalid CDP frame')
            data = receive(sock, length)
            opcode = frame[0] & 15
            if opcode == 8:
                raise RuntimeError('CDP closed before reload confirmation')
            if opcode != 1:
                continue
            reply = json.loads(data)
            if reply.get('id') == 1:
                if 'error' in reply:
                    raise RuntimeError('CDP rejected Page.reload')
                return
        raise RuntimeError('CDP reload reply timed out')


def main(action, port, expected):
    if action not in ['check', 'reload']:
        raise ValueError('Unknown browser action')
    # Ignore proxy environment: browser control never leaves loopback.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f'http://127.0.0.1:{port}/json/list', timeout=5) as response:
        page = target(json.load(response), expected)
    if action == 'reload':
        reload_page(page['webSocketDebuggerUrl'], port)
    print(f'Kiosk browser {action} verified')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3])
