/**
 * DynamoDB storage in one table (`pk` / `sk` string keys), sized for the
 * always-free tier, which only covers provisioned capacity:
 *
 *   RUN#<id>        META           the run's summary
 *   RUN#<id>        EV#0001…       the event timeline, a few large pages
 *   FEED            <start>#<id>   every run, for the public list
 *   USER#<login>    <start>#<id>   a signed-in user's runs, for the daily limit
 *   SESSION#<hash>  META           a signed-in session (see auth/sessions.ts)
 *   EXP#<provider>  <time>#<id>    shared memory (verified runs only)
 *
 * Values are stored as a JSON string in `data`, so item sizes are predictable.
 */

import { BatchWriteCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Experience, ExperienceStore } from "@thepolisher/agents";
import { splitIntoPages, type RunRecord, type RunStore, type SavedRun } from "./types.js";

/** Comfortably under DynamoDB's 400 KB item limit. */
const PAGE_CHARS = 300_000;
const BATCH_SIZE = 25;
const BATCH_RETRIES = 5;
/** Recall runs every revision round; one read per minute keeps it inside the free read capacity. */
const MEMORY_CACHE_MS = 60_000;
const MAX_MEMORY_ITEMS = 5_000;

type Item = { pk: string; sk: string; data: string };

const pageKey = (n: number) => `EV#${String(n).padStart(4, "0")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryAll(ddb: DynamoDBDocumentClient, table: string, pk: string, newestFirst = false, max = Infinity): Promise<Item[]> {
  const items: Item[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ScanIndexForward: !newestFirst,
        ExclusiveStartKey: start,
        Limit: Number.isFinite(max) ? Math.min(max - items.length, 1000) : undefined,
      })
    );
    items.push(...((page.Items ?? []) as Item[]));
    start = page.LastEvaluatedKey;
  } while (start && items.length < max);
  return items;
}

/** Write items in batches of 25, retrying whatever DynamoDB couldn't take under its throughput limit. */
async function batchPut(ddb: DynamoDBDocumentClient, table: string, items: Item[]): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    let requests = items.slice(i, i + BATCH_SIZE).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; requests.length > 0; attempt++) {
      if (attempt > BATCH_RETRIES) throw new Error("DynamoDB kept throttling the run history write.");
      const res = await ddb.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
      requests = (res.UnprocessedItems?.[table] ?? []) as typeof requests;
      if (requests.length > 0) await sleep(200 * 2 ** attempt);
    }
  }
}

export class DynamoRunStore implements RunStore {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly table: string
  ) {}

  private async putSummary(record: RunRecord): Promise<void> {
    const data = JSON.stringify(record);
    await Promise.all([
      this.ddb.send(new PutCommand({ TableName: this.table, Item: { pk: `RUN#${record.id}`, sk: "META", data } })),
      this.ddb.send(new PutCommand({ TableName: this.table, Item: { pk: "FEED", sk: `${record.startedAt}#${record.id}`, data } })),
    ]);
  }

  async start(record: RunRecord): Promise<void> {
    await this.putSummary(record);
    if (record.user) {
      // A tiny per-user index: the daily limit is one COUNT query instead of a scan.
      await this.ddb.send(
        new PutCommand({ TableName: this.table, Item: { pk: `USER#${record.user}`, sk: `${record.startedAt}#${record.id}`, data: record.id } })
      );
    }
  }

  async countSince(user: string, sinceIso: string): Promise<number> {
    const res = await this.ddb.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "pk = :pk AND sk >= :since",
        ExpressionAttributeValues: { ":pk": `USER#${user}`, ":since": sinceIso },
        Select: "COUNT",
      })
    );
    return res.Count ?? 0;
  }

  async finish(record: RunRecord, events: readonly unknown[]): Promise<void> {
    await this.putSummary(record);
    const pages = splitIntoPages(events, PAGE_CHARS).map((page, i) => ({
      pk: `RUN#${record.id}`,
      sk: pageKey(i + 1),
      data: JSON.stringify(page),
    }));
    await batchPut(this.ddb, this.table, pages);
  }

  async get(id: string): Promise<SavedRun | null> {
    const items = await queryAll(this.ddb, this.table, `RUN#${id}`);
    const meta = items.find((i) => i.sk === "META");
    if (!meta) return null;
    const events = items
      .filter((i) => i.sk.startsWith("EV#"))
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .flatMap((i) => JSON.parse(i.data) as unknown[]);
    return { record: JSON.parse(meta.data) as RunRecord, events };
  }

  async list(limit: number): Promise<RunRecord[]> {
    const items = await queryAll(this.ddb, this.table, "FEED", true, limit);
    return items.map((i) => JSON.parse(i.data) as RunRecord);
  }
}

export class DynamoExperienceStore implements ExperienceStore {
  private cache: { at: number; items: Experience[] } | null = null;

  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly table: string,
    private readonly provider: string
  ) {}

  async list(): Promise<Experience[]> {
    if (this.cache && Date.now() - this.cache.at < MEMORY_CACHE_MS) return this.cache.items;
    const items = await queryAll(this.ddb, this.table, `EXP#${this.provider}`, true, MAX_MEMORY_ITEMS);
    // Oldest first, like the file store; recall weighs recent evidence itself.
    const experiences = items.map((i) => JSON.parse(i.data) as Experience).reverse();
    this.cache = { at: Date.now(), items: experiences };
    return experiences;
  }

  async append(experience: Experience): Promise<void> {
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `EXP#${experience.provider}`, sk: `${experience.createdAt}#${experience.id}`, data: JSON.stringify(experience) },
      })
    );
    if (this.cache && experience.provider === this.provider) this.cache.items = [...this.cache.items, experience];
  }
}
