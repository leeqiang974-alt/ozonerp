import http.server
import os
import socketserver
from pathlib import Path


# Resolve the static root relative to this file so a cloned checkout can run
# from any drive or directory. Loopback is the safe default; the notebook
# launcher explicitly opts into a LAN bind for the connection test.
os.chdir(Path(__file__).resolve().parent)
bind_host = os.getenv("OZON_FRONTEND_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
bind_port = int(os.getenv("OZON_FRONTEND_PORT", "5500"))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


class ReusableThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


httpd = ReusableThreadingTCPServer((bind_host, bind_port), NoCacheHandler)
print(f"Serving on {bind_host}:{bind_port} (threaded)")
httpd.serve_forever()
