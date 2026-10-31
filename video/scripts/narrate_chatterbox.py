"""Generates the narration with Chatterbox (MIT), which has an expressiveness control.

One sentence at a time, cached by text and settings, so changing a line only redoes that
line. Writes voice/<id>/<n>.wav under the cache folder, for assemble_voice.mjs.

Usage: python narrate_chatterbox.py <cache folder> [only this scene id]
"""

import hashlib
import json
import pathlib
import sys
import time

import numpy as np
import soundfile as sf
import torch
from chatterbox.tts import ChatterboxTTS

SCRIPT = pathlib.Path(__file__).resolve().parent.parent / "src" / "script.json"
SPOKEN = {
    "ThePolisher": "The Polisher",
    "CodePolish": "Code Polish",
    "SecurityPolish": "Security Polish",
    "DocPolish": "Doc Polish",
    "WritePolish": "Write Polish",
}
# Lower cfg_weight lets the delivery breathe; higher exaggeration adds emotion.
CFG_WEIGHT = 0.4
TEMPERATURE = 0.8


def spoken(text: str) -> str:
    for written, said in SPOKEN.items():
        text = text.replace(written, said)
    return text


def main() -> None:
    cache = pathlib.Path(sys.argv[1])
    only = sys.argv[2] if len(sys.argv) > 2 else None
    scenes = json.loads(SCRIPT.read_text(encoding="utf-8"))
    model = None
    for scene in scenes:
        if only and scene["id"] != only:
            continue
        folder = cache / scene["id"]
        folder.mkdir(parents=True, exist_ok=True)
        for n, line in enumerate(scene["lines"]):
            key = hashlib.sha1(f"{line}|{scene['mood']}|{CFG_WEIGHT}|{TEMPERATURE}".encode()).hexdigest()[:12]
            path = folder / f"{n}-{key}.wav"
            if path.exists():
                continue
            if model is None:
                model = ChatterboxTTS.from_pretrained(device="cpu")
            torch.manual_seed(int(key, 16) % 2**31)
            started = time.time()
            wav = model.generate(spoken(line), exaggeration=scene["mood"], cfg_weight=CFG_WEIGHT, temperature=TEMPERATURE)
            audio = wav.squeeze().cpu().numpy().astype(np.float32)
            sf.write(path, audio, model.sr)
            print(f"{scene['id']} {n}: {len(audio) / model.sr:.1f}s audio in {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    main()
