// Copies the footage runs' real events into src/data and saves the issue screenshots locally.
// Usage: node scripts/prep.mjs <test count>
import { execSync } from "node:child_process";
import fs from "node:fs";

const results = "../benchmarks/results";
const load = (list, issue = "") => {
  const r = fs.readFileSync(`${results}/${list}.jsonl`, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((x) => x.issue.endsWith(issue)).pop();
  const saved = JSON.parse(fs.readFileSync(`${results}/events/${r.runId}.json`, "utf8"));
  return { runId: r.runId, status: r.status, provesFix: r.provesFix, costUSD: r.costUSD, wallSeconds: r.wallSeconds, events: saved.events ?? saved };
};

const rich = load("video-rich2-2026-10-31", "/4237");
fs.mkdirSync("src/data", { recursive: true });
fs.writeFileSync("src/data/rich.json", JSON.stringify(rich));
console.log("rich", rich.status, rich.provesFix, rich.costUSD, rich.wallSeconds, rich.events.length);

const vision = load("video-gpustack-2026-10-31");
fs.mkdirSync("public/shots", { recursive: true });
const shots = vision.events.flatMap((e) => (e.type === "context" && e.screenshots) || []);
const images = {};
for (const [i, s] of shots.entries()) {
  const file = `shots/${i + 1}.png`;
  const res = await fetch(s.url);
  if (!res.ok) throw new Error(`screenshot ${s.url}: ${res.status}`);
  fs.writeFileSync(`public/${file}`, Buffer.from(await res.arrayBuffer()));
  images[s.url] = file;
}
fs.writeFileSync("src/data/vision.json", JSON.stringify({ events: vision.events, images }));
console.log("vision", vision.status, shots.length, "screenshots");

const commits = Number(execSync("git rev-list --count HEAD").toString().trim());
fs.writeFileSync("src/data/meta.json", JSON.stringify({ commits, tests: Number(process.argv[2] ?? 0) }));
console.log("commits", commits);
