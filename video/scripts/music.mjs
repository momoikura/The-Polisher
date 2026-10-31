// An original score, synthesized from nothing, so there are no rights to clear. 120 BPM, so
// every scene change lands on a beat. It follows the film: tension, a lift when ThePolisher
// appears, a groove through the run, a breakdown into the proof, a lift for the results, a
// resolve at the end. Writes public/audio/score.wav (ducked under the voice).
import fs from "node:fs";

const RATE = 44100;
const BEAT = 0.5;
const BAR = BEAT * 4;
const TRANSITION = 0.5;

const script = JSON.parse(fs.readFileSync("src/script.json", "utf8"));
const timing = JSON.parse(fs.readFileSync("src/timing.json", "utf8"));
const beats = JSON.parse(fs.readFileSync("src/beats.json", "utf8")); // where key words land in their lines
const start = {};
let t = 0;
for (const s of script) {
  start[s.id] = t;
  t += timing[s.id].seconds - TRANSITION;
}
const TOTAL = t + TRANSITION;
const line = (id, n) => start[id] + timing[id].lines[n].start;
const N = Math.ceil((TOTAL + 3) * RATE);
const dry = [new Float32Array(N), new Float32Array(N)];
const wet = [new Float32Array(N), new Float32Array(N)]; // goes to reverb
const fx = [new Float32Array(N), new Float32Array(N)]; // effects: not ducked
const duckFromKick = new Float32Array(N).fill(1);

// A little seeded randomness keeps every render identical.
let seed = 1234567;
const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647 - 0.5);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Am9, Fmaj7, Cmaj7, G6: wistful, then hopeful.
const CHORDS = [
  { root: 45, notes: [57, 60, 64, 67, 71] },
  { root: 41, notes: [57, 60, 64, 65, 69] },
  { root: 48, notes: [55, 60, 64, 67, 71] },
  { root: 43, notes: [55, 59, 62, 64, 67] },
];
const chordAt = (time) => CHORDS[Math.floor(time / (BAR * 2)) % CHORDS.length];

/** How much of each layer plays over time. */
const at = (id, n = 0) => (n === 0 ? start[id] : line(id, n));
const SECTIONS = [
  { from: 0, pad: 0.55, arp: 0, bass: 0, kick: 0, hat: 0, bright: 0.25 },
  { from: line("hook", 3), pad: 0.7, arp: 0.25, bass: 0.25, kick: 0, hat: 0, bright: 0.35 },
  { from: at("problem"), pad: 0.6, arp: 0.35, bass: 0.35, kick: 0, hat: 0.12, bright: 0.3 },
  { from: line("problem", 5), pad: 0.85, arp: 0.45, bass: 0.6, kick: 0.45, hat: 0.2, bright: 0.45 },
  { from: line("problem", 6), pad: 1, arp: 0.75, bass: 0.85, kick: 0.9, hat: 0.6, bright: 0.85 },
  { from: at("paste"), pad: 0.75, arp: 0.7, bass: 0.8, kick: 0.8, hat: 0.5, bright: 0.65 },
  { from: at("agents"), pad: 0.85, arp: 0.85, bass: 0.95, kick: 1, hat: 0.75, bright: 0.8 },
  { from: at("vision"), pad: 0.7, arp: 0.6, bass: 0.6, kick: 0.5, hat: 0.3, bright: 0.5 },
  { from: at("proof"), pad: 0.8, arp: 0.2, bass: 0.2, kick: 0, hat: 0, bright: 0.3 },
  { from: line("proof", 3), pad: 1, arp: 0.7, bass: 0.8, kick: 0.5, hat: 0.3, bright: 0.9 },
  { from: at("compare"), pad: 0.7, arp: 0.6, bass: 0.7, kick: 0.6, hat: 0.4, bright: 0.6 },
  { from: at("results"), pad: 0.7, arp: 0.5, bass: 0.5, kick: 0.35, hat: 0.25, bright: 0.5 },
  { from: line("results", 3), pad: 1, arp: 0.95, bass: 1, kick: 1, hat: 0.85, bright: 1 },
  { from: line("results", 5), pad: 0.75, arp: 0.55, bass: 0.6, kick: 0.45, hat: 0.3, bright: 0.6 },
  { from: at("safety"), pad: 0.7, arp: 0.6, bass: 0.6, kick: 0.5, hat: 0.35, bright: 0.55 },
  { from: at("close"), pad: 0.9, arp: 0.7, bass: 0.8, kick: 0.7, hat: 0.5, bright: 0.8 },
  { from: line("close", 1), pad: 1, arp: 0.5, bass: 0.7, kick: 0, hat: 0, bright: 1 },
  { from: TOTAL - 1.2, pad: 0, arp: 0, bass: 0, kick: 0, hat: 0, bright: 1 },
];
function level(time, key) {
  let i = 0;
  while (i + 1 < SECTIONS.length && SECTIONS[i + 1].from <= time) i++;
  const cur = SECTIONS[i];
  const prev = SECTIONS[Math.max(0, i - 1)];
  return prev[key] + (cur[key] - prev[key]) * smooth((time - cur.from) / 1.2);
}

function kick(time, amp) {
  const a = Math.round(time * RATE);
  const n = Math.round(0.3 * RATE);
  let phase = 0;
  for (let i = 0; i < n && a + i < N; i++) {
    const x = i / RATE;
    phase += (2 * Math.PI * (46 + 80 * Math.exp(-x * 34))) / RATE;
    const s = Math.sin(phase) * Math.exp(-x * 11) * amp;
    dry[0][a + i] += s;
    dry[1][a + i] += s;
  }
  // Everything else breathes around the kick.
  const m = Math.round(0.34 * RATE);
  for (let i = 0; i < m && a + i < N; i++) duckFromKick[a + i] = Math.min(duckFromKick[a + i], 1 - amp * 0.55 * (1 - smooth(i / m)));
}

function hat(time, amp, open = false) {
  const a = Math.round(time * RATE);
  const n = Math.round((open ? 0.16 : 0.05) * RATE);
  let last = 0;
  for (let i = 0; i < n && a + i < N; i++) {
    const noise = rnd();
    const high = noise - last; // crude high-pass: bright, not harsh
    last = noise;
    const s = high * Math.exp((-i / n) * 5) * amp;
    dry[0][a + i] += s * 0.8;
    dry[1][a + i] += s;
  }
}

function snare(time, amp) {
  const a = Math.round(time * RATE);
  const n = Math.round(0.2 * RATE);
  for (let i = 0; i < n && a + i < N; i++) {
    const x = i / RATE;
    const s = (rnd() * 0.8 * Math.exp(-x * 22) + 0.3 * Math.sin(2 * Math.PI * 185 * x) * Math.exp(-x * 30)) * amp;
    for (const c of [0, 1]) {
      dry[c][a + i] += s;
      wet[c][a + i] += s * 0.3;
    }
  }
}

function pluck(time, midi, amp, pan) {
  const a = Math.round(time * RATE);
  const n = Math.round(1.1 * RATE);
  const f = hz(midi);
  const l = Math.cos(((pan + 1) * Math.PI) / 4);
  const r = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n && a + i < N; i++) {
    const x = i / RATE;
    const env = Math.min(1, x / 0.004) * Math.exp(-x * 5.5);
    const s = Math.sin(2 * Math.PI * f * x + 1.6 * Math.exp(-x * 11) * Math.sin(2 * Math.PI * 2 * f * x)) * env * amp;
    dry[0][a + i] += s * l;
    dry[1][a + i] += s * r;
    wet[0][a + i] += s * l * 0.55;
    wet[1][a + i] += s * r * 0.55;
  }
}

function bass(time, length, midi, amp) {
  const a = Math.round(time * RATE);
  const n = Math.round(length * RATE);
  const f = hz(midi);
  for (let i = 0; i < n && a + i < N; i++) {
    const x = i / RATE;
    const env = Math.min(1, x / 0.012) * smooth((length - x) / 0.06);
    const s = (Math.sin(2 * Math.PI * f * x) + 0.28 * Math.sin(4 * Math.PI * f * x)) * env * amp;
    dry[0][a + i] += s;
    dry[1][a + i] += s;
  }
}

// ── The arrangement ───────────────────────────────────────────────────────────

const ARP = [4, 2, 3, 1, 4, 3, 2, 0]; // indexes into the chord
for (let beat = 0; beat * BEAT < TOTAL; beat++) {
  const time = beat * BEAT;
  const k = level(time, "kick");
  const h = level(time, "hat");
  if (k > 0.04) kick(time, 0.5 * k);
  if (k > 0.5 && beat % 4 === 2) snare(time, 0.11 * k);
  if (h > 0.05) {
    hat(time + BEAT / 2, 0.1 * h, beat % 4 === 3);
    if (h > 0.45) {
      hat(time + BEAT / 4, 0.045 * h);
      hat(time + (3 * BEAT) / 4, 0.05 * h);
    }
  }
}
for (let eighth = 0; eighth * (BEAT / 2) < TOTAL; eighth++) {
  const time = eighth * (BEAT / 2);
  const a = level(time, "arp");
  const b = level(time, "bright");
  const chord = chordAt(time);
  if (a > 0.04) {
    const step = ARP[eighth % ARP.length];
    const lift = b > 0.7 && eighth % 16 >= 12 ? 12 : 0;
    pluck(time, chord.notes[step] + 12 + lift, 0.075 * a * (eighth % 4 === 0 ? 1 : 0.72), eighth % 2 ? 0.35 : -0.35);
  }
  const bs = level(time, "bass");
  if (bs > 0.04 && eighth % 2 === 0) bass(time, BEAT * 0.9, chord.root - 12 + (eighth % 8 === 6 ? 7 : 0), 0.17 * bs);
}

// Pad: soft harmonics, a little detune, opening up as the film gets brighter.
const TWO_PI = 2 * Math.PI;
const detunes = [-0.09, 0.07];
const phases = new Map();
let lpL = 0;
let lpR = 0;
for (let i = 0; i < N; i++) {
  const time = i / RATE;
  const bar = time / (BAR * 2);
  const slot = Math.floor(bar);
  const into = (bar - slot) * (BAR * 2);
  const chord = CHORDS[slot % CHORDS.length];
  const prev = CHORDS[(slot + CHORDS.length - 1) % CHORDS.length];
  const blend = smooth(into / 0.7);
  const bright = level(time, "bright");
  const gain = level(time, "pad");
  let l = 0;
  let r = 0;
  const voices = (notes, weight, tag) => {
    if (weight <= 0.001) return;
    notes.forEach((midi, v) => {
      detunes.forEach((d, dn) => {
        const key = `${midi}:${dn}`;
        const ph = (phases.get(key) ?? v * 0.7 + dn) + (TWO_PI * hz(midi + d)) / RATE;
        phases.set(key, ph % TWO_PI);
        const s = (Math.sin(ph) + (0.32 + 0.3 * bright) * Math.sin(2 * ph) + 0.16 * bright * Math.sin(3 * ph)) * weight;
        if (dn === 0) l += s;
        else r += s;
      });
    });
    return tag;
  };
  voices(chord.notes, blend, "a");
  voices(prev.notes, 1 - blend, "b");
  // Slow movement, so a held chord never sounds static.
  const wob = 0.86 + 0.14 * Math.sin(TWO_PI * time * 0.11);
  const c = 0.03 + 0.1 * bright;
  lpL += c * (l - lpL);
  lpR += c * (r - lpR);
  const amp = 0.021 * gain * wob;
  dry[0][i] += lpL * amp;
  dry[1][i] += lpR * amp;
  wet[0][i] += lpL * amp * 0.6;
  wet[1][i] += lpR * amp * 0.6;
}

// ── Effects, on the moments the picture hits ──────────────────────────────────

function whoosh(end, length, amp) {
  const a = Math.round((end - length) * RATE);
  const n = Math.round((length + 0.12) * RATE);
  let lp = 0;
  for (let i = 0; i < n && a + i < N; i++) {
    if (a + i < 0) continue;
    const p = i / (length * RATE);
    const env = p < 1 ? p * p : Math.max(0, 1 - (p - 1) * 9);
    lp += (0.02 + 0.3 * Math.min(p, 1)) * (rnd() - lp);
    const s = lp * env * amp;
    fx[0][a + i] += s;
    fx[1][a + i] += s * (0.7 + 0.3 * Math.sin(p * 6));
  }
}

function impact(time, amp) {
  const a = Math.round(time * RATE);
  const n = Math.round(0.9 * RATE);
  let phase = 0;
  for (let i = 0; i < n && a + i < N; i++) {
    const x = i / RATE;
    phase += (TWO_PI * (38 + 60 * Math.exp(-x * 20))) / RATE;
    const s = (Math.sin(phase) * Math.exp(-x * 5) + rnd() * 0.25 * Math.exp(-x * 40)) * amp;
    fx[0][a + i] += s;
    fx[1][a + i] += s;
  }
}

function chime(time, notes, amp) {
  notes.forEach((midi, v) => {
    const a = Math.round((time + v * 0.075) * RATE);
    const n = Math.round(1.6 * RATE);
    const f = hz(midi);
    for (let i = 0; i < n && a + i < N; i++) {
      const x = i / RATE;
      const env = Math.min(1, x / 0.003) * Math.exp(-x * 3.4);
      const s = (Math.sin(TWO_PI * f * x) + 0.3 * Math.sin(TWO_PI * 2.76 * f * x) * Math.exp(-x * 9)) * env * amp;
      for (const c of [0, 1]) {
        fx[c][a + i] += s;
        wet[c][a + i] += s * 0.5;
      }
    }
  });
}

function click(time, amp) {
  const a = Math.round(time * RATE);
  const n = Math.round(0.02 * RATE);
  for (let i = 0; i < n && a + i < N; i++) {
    const s = rnd() * Math.exp((-i / n) * 6) * amp;
    fx[0][a + i] += s;
    fx[1][a + i] += s;
  }
}

function thud(time, amp) {
  const a = Math.round(time * RATE);
  const n = Math.round(0.5 * RATE);
  for (let i = 0; i < n && a + i < N; i++) {
    const x = i / RATE;
    const s = Math.sin(TWO_PI * (70 - 25 * Math.min(1, x * 6)) * x) * Math.exp(-x * 11) * amp;
    fx[0][a + i] += s;
    fx[1][a + i] += s;
  }
}

for (const s of script.slice(1)) whoosh(start[s.id] + TRANSITION / 2, 0.55, 0.13);
impact(line("hook", 1), 0.2); // fails
chime(line("hook", 2), [76, 79, 84], 0.05); // passes
chime(line("hook", 4) + 0.1, [72, 76, 79], 0.035);
impact(line("problem", 6), 0.3); // ThePolisher appears
click(start.paste + timing.paste.lines[1].start - 0.2, 0.5); // the Run click
chime(line("paste", 2) + 2.1, [79, 83, 86], 0.04); // the tests pick the winner
for (let n = 1; n <= 4; n++) click(line("agents", n), 0.25);
chime(line("agents", 5) + 0.9, [76, 79, 84], 0.04); // kept by the gate
thud(line("agents", 6) + 0.25, 0.3); // thrown out
impact(line("proof", 2), 0.14);
chime(line("proof", 2) + beats.proofPass, [76, 79, 84], 0.05); // passes with the fix
impact(line("proof", 3) + beats.proofWord, 0.3); // "That's proof"
chime(line("proof", 3) + beats.proofWord, [72, 76, 79, 84], 0.06);
impact(line("results", 3), 0.28); // proved fourteen
chime(line("results", 4), [79, 84, 88], 0.04);
click(line("safety", 4) + beats.safetyClick, 0.4);
impact(line("close", 2), 0.3);
chime(line("close", 2), [69, 72, 76, 81, 84], 0.06);

// ── Reverb, mix, and ducking under the voice ──────────────────────────────────

function reverb(input, offset) {
  const out = new Float32Array(N);
  for (const [ms, fb] of [[29.7, 0.83], [37.1, 0.82], [41.1, 0.81], [43.7, 0.8]]) {
    const d = Math.round(((ms + offset) / 1000) * RATE);
    const buf = new Float32Array(d);
    let p = 0;
    let lp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[p];
      lp += 0.32 * (y - lp); // damping: the tail darkens, as a room's does
      buf[p] = input[i] + lp * fb;
      p = (p + 1) % d;
      out[i] += y * 0.25;
    }
  }
  return out;
}
const rev = [reverb(wet[0], 0), reverb(wet[1], 1.3)];

const voiceDuck = new Float32Array(N).fill(1);
const UNDER_VOICE = 0.17;
for (const s of script) {
  for (const l of timing[s.id].lines) {
    const a = start[s.id] + l.start;
    const b = start[s.id] + l.end;
    for (let i = Math.max(0, Math.round((a - 0.18) * RATE)); i < Math.min(N, Math.round((b + 0.3) * RATE)); i++) {
      const time = i / RATE;
      const into = smooth((time - (a - 0.18)) / 0.18);
      const out = smooth((b + 0.3 - time) / 0.3);
      voiceDuck[i] = Math.min(voiceDuck[i], 1 - (1 - UNDER_VOICE) * Math.min(into, out));
    }
  }
}

const samples = Math.ceil(TOTAL * RATE);
const pcm = Buffer.alloc(samples * 4);
let peak = 0;
for (let i = 0; i < samples; i++) {
  const fade = smooth((TOTAL - i / RATE) / 0.9);
  for (const c of [0, 1]) {
    const music = (dry[c][i] * duckFromKick[i] + rev[c][i] * duckFromKick[i]) * voiceDuck[i];
    const raw = (music + fx[c][i] * 0.8) * fade;
    const soft = Math.tanh(raw * 1.15) * 0.92;
    peak = Math.max(peak, Math.abs(soft));
    pcm.writeInt16LE(Math.round(soft * 32767), i * 4 + c * 2);
  }
}
const h = Buffer.alloc(44);
h.write("RIFF", 0);
h.writeUInt32LE(36 + pcm.length, 4);
h.write("WAVEfmt ", 8);
h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20);
h.writeUInt16LE(2, 22);
h.writeUInt32LE(RATE, 24);
h.writeUInt32LE(RATE * 4, 28);
h.writeUInt16LE(4, 32);
h.writeUInt16LE(16, 34);
h.write("data", 36);
h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync("public/audio/score.wav", Buffer.concat([h, pcm]));
console.log("score", TOTAL.toFixed(1), "s, peak", peak.toFixed(3));
