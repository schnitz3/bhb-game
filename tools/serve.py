"""Local dev server for Balance Big Head Bob.

`python3 -m http.server` sends no cache headers at all, so browsers fall back to
heuristic caching and happily reuse an old copy of the game without ever asking
the server whether it changed. That makes edits look like they did nothing.

This serves the same files with caching switched off, so a refresh always gets
what is actually on disk.

    python3 tools/serve.py [port]

Only for development. GitHub Pages sets sane cache headers of its own, and the
service worker handles offline play in production.
"""
import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # keep the console readable: only report anything that is not a 200
        status = args[1] if len(args) > 1 else ""
        if not str(status).startswith("2"):
            super().log_message(fmt, *args)


class Server(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8815
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with Server(("", port), handler) as httpd:
        print("Balance Big Head Bob, no-cache dev server")
        print("  serving %s" % ROOT)
        print("  http://localhost:%d" % port)
        print("  ctrl-c to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
