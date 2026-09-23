"""
voiceover.py: British English narration for the storage-minimised hydrogen twin video.
Offline neural text-to-speech (Kokoro, voice bm_george). Each line is placed at the start of its
scene window; windows stretch when a line runs longer, and the time map lets the renderer follow.
Usage: python voiceover.py <kokoro_model_dir>
"""
import json, sys
from pathlib import Path
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODEL = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT = Path(__file__).resolve().parent
VOICE, LANG, SR, SPEED, PAD, DUR = "bm_george", "en-gb", 24000, 1.08, 0.35, 108.4
LINES = json.loads((OUT / "lines.json").read_text())
k = Kokoro(str(MODEL / "kokoro-v1.0.onnx"), str(MODEL / "voices-v1.0.bin"))

def speak(text):
    audio, sr = k.create(text, voice=VOICE, speed=SPEED, lang=LANG)
    assert sr == SR
    return audio

clips = [speak(t) for _, _, t in LINES]
tmap, T, prev = [(0.0, 0.0)], 0.0, 0.0
report = []
for (a, b, text), clip in zip(LINES, clips):
    T += a - prev; tmap.append((round(T, 3), a))
    seg = max(b - a, len(clip) / SR + PAD)
    report.append({"video_start": round(T, 2), "voice_s": round(len(clip) / SR, 2), "window_s": b - a, "text": text})
    T += seg; tmap.append((round(T, 3), b)); prev = b
T += DUR - prev; tmap.append((round(T, 3), DUR))
track = np.zeros(int(T * SR) + SR, dtype=np.float32)
for r, c in zip(report, clips):
    i0 = int(r["video_start"] * SR); track[i0:i0 + len(c)] += c
track = track[: int(T * SR)]; track = track / float(np.abs(track).max()) * 0.89
sf.write(OUT / "voiceover.wav", track, SR)
(OUT / "timemap.json").write_text(json.dumps({"total": round(T, 3), "points": tmap}))
(OUT / "voiceover_timing.json").write_text(json.dumps(report, indent=1))
print("total", round(T, 1), "s")
for r in report: print(f"{r['video_start']:5.1f}  voice {r['voice_s']:5.1f}  window {r['window_s']:5.1f}  {r['text'][:50]}")
