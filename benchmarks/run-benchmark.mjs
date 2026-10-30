/**
 * ThePolisher benchmark: runs a fixed list of real open GitHub issues through
 * the full pipeline and records, per issue, whether the final patch's new tests
 * PROVE the fix in the sandbox (fail on the original code, pass with the patch),
 * and the same for the single-prompt first draft each run starts from.
 *
 * Rules: the issue list is chosen before running; every issue is run once and
 * every result is kept, failures included.
 *
 *   pnpm --filter @thepolisher/core --filter @thepolisher/agents build
 *   node benchmarks/run-benchmark.mjs benchmarks/issues-2026-10-29.json
 *
 * Needs MODEL_API_KEY, MODEL_BASE_URL, SANDBOX_URL, SANDBOX_TOKEN and GITHUB_TOKEN
 * in .env. Results append to benchmarks/results/<list name>.jsonl as each run ends.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}

const A = await import(pathToFileURL(path.join(root, "packages/agents/dist/index.js")).href);

const listPath = process.argv[2];
if (!listPath) throw new Error("Usage: node benchmarks/run-benchmark.mjs <issues.json>");
const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
const out = path.join(root, "benchmarks/results", `${path.basename(listPath, ".json")}.jsonl`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).issue) : []);

const settings = { budgetUSD: list.budgetUSD, concurrency: list.concurrency, timeoutMs: 300_000 };

async function runOne({ url, seenBefore }) {
  const client = A.chatClientFromMeta(new A.MetaModelClient({ timeoutMs: settings.timeoutMs }));
  const sandbox = new A.ModalSandboxClient({ url: process.env.SANDBOX_URL, token: process.env.SANDBOX_TOKEN });
  const github = new A.GitHubClient({ token: process.env.GITHUB_TOKEN });
  const started = Date.now();
  let comparison = null;
  let lastCost = 0;
  // Where the time goes: seconds per phase, and per lane per state (evaluating, validating, repairing...).
  const timing = { phases: {}, lanes: {} };
  let phase = { name: null, at: started };
  const laneState = {};
  const add = (bucket, key, ms) => (bucket[key] = Math.round(((bucket[key] ?? 0) + ms / 1000) * 10) / 10);
  const track = (e) => {
    const at = e.at ?? Date.now();
    if (e.type === "phase") {
      if (phase.name) add(timing.phases, phase.name, at - phase.at);
      phase = { name: e.phase, at };
    }
    if (e.type === "lane_state") {
      const prev = laneState[e.lane];
      if (prev) add((timing.lanes[e.lane] ??= {}), prev.state, at - prev.at);
      laneState[e.lane] = { state: e.state, at };
    }
  };
  const base = { issue: url, seenBefore: Boolean(seenBefore), model: new A.MetaModelClient().getModelId(), budgetUSD: settings.budgetUSD };
  try {
    const result = await A.runMaintainer(
      { kind: "github", issueUrl: url, github },
      {
        client,
        sandbox,
        budgetUSD: settings.budgetUSD,
        provider: "meta",
        onEvent: (e) => {
          track(e);
          if (e.type === "comparison") comparison = e;
          if (e.type === "cost") lastCost = e.totalUSD;
        },
      }
    );
    const files = result.snapshot && result.final ? A.diffBundle(result.snapshot, result.final).map((d) => d.path) : [];
    return {
      ...base,
      status: result.status,
      provesFix: comparison?.after?.provesFix ?? false,
      baselineProvesFix: comparison?.before?.provesFix ?? false,
      tests: comparison?.after ? `${comparison.after.testsPassed}/${comparison.after.testsTotal}` : null,
      costUSD: Number(result.totalUSD.toFixed(4)),
      wallSeconds: Math.round((Date.now() - started) / 1000),
      files,
      timing,
      error: null,
    };
  } catch (err) {
    return {
      ...base,
      status: "failed",
      provesFix: false,
      baselineProvesFix: comparison?.before?.provesFix ?? null,
      tests: null,
      costUSD: Number(lastCost.toFixed(4)),
      wallSeconds: Math.round((Date.now() - started) / 1000),
      files: [],
      timing,
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
  }
}

const queue = list.issues.filter((i) => !done.has(i.url));
console.log(`${list.issues.length} issues, ${queue.length} to run, ${settings.concurrency} at a time, budget $${settings.budgetUSD} each`);
async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    console.log(`start  ${item.url}`);
    const r = await runOne(item);
    fs.appendFileSync(out, `${JSON.stringify(r)}\n`);
    console.log(`done   ${item.url}  ${r.status}  proves=${r.provesFix} baseline=${r.baselineProvesFix}  $${r.costUSD}  ${r.wallSeconds}s${r.error ? `  error: ${r.error}` : ""}`);
  }
}
await Promise.all(Array.from({ length: settings.concurrency }, worker));
console.log(`results: ${out}`);
