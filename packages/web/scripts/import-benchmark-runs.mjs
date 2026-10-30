// Imports benchmark runs (benchmarks/results/*.jsonl) into the shared run history,
// so they show on the Runs page labelled "Benchmark". Runs that saved their timeline
// (benchmarks/results/events/<runId>.json) get a full replay; older ones only had a
// summary, and are imported as exactly that: no timeline and no made-up times
// (only the date they ran, from the list's file name).
//
//   node packages/web/scripts/import-benchmark-runs.mjs benchmarks/results/issues-2026-10-29.jsonl [...]
//
// Safe to re-run: each run's id is fixed, so importing again overwrites, never duplicates.
// Needs AWS credentials for THEPOLISHER_TABLE in AWS_REGION (e.g. `aws login --profile thepolisher`).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const envFile = new URL("../../../.env", import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const table = process.env.THEPOLISHER_TABLE?.trim();
if (!table) {
  console.error("Set THEPOLISHER_TABLE in .env first.");
  process.exit(1);
}
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node packages/web/scripts/import-benchmark-runs.mjs <results.jsonl> [...]");
  process.exit(1);
}

// Must match packages/web/src/server/store/dynamo.ts.
const PAGE_CHARS = 300_000;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION?.trim() || "us-east-1" }));

/** A stable UUID-shaped id from the list and issue, for summary-only runs saved before runs had ids. */
function stableId(list, issue) {
  const h = createHash("sha1").update(`${list}|${issue}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function pages(events) {
  const out = [];
  let page = [];
  let size = 2;
  for (const e of events) {
    const length = JSON.stringify(e).length + 1;
    if (page.length && size + length > PAGE_CHARS) {
      out.push(page);
      page = [];
      size = 2;
    }
    page.push(e);
    size += length;
  }
  if (page.length) out.push(page);
  return out;
}

// Compressed like the app's own pages (dynamo.ts), so each write fits the free tier.
const pack = (json) => ({ data: gzipSync(json).toString("base64"), enc: "gzip" });

/** One item at a time, waiting out the free-tier table's write limit instead of failing. */
async function put(items) {
  for (const Item of items) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: [{ PutRequest: { Item } }] } }));
        if (!res.UnprocessedItems?.[table]?.length) break;
      } catch (err) {
        if (err.name !== "ProvisionedThroughputExceededException") throw err;
      }
      if (attempt >= 20) throw new Error("DynamoDB kept refusing writes; try again in a few minutes.");
      await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 15_000)));
    }
  }
}

/** Older results didn't record the issue title; look it up (public API, GITHUB_TOKEN if set). */
const titles = new Map();
async function titleOf(owner, repo, number) {
  const key = `${owner}/${repo}#${number}`;
  if (!titles.has(key)) {
    const token = process.env.GITHUB_TOKEN?.trim();
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
      headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    titles.set(key, res.ok ? ((await res.json()).title ?? "") : "");
  }
  return titles.get(key);
}

let imported = 0;
for (const file of files) {
  const list = path.basename(file, ".jsonl");
  const ranOn = list.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    const id = r.runId ?? stableId(list, r.issue);
    const eventsFile = path.join(path.dirname(file), "events", `${id}.json`);
    const events = fs.existsSync(eventsFile) ? JSON.parse(fs.readFileSync(eventsFile, "utf8")) : [];
    const m = r.issue.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
    const startedAt = r.startedAt ?? ranOn;
    if (!m || !startedAt) {
      console.warn(`skipped ${r.issue}: can't tell its repo or when it ran`);
      continue;
    }
    const record = {
      id,
      issueUrl: r.issue,
      repo: m[1],
      issueNumber: Number(m[2]),
      title: r.title || (await titleOf(...m[1].split("/"), Number(m[2]))),
      status: r.status,
      totalUSD: r.costUSD,
      model: r.model,
      startedAt,
      finishedAt: r.startedAt ? new Date(Date.parse(r.startedAt) + r.wallSeconds * 1000).toISOString() : null,
      user: null,
      source: "benchmark",
      benchmark: {
        list,
        provesFix: r.provesFix,
        baselineProvesFix: r.baselineProvesFix,
        tests: r.tests,
        wallSeconds: r.wallSeconds,
        seenBefore: r.seenBefore,
        hasTimeline: events.length > 0,
      },
    };
    const data = JSON.stringify(record);
    await put([
      { pk: `RUN#${id}`, sk: "META", data },
      { pk: "FEED", sk: `${startedAt}#${id}`, data },
      ...pages(events).map((p, i) => ({ pk: `RUN#${id}`, sk: `EV#${String(i + 1).padStart(4, "0")}`, ...pack(JSON.stringify(p)) })),
    ]);
    imported++;
    console.log(`imported ${r.issue} (${list}${events.length ? ", with timeline" : ", summary only"})`);
  }
}
console.log(`${imported} runs imported into ${table}.`);
