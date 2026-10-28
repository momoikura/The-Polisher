import { describe, it, expect } from "vitest";
import { decryptToken, encryptToken } from "../src/server/auth/crypto.js";
import { parseCookies, sessionCookie, clearedCookie } from "../src/server/auth/cookies.js";
import { authorizeUrl, isValidState } from "../src/server/auth/github-oauth.js";
import { checkRunLimits } from "../src/server/auth/limits.js";

const KEY = Buffer.alloc(32, 7).toString("base64url");

describe("token encryption", () => {
  it("round-trips a token", () => {
    const sealed = encryptToken("gho_secret_token", KEY);
    expect(sealed).not.toContain("gho_secret_token");
    expect(decryptToken(sealed, KEY)).toBe("gho_secret_token");
  });

  it("never produces the same ciphertext twice", () => {
    expect(encryptToken("same", KEY)).not.toBe(encryptToken("same", KEY));
  });

  it("refuses tampered data or the wrong key", () => {
    const sealed = encryptToken("gho_secret_token", KEY);
    const parts = sealed.split(".");
    const tampered = [...parts.slice(0, 3), Buffer.from("evil").toString("base64url")].join(".");
    expect(() => decryptToken(tampered, KEY)).toThrow();
    expect(() => decryptToken(sealed, Buffer.alloc(32, 9).toString("base64url"))).toThrow();
  });

  it("rejects a key that isn't 32 bytes", () => {
    expect(() => encryptToken("x", Buffer.alloc(16).toString("base64url"))).toThrow(/32 bytes/);
  });
});

describe("cookies", () => {
  it("parses a Cookie header", () => {
    expect(parseCookies("a=1; tp_session=abc-def; b=x%20y")).toEqual({ a: "1", tp_session: "abc-def", b: "x y" });
    expect(parseCookies(undefined)).toEqual({});
  });

  it("issues a session cookie scripts can't read and other sites can't send", () => {
    const c = sessionCookie("tp_session", "abc", { secure: true, maxAgeSeconds: 60 });
    expect(c).toContain("tp_session=abc");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=60");
    expect(sessionCookie("tp_session", "abc", { secure: false, maxAgeSeconds: 60 })).not.toContain("Secure");
  });

  it("clears a cookie", () => {
    expect(clearedCookie("tp_session", false)).toContain("Max-Age=0");
  });
});

describe("GitHub sign-in", () => {
  it("asks GitHub for exactly the permissions ThePolisher needs", () => {
    const url = new URL(authorizeUrl({ clientId: "Ov23abc", redirectUri: "http://localhost:3000/api/auth/callback", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Ov23abc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback");
    expect(url.searchParams.get("scope")).toBe("read:user public_repo");
    expect(url.searchParams.get("state")).toBe("s1");
  });

  it("only accepts a callback whose state matches the one it sent", () => {
    expect(isValidState("abcdefghijklmnopqrstuv", "abcdefghijklmnopqrstuv")).toBe(true);
    expect(isValidState("abcdefghijklmnopqrstuv", "abcdefghijklmnopqrstuX")).toBe(false);
    expect(isValidState(undefined, "abcdefghijklmnopqrstuv")).toBe(false);
    expect(isValidState("", "")).toBe(false);
  });
});

describe("run limits", () => {
  const limits = { perUserActive: 1, perUserDaily: 3, globalActive: 5 };

  it("lets a user start a run when they're under every limit", () => {
    expect(checkRunLimits({ userActive: 0, userToday: 2, globalActive: 4 }, limits)).toBeNull();
  });

  it("explains which limit stopped a run", () => {
    expect(checkRunLimits({ userActive: 1, userToday: 0, globalActive: 0 }, limits)).toMatch(/already have a run going/);
    expect(checkRunLimits({ userActive: 0, userToday: 3, globalActive: 0 }, limits)).toMatch(/3 runs today/);
    expect(checkRunLimits({ userActive: 0, userToday: 0, globalActive: 5 }, limits)).toMatch(/busy/);
  });
});
