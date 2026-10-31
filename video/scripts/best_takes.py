"""Checks every narration line by transcribing it, and re-records the weak ones until a take
comes back right. The best take of each line is left as its newest file, which
assemble_voice.mjs uses. Prints where the words that visuals sync to land.

Usage: python best_takes.py <cache folder> [takes per line]
"""

import difflib
import json
import os
import pathlib
import re
import sys

import numpy as np
import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS
from faster_whisper import WhisperModel

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "src" / "script.json"
SAY = {
    "ThePolisher": "The Polisher",
    "CodePolish": "Code Polish",
    "SecurityPolish": "Security Polish",
    "DocPolish": "Doc Polish",
    "WritePolish": "Write Polish",
    "Muse Spark": "Mewz Spark",
    "AI ": "A.I. ",
}
# What a correct transcript looks like: digits for numbers, the product's name as one word.
NUMBERS = [("fifty seven thousand", "57000"), ("sixty six", "66"), ("seventeen", "17"), ("fourteen", "14"), ("seven", "7"), ("nine", "9"), ("three", "3"), ("two", "2"), ("four", "4")]
GOOD = 0.97
WATCH = {("proof", 2): "passes", ("proof", 3): "proof", ("safety", 4): "click"}


def normal(text: str) -> list[str]:
    t = text.lower().replace("’", "'").replace(",", "").replace("a.i.", "ai").replace("-", " ")
    for word, digit in NUMBERS:
        t = t.replace(word, digit)
    t = re.sub(r"\b(the polisher|thepolisher)\b", "thepolisher", t)
    t = re.sub(r"\b(code|security|doc|write) polish\b", r"\1polish", t)
    return re.findall(r"[a-z0-9']+", t)


def main() -> None:
    cache = pathlib.Path(sys.argv[1])
    takes = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    judge = WhisperModel("small.en", device="cpu", compute_type="int8")
    voice = None
    scenes = json.loads(SCRIPT.read_text(encoding="utf-8"))

    def score(path: pathlib.Path, line: str):
        segments, _ = judge.transcribe(str(path), word_timestamps=True, beam_size=5, language="en")
        segments = list(segments)
        heard = " ".join(s.text.strip() for s in segments)
        return difflib.SequenceMatcher(None, normal(line), normal(heard)).ratio(), heard, segments

    for scene in scenes:
        folder = cache / scene["id"]
        for n, line in enumerate(scene["lines"]):
            existing = sorted(folder.glob(f"{n}-*.wav"), key=lambda p: p.stat().st_mtime)
            best = max(((score(p, line), p) for p in existing), key=lambda x: x[0][0])
            for take in range(takes):
                if best[0][0] >= GOOD:
                    break
                if voice is None:
                    voice = ChatterboxTTS.from_pretrained(device="cpu")
                said = line
                for written, spoken in SAY.items():
                    said = said.replace(written, spoken)
                torch.manual_seed(1000 + take * 97 + n + hash(scene["id"]) % 1000)
                wav = voice.generate(said, exaggeration=scene["mood"], cfg_weight=0.5, temperature=0.65)
                path = folder / f"{n}-take{take}.wav"
                sf.write(path, wav.squeeze().cpu().numpy().astype(np.float32), voice.sr)
                result = score(path, line)
                if result[0] > best[0][0]:
                    best = (result, path)
            os.utime(best[1])  # newest file wins in assemble_voice.mjs
            ratio, heard, segments = best[0]
            print(f"{scene['id']} {n}: {ratio:.2f} {best[1].name} | {heard}", flush=True)
            mark = WATCH.get((scene["id"], n))
            if mark:
                for s in segments:
                    for w in s.words:
                        if mark in w.word.lower():
                            print(f"BEAT {scene['id']} {n} {mark} {w.start:.2f}", flush=True)


if __name__ == "__main__":
    main()
