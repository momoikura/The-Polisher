// Generates the narration with Kokoro (local, Apache-2.0), one sentence at a time, so
// captions and visual beats sync to exact times. Writes public/audio/<scene>.wav and src/timing.json.
import fs from "node:fs";
import { KokoroTTS } from "kokoro-js";

const VOICE = process.argv[2] ?? "af_heart";
const GAP_S = 0.3;
const END_PAD_S = 0.55;
const spoken = (t) =>
  t
    .replaceAll("ThePolisher", "The Polisher")
    .replaceAll("CodePolish", "Code Polish")
    .replaceAll("SecurityPolish", "Security Polish")
    .replaceAll("DocPolish", "Doc Polish")
    .replaceAll("WritePolish", "Write Polish");

const scenes = JSON.parse(fs.readFileSync("src/script.json", "utf8"));
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });

function wav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const timing = {};
let total = 0;
for (const scene of scenes) {
  const chunks = [];
  const lines = [];
  let at = 0;
  let rate = 24000;
  for (const text of scene.lines) {
    const audio = await tts.generate(spoken(text), { voice: VOICE, speed: 1 });
    rate = audio.sampling_rate;
    const s = Array.from(audio.audio);
    lines.push({ text, start: at, end: at + s.length / rate });
    chunks.push(s, new Array(Math.round(GAP_S * rate)).fill(0));
    at += s.length / rate + GAP_S;
  }
  const seconds = at - GAP_S + END_PAD_S;
  const samples = chunks.flat();
  fs.writeFileSync(`public/audio/${scene.id}.wav`, wav(samples, rate));
  timing[scene.id] = { seconds, lines };
  total += seconds;
  console.log(scene.id, seconds.toFixed(1));
}
fs.writeFileSync("src/timing.json", JSON.stringify(timing, null, 1));
console.log("TOTAL", total.toFixed(1));
