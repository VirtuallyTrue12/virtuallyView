"""A tiny HTTP front for KittenTTS, used by virtuallyView for DJ mode and radio announcements.

GET /voices        -> {"model": ..., "voices": [...]}
GET /tts?text=&voice=&speed=  -> audio/wav (16-bit mono)
GET /health        -> 200 once the model is loaded
"""
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import soundfile as sf
from kittentts import KittenTTS

MODEL = os.environ.get("KITTEN_MODEL", "KittenML/kitten-tts-mini-0.8")
VOICES = ["Jasper", "Bruno", "Hugo", "Leo", "Bella", "Luna", "Rosie", "Kiki"]
RATE = 24000

model = None
lock = threading.Lock()


def load():
    global model
    model = KittenTTS(MODEL)
    # Warm up so the first real line is quick.
    model.generate("Ready.", voice=VOICES[0])
    print(f"kitten: {MODEL} ready", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path == "/health":
            return self._send(200 if model else 503, b'{"ok":%s}' % (b"true" if model else b"false"))
        if url.path == "/voices":
            return self._send(200, json.dumps({"model": MODEL, "ready": model is not None, "voices": VOICES}).encode())
        if url.path == "/tts":
            if model is None:
                return self._send(503, b'{"message":"The voice model is still loading."}')
            text = (q.get("text", [""])[0]).strip()[:400]
            voice = q.get("voice", [VOICES[0]])[0]
            if voice not in VOICES:
                voice = VOICES[0]
            try:
                speed = min(1.5, max(0.7, float(q.get("speed", ["1.0"])[0])))
            except ValueError:
                speed = 1.0
            if not text:
                return self._send(400, b'{"message":"Nothing to say."}')
            with lock:
                audio = model.generate(text, voice=voice, speed=speed)
            # A short breath at each end so the line never starts or stops abruptly.
            pad = np.zeros(int(RATE * 0.08), dtype=np.float32)
            buf = io.BytesIO()
            sf.write(buf, np.concatenate([pad, np.asarray(audio, dtype=np.float32), pad]), RATE, format="WAV", subtype="PCM_16")
            return self._send(200, buf.getvalue(), "audio/wav")
        self._send(404, b"{}")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    threading.Thread(target=load, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8020), Handler).serve_forever()
