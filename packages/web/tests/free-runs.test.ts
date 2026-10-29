import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { freeRunsFromEnv } from "../src/server/auth/limits.js";
import { DynamoFreeRunStore, MemoryFreeRunStore } from "../src/server/store/free-runs.js";

const limits = { perUser: 3, perDay: 5, budgetUSD: 0.2 };

describe("free runs", () => {
  it("gives each person their free runs, then stops", async () => {
    const store = new MemoryFreeRunStore();

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.claim(42, "2026-10-29", limits));

    expect(results).toEqual(["ok", "ok", "ok", "user_limit"]);
    expect(await store.used(42)).toBe(3);
  });

  it("stops everyone once the day's free runs are gone, without using up the person's own", async () => {
    const store = new MemoryFreeRunStore();
    for (let id = 1; id <= 5; id++) await store.claim(id, "2026-10-29", limits);

    expect(await store.claim(99, "2026-10-29", limits)).toBe("day_limit");
    expect(await store.used(99)).toBe(0);
    expect(await store.claim(99, "2026-10-30", limits)).toBe("ok");
  });

  it("can't be claimed twice by two clicks at once", async () => {
    const store = new MemoryFreeRunStore();

    const results = await Promise.all(Array.from({ length: 6 }, () => store.claim(7, "2026-10-29", limits)));

    expect(results.filter((r) => r === "ok")).toHaveLength(3);
  });
});

describe("DynamoFreeRunStore", () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  beforeEach(() => ddb.reset());

  it("increments with a conditional write and retries when someone else wrote first", async () => {
    ddb.on(GetCommand).resolves({ Item: { used: 1 } });
    ddb
      .on(PutCommand)
      .rejectsOnce(new ConditionalCheckFailedException({ message: "lost the race", $metadata: {} }))
      .resolves({});
    const store = new DynamoFreeRunStore(ddb as unknown as DynamoDBDocumentClient, "t");

    expect(await store.claim(42, "2026-10-29", limits)).toBe("ok");

    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input);
    expect(puts[0]).toMatchObject({ ConditionExpression: "attribute_not_exists(pk) OR used = :old", ExpressionAttributeValues: { ":old": 1 } });
    expect(puts.length).toBeGreaterThanOrEqual(3); // one lost race, then the person's run and the day's run
  });

  it("does not write when the person has no free runs left", async () => {
    ddb.on(GetCommand).resolves({ Item: { used: 3 } });
    const store = new DynamoFreeRunStore(ddb as unknown as DynamoDBDocumentClient, "t");

    expect(await store.claim(42, "2026-10-29", limits)).toBe("user_limit");
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe("freeRunsFromEnv", () => {
  it("is off without a server Meta key, so free runs can't happen by accident", () => {
    expect(freeRunsFromEnv({})).toBeNull();
  });

  it("defaults to 3 per person, 100 a day and a $0.20 cap per run", () => {
    expect(freeRunsFromEnv({ MODEL_API_KEY: "k" })).toEqual({ perUser: 3, perDay: 100, budgetUSD: 0.2 });
  });

  it("can be turned off with 0", () => {
    expect(freeRunsFromEnv({ MODEL_API_KEY: "k", THEPOLISHER_FREE_RUNS_PER_USER: "0" })).toBeNull();
  });
});
