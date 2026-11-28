#!/usr/bin/env python3
"""set-kiosk-volume.sh must set and prove speaker volume."""

from __future__ import annotations

import os
import socket
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "src/infrastructure/management/kiosk/kiosk-volume.sh"


def write_cmd(path: Path, body: str) -> None:
    path.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def bind_socket(path: Path) -> socket.socket:
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(str(path))
    sock.listen(1)
    return sock


def run_script(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged.update({"KIOSK_AUDIO_ACTION": "apply"})
    merged.update(env)
    return subprocess.run(
        ["bash", str(SCRIPT)],
        capture_output=True,
        text=True,
        env=merged,
        check=False,
    )


class SetKioskVolumeTest(unittest.TestCase):
    def test_rejects_non_integer_percent(self):
        result = run_script({"VOLUME_PERCENT": "π-87"})
        self.assertEqual(
            result.returncode,
            2,
            "non-integer VOLUME_PERCENT was accepted",
        )

    def test_rejects_percent_above_one_hundred(self):
        result = run_script({"VOLUME_PERCENT": "140"})
        self.assertEqual(
            result.returncode,
            2,
            "VOLUME_PERCENT above 100 was accepted",
        )

    def test_fails_when_alsa_playback_is_below_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            amixer = Path(tmp) / "amixer"
            write_cmd(
                amixer,
                "echo '  Front Left: Playback 32768 [50%] [on]'\n",
            )
            result = run_script(
                {
                    "VOLUME_PERCENT": "87",
                    "AMIXER_CMD": str(amixer),
                    "PULSE_SOCKET": str(Path(tmp) / "missing"),
                }
            )
            self.assertEqual(
                result.returncode,
                1,
                "ALSA Master below target was treated as set",
            )

    def test_fails_when_alsa_playback_is_muted(self):
        with tempfile.TemporaryDirectory() as tmp:
            amixer = Path(tmp) / "amixer"
            write_cmd(
                amixer,
                "echo '  Front Left: Playback 65536 [87%] [off]'\n",
            )
            result = run_script(
                {
                    "VOLUME_PERCENT": "87",
                    "AMIXER_CMD": str(amixer),
                    "PULSE_SOCKET": str(Path(tmp) / "missing"),
                }
            )
            self.assertEqual(
                result.returncode,
                1,
                "muted ALSA Master was treated as unmuted",
            )

    def test_fails_when_pulse_socket_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            amixer = Path(tmp) / "amixer"
            ident = Path(tmp) / "id"
            write_cmd(
                amixer,
                "echo '  Front Left: Playback 65536 [87%] [on]'\n",
            )
            write_cmd(ident, "echo 1001\n")
            result = run_script(
                {
                    "VOLUME_PERCENT": "87",
                    "AMIXER_CMD": str(amixer),
                    "ID_CMD": str(ident),
                    "KIOSK_USER": "kiosk-α",
                    "PULSE_SOCKET": str(Path(tmp) / "pulse.sock"),
                }
            )
            self.assertEqual(
                result.returncode,
                1,
                "missing Pulse socket was treated as ready",
            )

    def test_fails_when_pipewire_volume_is_below_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            amixer = Path(tmp) / "amixer"
            wpctl = Path(tmp) / "wpctl"
            ident = Path(tmp) / "id"
            pulse = Path(tmp) / "pulse.sock"
            sock = bind_socket(pulse)
            write_cmd(
                amixer,
                "echo '  Mono: Playback 76 [87%] [-2.25dB] [on]'\n",
            )
            write_cmd(wpctl, "echo 'Volume: 0.40'\n")
            write_cmd(ident, "echo 1001\n")
            result = run_script(
                {
                    "VOLUME_PERCENT": "87",
                    "AMIXER_CMD": str(amixer),
                    "WPCTL_CMD": str(wpctl),
                    "ID_CMD": str(ident),
                    "KIOSK_USER": "kiosk-α",
                    "PULSE_SOCKET": str(pulse),
                }
            )
            sock.close()
            self.assertEqual(
                result.returncode,
                1,
                "PipeWire sink below target was treated as set",
            )

    def test_succeeds_when_alsa_and_pipewire_match_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            amixer = Path(tmp) / "amixer"
            wpctl = Path(tmp) / "wpctl"
            ident = Path(tmp) / "id"
            pulse = Path(tmp) / "pulse.sock"
            sock = bind_socket(pulse)
            write_cmd(
                amixer,
                "if [ \"$1\" = -q ]; then exit 0; fi\n"
                "echo '  Mono: Playback 76 [87%] [-2.25dB] [on]'\n",
            )
            write_cmd(wpctl, "echo 'Volume: 0.87'\n")
            write_cmd(ident, "echo 1001\n")
            result = run_script(
                {
                    "VOLUME_PERCENT": "87",
                    "AMIXER_CMD": str(amixer),
                    "WPCTL_CMD": str(wpctl),
                    "ID_CMD": str(ident),
                    "KIOSK_USER": "kiosk-α",
                    "PULSE_SOCKET": str(pulse),
                }
            )
            sock.close()
            self.assertEqual(
                result.returncode,
                0,
                "matching ALSA and PipeWire volume was not accepted",
            )



if __name__ == "__main__":
    unittest.main()
