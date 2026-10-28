/**
 * Signed-in sessions. The cookie holds a random id; the store keeps only its
 * SHA-256 hash, so someone who reads the database still can't sign in as anyone.
 * The user's GitHub token is kept encrypted (see crypto.ts).
 */

import { createHash, randomBytes } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export interface AuthSession {
  login: string;
  githubId: number;
  avatarUrl: string;
  /** The GitHub token, encrypted with THEPOLISHER_SESSION_SECRET. */
  tokenSealed: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionStore {
  get(id: string): Promise<AuthSession | null>;
  put(id: string, session: AuthSession): Promise<void>;
  delete(id: string): Promise<void>;
}

export const newSessionId = () => randomBytes(32).toString("base64url");
export const hashSessionId = (id: string) => createHash("sha256").update(id).digest("base64url");

const isLive = (s: AuthSession | null | undefined): s is AuthSession => Boolean(s) && Date.parse(s!.expiresAt) > Date.now();

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AuthSession>();

  async get(id: string): Promise<AuthSession | null> {
    const s = this.sessions.get(hashSessionId(id));
    return isLive(s) ? s : null;
  }

  async put(id: string, session: AuthSession): Promise<void> {
    this.sessions.set(hashSessionId(id), session);
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(hashSessionId(id));
  }
}

export class DynamoSessionStore implements SessionStore {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly table: string
  ) {}

  private key(id: string) {
    return { pk: `SESSION#${hashSessionId(id)}`, sk: "META" };
  }

  async get(id: string): Promise<AuthSession | null> {
    const res = await this.ddb.send(new GetCommand({ TableName: this.table, Key: this.key(id) }));
    const s = res.Item ? (JSON.parse(String(res.Item.data)) as AuthSession) : null;
    return isLive(s) ? s : null;
  }

  async put(id: string, session: AuthSession): Promise<void> {
    // `expires` (epoch seconds) lets DynamoDB's free TTL clean up old sessions if TTL is turned on.
    await this.ddb.send(
      new PutCommand({
        TableName: this.table,
        Item: { ...this.key(id), data: JSON.stringify(session), expires: Math.floor(Date.parse(session.expiresAt) / 1000) },
      })
    );
  }

  async delete(id: string): Promise<void> {
    await this.ddb.send(new DeleteCommand({ TableName: this.table, Key: this.key(id) }));
  }
}
