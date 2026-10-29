/**
 * Free runs on the owner's Meta key, so someone without a key (a judge, a
 * first-time visitor) can still try ThePolisher. Counted per person (by GitHub
 * id, which can't be renamed and reused) and per day for everyone, both with
 * conditional writes so two quick clicks can't take the same free run.
 *
 * DynamoDB items:
 *   FREE#<github id>  META   {used}   runs this person has taken
 *   FREEDAY#<date>    META   {used}   runs taken by everyone that day (UTC)
 */

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { FreeRunLimits } from "../auth/limits.js";

export type FreeRunClaim = "ok" | "user_limit" | "day_limit";

export interface FreeRunStore {
  /** Free runs this person has taken. */
  used(githubId: number): Promise<number>;
  /** Takes one free run if the person and the day both have one left. */
  claim(githubId: number, day: string, limits: FreeRunLimits): Promise<FreeRunClaim>;
}

/** A counter that only moves while it stays within [0, limit]. */
interface Counters {
  get(key: string): Promise<number>;
  /** Adds `by` unless that would pass `limit`; false if it would. */
  add(key: string, by: 1 | -1, limit: number): Promise<boolean>;
}

const userKey = (githubId: number) => `FREE#${githubId}`;
const dayKey = (day: string) => `FREEDAY#${day}`;

async function claimWith(counters: Counters, githubId: number, day: string, limits: FreeRunLimits): Promise<FreeRunClaim> {
  if (!(await counters.add(userKey(githubId), 1, limits.perUser))) return "user_limit";
  if (!(await counters.add(dayKey(day), 1, limits.perDay))) {
    // Give the person's run back: the day ran out, not their allowance.
    await counters.add(userKey(githubId), -1, limits.perUser);
    return "day_limit";
  }
  return "ok";
}

export class MemoryFreeRunStore implements FreeRunStore {
  private readonly counts = new Map<string, number>();
  private readonly counters: Counters = {
    get: async (key) => this.counts.get(key) ?? 0,
    add: async (key, by, limit) => {
      const next = (this.counts.get(key) ?? 0) + by;
      if (next < 0 || next > limit) return false;
      this.counts.set(key, next);
      return true;
    },
  };

  used(githubId: number): Promise<number> {
    return this.counters.get(userKey(githubId));
  }

  claim(githubId: number, day: string, limits: FreeRunLimits): Promise<FreeRunClaim> {
    return claimWith(this.counters, githubId, day, limits);
  }
}

const MAX_ATTEMPTS = 5;

export class DynamoFreeRunStore implements FreeRunStore {
  private readonly counters: Counters;

  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly table: string
  ) {
    const get = async (key: string) => {
      const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: { pk: key, sk: "META" }, ConsistentRead: true }));
      return Number(res.Item?.used ?? 0);
    };
    this.counters = {
      get,
      add: async (key, by, limit) => {
        // Read, then write only if nobody changed it since; on a lost race, read again.
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          const old = await get(key);
          const next = old + by;
          if (next < 0 || next > limit) return false;
          try {
            await this.ddb.send(
              new PutCommand({
                TableName: this.table,
                Item: { pk: key, sk: "META", used: next, updatedAt: new Date().toISOString() },
                ConditionExpression: "attribute_not_exists(pk) OR used = :old",
                ExpressionAttributeValues: { ":old": old },
              })
            );
            return true;
          } catch (err) {
            if (!(err instanceof ConditionalCheckFailedException)) throw err;
          }
        }
        return false;
      },
    };
  }

  used(githubId: number): Promise<number> {
    return this.counters.get(userKey(githubId));
  }

  claim(githubId: number, day: string, limits: FreeRunLimits): Promise<FreeRunClaim> {
    return claimWith(this.counters, githubId, day, limits);
  }
}
