/**
 * Which storage the server uses. With THEPOLISHER_TABLE set (plus AWS_REGION and
 * AWS credentials in the environment), run history and shared memory live in
 * DynamoDB; otherwise in local files under the data directory.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { FileExperienceStore, type ExperienceStore } from "@thepolisher/agents";
import { dataDir } from "../http.js";
import { DynamoExperienceStore, DynamoRunStore } from "./dynamo.js";
import { FileRunStore } from "./file-store.js";
import { DynamoMetaKeyStore, MemoryMetaKeyStore, type MetaKeyStore } from "../auth/meta-keys.js";
import { DynamoSessionStore, MemorySessionStore, type SessionStore } from "../auth/sessions.js";
import type { RunStore } from "./types.js";

export type { RunRecord, RunStatus, RunStore, SavedRun } from "./types.js";
export { VerifiedMemory } from "./verified-memory.js";

let ddb: DynamoDBDocumentClient | null = null;
const memories = new Map<string, ExperienceStore>();
let runs: RunStore | null = null;

const table = () => process.env.THEPOLISHER_TABLE?.trim() || null;

/** Whether history and memory are shared through DynamoDB (rather than local files). */
export const isSharedStorage = () => table() !== null;

function client(): DynamoDBDocumentClient {
  ddb ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION?.trim() || "us-east-1" }));
  return ddb;
}

export function runStore(): RunStore {
  const name = table();
  runs ??= name ? new DynamoRunStore(client(), name) : new FileRunStore(dataDir("runs"));
  return runs;
}

let sessions: SessionStore | null = null;

/** Signed-in sessions: in DynamoDB when configured (they survive restarts), otherwise in memory. */
export function sessionStore(): SessionStore {
  const name = table();
  sessions ??= name ? new DynamoSessionStore(client(), name) : new MemorySessionStore();
  return sessions;
}

let metaKeys: MetaKeyStore | null = null;

/** Saved Meta API keys ("Remember my key"): in DynamoDB when configured, otherwise in memory. */
export function metaKeyStore(): MetaKeyStore {
  const name = table();
  metaKeys ??= name ? new DynamoMetaKeyStore(client(), name) : new MemoryMetaKeyStore();
  return metaKeys;
}

/** One instance per provider, so its read cache is shared by every run on this server. */
export function sharedMemory(provider: string): ExperienceStore {
  const name = table();
  let store = memories.get(provider);
  if (!store) {
    store = name ? new DynamoExperienceStore(client(), name, provider) : new FileExperienceStore(dataDir("experience"));
    memories.set(provider, store);
  }
  return store;
}
