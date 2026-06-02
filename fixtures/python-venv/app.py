"""Minimal stdlib HTTP server used as a DevStack test fixture.

Prints a localhost URL on startup (exercises DevStack's port detection) and
serves a trivial response. No third-party dependencies — runs on the venv's
interpreter alone.
"""

import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8000


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib-mandated name)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"devstack python-venv fixture is alive\n")

    def log_message(self, *args):
        # Silence default per-request logging to keep the terminal readable.
        pass


def main():
    # Report the active interpreter so a test run shows whether the venv is in
    # effect (path should contain ".venv/bin/python").
    print(f"interpreter: {sys.executable}", flush=True)
    print(f"Serving on http://localhost:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
