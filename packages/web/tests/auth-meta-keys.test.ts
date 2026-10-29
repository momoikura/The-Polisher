import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src/server/auth/crypto.js";
import { MemoryMetaKeyStore, forgetMetaKey, hasMetaKey, loadMetaKey, saveMetaKey } from "../src/server/auth/meta-keys.js";

const secret = randomBytes(32).toString("base64url");

describe("encryption bound to a context", () => {
  it("decrypts only with the same context", () => {
    const sealed = encryptToken("value", secret, "meta-key:1");

    expect(decryptToken(sealed, secret, "meta-key:1")).toBe("value");
    expect(() => decryptToken(sealed, secret, "meta-key:2")).toThrow();
    expect(() => decryptToken(sealed, secret)).toThrow();
  });

  it("still reads tokens sealed without a context (existing sessions)", () => {
    expect(decryptToken(encryptToken("gho_x", secret), secret)).toBe("gho_x");
  });
});

describe("saved Meta keys", () => {
  it("saves, loads and forgets a key for one GitHub account", async () => {
    const store = new MemoryMetaKeyStore();

    await saveMetaKey(store, secret, 42, "meta-key-123456");

    expect(await hasMetaKey(store, 42)).toBe(true);
    expect(await loadMetaKey(store, secret, 42)).toBe("meta-key-123456");
    expect(await loadMetaKey(store, secret, 43)).toBeNull();

    await forgetMetaKey(store, 42);

    expect(await hasMetaKey(store, 42)).toBe(false);
    expect(await loadMetaKey(store, secret, 42)).toBeNull();
  });

  it("stores the key encrypted, never as plain text", async () => {
    const store = new MemoryMetaKeyStore();

    await saveMetaKey(store, secret, 42, "meta-key-123456");

    const sealed = await store.get(42);
    expect(sealed).not.toContain("meta-key-123456");
  });

  it("won't decrypt a record copied onto another account", async () => {
    const store = new MemoryMetaKeyStore();
    await saveMetaKey(store, secret, 42, "meta-key-123456");

    await store.put(43, (await store.get(42))!);

    expect(await loadMetaKey(store, secret, 43)).toBeNull();
  });

  it("treats a key sealed under an old secret as not saved", async () => {
    const store = new MemoryMetaKeyStore();
    await saveMetaKey(store, randomBytes(32).toString("base64url"), 42, "meta-key-123456");

    expect(await loadMetaKey(store, secret, 42)).toBeNull();
  });
});
