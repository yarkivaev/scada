import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('browser', Path(__file__).resolve().parents[2] / 'src/infrastructure/management/kiosk/kiosk-browser.py')
browser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(browser)


class BrowserTest(unittest.TestCase):
    def test_selects_declared_hmi_instead_of_first_page(self):
        other = {'type': 'page', 'url': 'http://other/', 'webSocketDebuggerUrl': 'ws://localhost:9222/other'}
        hmi = {'type': 'page', 'url': 'http://localhost:30080/#/hmi', 'webSocketDebuggerUrl': 'ws://localhost:9222/hmi'}
        self.assertIs(browser.target([other, hmi], 'http://localhost:30080/'), hmi)
        for tabs in [[other], [hmi, dict(hmi)]]:
            with self.assertRaisesRegex(RuntimeError, 'exactly one'):
                browser.target(tabs, 'http://localhost:30080/')

    def test_refuses_nonlocal_websocket_before_opening_socket(self):
        for address in ['ws://remote:9222/hmi', 'ws://localhost:1234/hmi', 'wss://localhost:9222/hmi']:
            with self.assertRaisesRegex(RuntimeError, 'loopback'):
                browser.reload_page(address, 9222)

    def test_partial_socket_reads_are_reassembled(self):
        class Socket:
            def __init__(self):
                self.parts = iter([b'a', b'bc', b''])
            def recv(self, _size):
                return next(self.parts)
        sock = Socket()
        self.assertEqual(browser.receive(sock, 3), b'abc')
        with self.assertRaisesRegex(RuntimeError, 'closed'):
            browser.receive(sock, 1)


if __name__ == '__main__':
    unittest.main()
