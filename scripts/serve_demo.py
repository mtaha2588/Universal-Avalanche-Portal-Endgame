"""
serve_demo.py - preview the static interview demo (demo/) exactly as GitHub Pages serves it
==========================================================================================
Python's built-in http.server ignores HTTP Range requests, and browsers need them to seek in a video (chapter jumps).
This adds Range support and nothing else. Standard library only:

    python scripts/serve_demo.py            http://127.0.0.1:8080/
    python scripts/serve_demo.py 9000
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEMO = Path(__file__).resolve().parents[1] / "demo"


class RangeHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mp4": "video/mp4", ".webp": "image/webp", ".js": "text/javascript"}

    def send_head(self):
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        a, b = m.groups()
        start, end = (int(a), int(b) if b else size - 1) if a else (size - int(b), size - 1)
        if start >= size:
            self.send_error(416)
            return None
        end = min(end, size - 1)
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(65536, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)

    def end_headers(self):
        if not self.headers.get("Range"):
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    srv = ThreadingHTTPServer(("127.0.0.1", port), partial(RangeHandler, directory=str(DEMO)))
    print(f"demo at http://127.0.0.1:{port}/   (Ctrl+C stops)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
