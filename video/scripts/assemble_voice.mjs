// Turns the per-sentence narration into one track per scene and src/timing.json, which
// every scene and the music sync to.
// Usage: node scripts/assemble_voice.mjs <cache folder>
import fs from "node:fs";
import path from "node:path";

const cache = process.argv[2];
const LEAD_S = 0.55; // the voice starts after the transition into the scene
const END_S = 0.4;
const GRID_FRAMES = 15; // scenes last whole beats at 120 BPM and 30 fps
const TRANSITION_FRAMES = 15;
const TARGET_RMS = 0.085;
const PEAK = 0.8;

function readWav(file) {
  const b = fs.readFileSync(file);
  let at = 12;
  let rate = 24000;
  let format = 1;
  let bits = 16;
  while (at < b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") {
      format = b.readUInt16LE(at + 8);
      rate = b.readUInt32LE(at + 12);
      bits = b.readUInt16LE(at + 22);
    }
    if (id === "data") {
      const n = size / (bits / 8);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = format === 3 ? b.readFloatLE(at + 8 + i * 4) : b.readInt16LE(at + 8 + i * 2) / 32768;
      return { samples: out, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no audio in ${file}`);
}

function writeWav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/** Cuts edge silence and evens out loudness between sentences. */
function clean({ samples, rate }) {
  const threshold = 0.012;
  let a = 0;
  let b = samples.length - 1;
  while (a < b && Math.abs(samples[a]) < threshold) a++;
  while (b > a && Math.abs(samples[b]) < threshold) b--;
  const pad = Math.round(0.05 * rate);
  const cut = samples.slice(Math.max(0, a - pad), Math.min(samples.length, b + pad));
  const rms = Math.sqrt(cut.reduce((s, x) => s + x * x, 0) / cut.length);
  const peak = cut.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const gain = Math.min(TARGET_RMS / rms, PEAK / peak);
  return cut.map((x) => x * gain);
}

/** Questions and short punchlines get room to land. */
const gapAfter = (line) => (line.endsWith("?") ? 0.5 : line.length < 34 ? 0.42 : 0.3);

const scenes = JSON.parse(fs.readFileSync("src/script.json", "utf8"));
const timing = {};
let frames = 0;
for (const scene of scenes) {
  const folder = path.join(cache, scene.id);
  const chunks = [];
  const lines = [];
  let at = LEAD_S;
  let rate = 24000;
  scene.lines.forEach((text, n) => {
    const file = fs
      .readdirSync(folder)
      .filter((f) => f.startsWith(`${n}-`))
      .map((f) => path.join(folder, f))
      .sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
    if (!file) throw new Error(`no voice for ${scene.id} line ${n}`);
    const wav = readWav(file);
    rate = wav.rate;
    const voice = clean(wav);
    const seconds = voice.length / rate;
    lines.push({ text, start: at, end: at + seconds });
    chunks.push({ at, voice });
    at += seconds + gapAfter(text);
  });
  const end = lines[lines.length - 1].end + END_S;
  const sceneFrames = Math.ceil((end * 30) / GRID_FRAMES) * GRID_FRAMES;
  const out = new Float32Array(Math.ceil(end * rate));
  for (const { at: start, voice } of chunks) out.set(voice, Math.round(start * rate));
  writeWav(`public/audio/${scene.id}.wav`, out, rate);
  timing[scene.id] = { seconds: sceneFrames / 30, frames: sceneFrames, lines };
  frames += sceneFrames;
  console.log(scene.id, (sceneFrames / 30).toFixed(1));
}
frames -= TRANSITION_FRAMES * (scenes.length - 1);
fs.writeFileSync("src/timing.json", JSON.stringify(timing, null, 1));
console.log("TOTAL", (frames / 30).toFixed(1), "s");
