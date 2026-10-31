"""Transcribes each narration line and compares it with the script, to catch garbled speech.
Also prints where words land in the lines that visuals sync to.

Usage: python check_voice.py <cache folder>
"""

import difflib
import json
import pathlib
import re
import sys

from faster_whisper import WhisperModel

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "src" / "script.json"
SPOKEN = {"ThePolisher": "The Polisher", "CodePolish": "Code Polish", "SecurityPolish": "Security Polish", "DocPolish": "Doc Polish", "WritePolish": "Write Polish"}
WATCH = {("proof", 2): "passes", ("proof", 3): "proof", ("safety", 4): "click"}


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower().replace("’", "'"))


def main() -> None:
    cache = pathlib.Path(sys.argv[1])
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    scenes = json.loads(SCRIPT.read_text(encoding="utf-8"))
    total = 0.0
    weak = []
    for scene in scenes:
        for n, line in enumerate(scene["lines"]):
            files = sorted((cache / scene["id"]).glob(f"{n}-*.wav"), key=lambda p: p.stat().st_mtime)
            segments, info = model.transcribe(str(files[-1]), word_timestamps=True, beam_size=5, language="en")
            segments = list(segments)
            heard = " ".join(s.text.strip() for s in segments)
            expected = line
            for written, said in SPOKEN.items():
                expected = expected.replace(written, said)
            ratio = difflib.SequenceMatcher(None, words(expected), words(heard)).ratio()
            total += info.duration
            if ratio < 0.9:
                weak.append((scene["id"], n, round(ratio, 2), heard))
            mark = WATCH.get((scene["id"], n))
            if mark:
                for s in segments:
                    for w in s.words:
                        if mark in w.word.lower():
                            print(f"beat {scene['id']} {n} '{mark}' at {w.start:.2f}s")
    print(f"total speech {total:.1f}s; {len(weak)} lines below 0.9 match")
    for w in weak:
        print("WEAK", w)


if __name__ == "__main__":
    main()
