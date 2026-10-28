import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { MemoryExperienceStore, type Experience } from "@thepolisher/agents";
import { splitIntoPages, type RunRecord } from "../src/server/store/types.js";
import { FileRunStore } from "../src/server/store/file-store.js";
import { DynamoExperienceStore, DynamoRunStore } from "../src/server/store/dynamo.js";
import { VerifiedMemory } from "../src/server/store/verified-memory.js";

const record = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: "run-1",
  issueUrl: "https://github.com/o/r/issues/7",
  repo: "o/r",
  issueNumber: 7,
  title: "Bug",
  status: "running",
  totalUSD: 0,
  model: "muse-spark-1.3",
  startedAt: "2026-10-29T06:00:00.000Z",
  finishedAt: null,
  user: null,
  ...overrides,
});

const experience = (overrides: Partial<Experience> = {}): Experience => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  lane: "code",
  model: "muse-spark-1.3",
  promptVersion: "v",
  provider: "meta",
  briefKeywords: ["path", "storage"],
  targeted: ["py_tests"],
  fixed: ["py_tests"],
  broke: [],
  problemsBefore: 1,
  problemsAfter: 0,
  scoreBefore: 5,
  scoreAfter: 9,
  accepted: true,
  reason: "improvement",
  strategies: ["Strip the trailing segment"],
  ...overrides,
});

describe("splitIntoPages", () => {
  it("keeps every event, in order, with each page under the size limit", () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ seq: i, text: "x".repeat(100) }));
    const pages = splitIntoPages(events, 1_000);
    expect(pages.flat()).toEqual(events);
    for (const page of pages) expect(JSON.stringify(page).length).toBeLessThanOrEqual(1_000);
  });

  it("puts an event bigger than the limit on a page of its own", () => {
    const pages = splitIntoPages([{ a: 1 }, { big: "y".repeat(500) }, { b: 2 }], 100);
    expect(pages).toHaveLength(3);
  });
});

describe("FileRunStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "thepolisher-runs-"));
    return () => rm(dir, { recursive: true, force: true });
  });

  it("saves a run, its events and its final state, and lists newest first", async () => {
    const store = new FileRunStore(dir);
    await store.start(record({ id: "old", startedAt: "2026-10-28T00:00:00.000Z" }));
    await store.start(record());
    await store.finish(record({ status: "clean", totalUSD: 0.4, finishedAt: "2026-10-29T06:05:00.000Z" }), [{ type: "phase" }, { type: "complete" }]);

    const saved = await store.get("run-1");
    expect(saved?.record.status).toBe("clean");
    expect(saved?.events).toEqual([{ type: "phase" }, { type: "complete" }]);
    expect((await store.list(10)).map((r) => r.id)).toEqual(["run-1", "old"]);
  });

  it("counts a user's runs since a time, for the daily limit", async () => {
    const store = new FileRunStore(dir);
    await store.start(record({ id: "a", user: "momoikura", startedAt: "2026-10-28T23:00:00.000Z" }));
    await store.start(record({ id: "b", user: "momoikura", startedAt: "2026-10-29T01:00:00.000Z" }));
    await store.start(record({ id: "c", user: "someone-else", startedAt: "2026-10-29T02:00:00.000Z" }));
    expect(await store.countSince("momoikura", "2026-10-29T00:00:00.000Z")).toBe(1);
  });

  it("returns null for a run it never saw", async () => {
    expect(await new FileRunStore(dir).get("nope")).toBeNull();
  });
});

describe("DynamoRunStore", () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  beforeEach(() => ddb.reset());
  const store = () => new DynamoRunStore(ddb as unknown as DynamoDBDocumentClient, "thepolisher");

  it("writes the run summary and a feed entry when a run starts", async () => {
    ddb.on(PutCommand).resolves({});
    await store().start(record());
    const items = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pk: "RUN#run-1", sk: "META" }),
        expect.objectContaining({ pk: "FEED", sk: "2026-10-29T06:00:00.000Z#run-1" }),
      ])
    );
  });

  it("indexes a signed-in user's runs so the daily limit is one cheap query", async () => {
    ddb.on(PutCommand).resolves({});
    await store().start(record({ user: "momoikura" }));
    const items = ddb.commandCalls(PutCommand).map((c) => c.args[0].input.Item);
    expect(items).toEqual(expect.arrayContaining([expect.objectContaining({ pk: "USER#momoikura", sk: "2026-10-29T06:00:00.000Z#run-1" })]));

    ddb.on(QueryCommand).resolves({ Count: 2 });
    expect(await store().countSince("momoikura", "2026-10-29T00:00:00.000Z")).toBe(2);
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input).toMatchObject({ Select: "COUNT", KeyConditionExpression: "pk = :pk AND sk >= :since" });
  });

  it("stores events as a few large pages, not one write per event", async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(BatchWriteCommand).resolves({});
    const events = Array.from({ length: 300 }, (_, i) => ({ type: "lane_state", i }));
    await store().finish(record({ status: "clean" }), events);
    const pages = ddb.commandCalls(BatchWriteCommand).flatMap((c) => Object.values(c.args[0].input.RequestItems ?? {}).flat());
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.length).toBeLessThan(5);
  });

  it("reads a run back with its events reassembled in order", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { pk: "RUN#run-1", sk: "EV#0002", data: JSON.stringify([{ n: 3 }]) },
        { pk: "RUN#run-1", sk: "EV#0001", data: JSON.stringify([{ n: 1 }, { n: 2 }]) },
        { pk: "RUN#run-1", sk: "META", data: JSON.stringify(record({ status: "verified" })) },
      ],
    });
    const run = await store().get("run-1");
    expect(run?.record.status).toBe("verified");
    expect(run?.events).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });
});

describe("DynamoExperienceStore", () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  beforeEach(() => ddb.reset());

  it("keeps each provider's memory in its own partition", async () => {
    ddb.on(PutCommand).resolves({});
    const e = experience();
    await new DynamoExperienceStore(ddb as unknown as DynamoDBDocumentClient, "thepolisher", "meta").append(e);
    expect(ddb.commandCalls(PutCommand)[0].args[0].input.Item).toMatchObject({ pk: "EXP#meta", sk: `${e.createdAt}#${e.id}` });
  });

  it("caches reads so recall during a run doesn't use up the free read capacity", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ data: JSON.stringify(experience()) }] });
    const store = new DynamoExperienceStore(ddb as unknown as DynamoDBDocumentClient, "thepolisher", "meta");
    await store.list();
    await store.list();
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(1);
  });
});

describe("VerifiedMemory", () => {
  it("lets the run recall shared lessons and its own, but only shares them if the run is verified", async () => {
    const shared = new MemoryExperienceStore();
    await shared.append(experience({ strategies: ["Shared lesson"] }));

    const kept = new VerifiedMemory(shared);
    await kept.append(experience({ strategies: ["Own lesson"] }));
    expect((await kept.list()).map((e) => e.strategies[0])).toEqual(["Shared lesson", "Own lesson"]);
    await kept.commit("verified");
    expect(await shared.list()).toHaveLength(2);

    const dropped = new VerifiedMemory(shared);
    await dropped.append(experience({ strategies: ["Unverified lesson"] }));
    await dropped.commit("not_clean");
    expect(await shared.list()).toHaveLength(2);
  });

  it("trims long strategy text before sharing it", async () => {
    const shared = new MemoryExperienceStore();
    const memory = new VerifiedMemory(shared);
    await memory.append(experience({ strategies: ["x".repeat(1_000)] }));
    await memory.commit("clean");
    expect((await shared.list())[0].strategies[0].length).toBeLessThanOrEqual(240);
  });
});
