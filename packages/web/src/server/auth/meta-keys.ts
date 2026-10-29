/**
 * Saved Meta API keys ("Remember my key", opt-in). One per GitHub account, keyed
 * by the numeric GitHub id rather than the login, which can be renamed and later
 * taken by someone else. Encrypted like GitHub tokens (crypto.ts) and bound to
 * that id, so a record copied onto another account won't decrypt. A saved key is
 * only ever used server-side; it is never sent back to the browser.
 */

import { DeleteCommand, GetCommand, PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { decryptToken, encryptToken } from "./crypto.js";

export interface MetaKeyStore {
  /** The sealed key, or null. */
  get(githubId: number): Promise<string | null>;
  put(githubId: number, sealed: string): Promise<void>;
  delete(githubId: number): Promise<void>;
}

export class MemoryMetaKeyStore implements MetaKeyStore {
  private readonly keys = new Map<number, string>();

  async get(githubId: number): Promise<string | null> {
    return this.keys.get(githubId) ?? null;
  }

  async put(githubId: number, sealed: string): Promise<void> {
    this.keys.set(githubId, sealed);
  }

  async delete(githubId: number): Promise<void> {
    this.keys.delete(githubId);
  }
}

export class DynamoMetaKeyStore implements MetaKeyStore {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly table: string
  ) {}

  private key(githubId: number) {
    return { pk: `METAKEY#${githubId}`, sk: "META" };
  }

  async get(githubId: number): Promise<string | null> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: this.key(githubId) }));
    return res.Item ? String(res.Item.data) : null;
  }

  async put(githubId: number, sealed: string): Promise<void> {
    await this.ddb.send(
      new PutCommand({ TableName: this.table, Item: { ...this.key(githubId), data: sealed, updatedAt: new Date().toISOString() } })
    );
  }

  async delete(githubId: number): Promise<void> {
    await this.ddb.send(new DeleteCommand({ TableName: this.table, Key: this.key(githubId) }));
  }
}

const context = (githubId: number) => `meta-key:${githubId}`;

export async function saveMetaKey(store: MetaKeyStore, secret: string, githubId: number, key: string): Promise<void> {
  await store.put(githubId, encryptToken(key, secret, context(githubId)));
}

/** The saved key, or null if none, or if it can't be decrypted (secret changed, record moved). */
export async function loadMetaKey(store: MetaKeyStore, secret: string, githubId: number): Promise<string | null> {
  const sealed = await store.get(githubId);
  if (!sealed) return null;
  try {
    return decryptToken(sealed, secret, context(githubId));
  } catch {
    return null;
  }
}

export async function hasMetaKey(store: MetaKeyStore, githubId: number): Promise<boolean> {
  return (await store.get(githubId)) !== null;
}

export async function forgetMetaKey(store: MetaKeyStore, githubId: number): Promise<void> {
  await store.delete(githubId);
}
