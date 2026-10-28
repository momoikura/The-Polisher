import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoSessionStore, MemorySessionStore, hashSessionId, newSessionId, type AuthSession } from "../src/server/auth/sessions.js";

const session = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  login: "momoikura",
  githubId: 42,
  avatarUrl: "https://avatars.githubusercontent.com/u/42",
  tokenSealed: "v1.a.b.c",
  createdAt: "2026-10-29T00:00:00.000Z",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  ...overrides,
});

describe("session ids", () => {
  it("are long and random", () => {
    const a = newSessionId();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(newSessionId()).not.toBe(a);
  });

  it("are stored only as a hash, so a database leak can't be used to sign in", () => {
    const id = newSessionId();
    expect(hashSessionId(id)).not.toContain(id);
    expect(hashSessionId(id)).toBe(hashSessionId(id));
  });
});

describe("MemorySessionStore", () => {
  it("saves, finds and deletes a session", async () => {
    const store = new MemorySessionStore();
    const id = newSessionId();
    await store.put(id, session());
    expect((await store.get(id))?.login).toBe("momoikura");
    await store.delete(id);
    expect(await store.get(id)).toBeNull();
  });

  it("treats an expired session as signed out", async () => {
    const store = new MemorySessionStore();
    const id = newSessionId();
    await store.put(id, session({ expiresAt: new Date(Date.now() - 1).toISOString() }));
    expect(await store.get(id)).toBeNull();
  });
});

describe("DynamoSessionStore", () => {
  const ddb = mockClient(DynamoDBDocumentClient);
  beforeEach(() => ddb.reset());

  it("keys the session by the hash of its id, never the id itself", async () => {
    ddb.on(PutCommand).resolves({});
    const id = newSessionId();
    await new DynamoSessionStore(ddb as unknown as DynamoDBDocumentClient, "thepolisher").put(id, session());
    const item = ddb.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.pk).toBe(`SESSION#${hashSessionId(id)}`);
    expect(JSON.stringify(item)).not.toContain(id);
  });

  it("treats an expired session as signed out", async () => {
    ddb.on(GetCommand).resolves({ Item: { data: JSON.stringify(session({ expiresAt: "2000-01-01T00:00:00.000Z" })) } });
    expect(await new DynamoSessionStore(ddb as unknown as DynamoDBDocumentClient, "thepolisher").get(newSessionId())).toBeNull();
  });
});
