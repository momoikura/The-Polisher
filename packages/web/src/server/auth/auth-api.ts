/**
 * GitHub sign-in:
 *   GET  /api/auth/login     → redirect to GitHub (with a one-time `state`)
 *   GET  /api/auth/callback  → check `state`, swap the code for a token, start a session
 *   GET  /api/auth/me        → who is signed in ({ user: null } if nobody)
 *   POST /api/auth/logout    → end the session
 *   DELETE /api/auth/meta-key → forget the user's saved Meta API key
 *
 * Sign-in is on when GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and
 * THEPOLISHER_SESSION_SECRET are all set. THEPOLISHER_PUBLIC_URL is the site's
 * address (http://localhost:3000 by default); the GitHub OAuth App's callback URL
 * must be that address plus /api/auth/callback.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http.js";
import { metaKeyStore, sessionStore } from "../store/index.js";
import { clearedCookie, parseCookies, sessionCookie } from "./cookies.js";
import { decryptToken, encryptToken } from "./crypto.js";
import { authorizeUrl, exchangeCode, fetchIdentity, isValidState } from "./github-oauth.js";
import { forgetMetaKey, hasMetaKey, loadMetaKey, saveMetaKey } from "./meta-keys.js";
import { newSessionId } from "./sessions.js";

const SESSION_COOKIE = "tp_session";
const STATE_COOKIE = "tp_oauth_state";
const SESSION_DAYS = 7;
const STATE_MAX_AGE_S = 600;

export interface SignedInUser {
  login: string;
  /** GitHub's permanent numeric id; logins can be renamed and reused. */
  githubId: number;
  avatarUrl: string;
  /** The user's own GitHub token, decrypted for this request only. Never sent to the browser. */
  token: string;
}

function config() {
  const publicUrl = (process.env.THEPOLISHER_PUBLIC_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return {
    clientId: process.env.GITHUB_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET?.trim() ?? "",
    sessionSecret: process.env.THEPOLISHER_SESSION_SECRET?.trim() ?? "",
    publicUrl,
    redirectUri: `${publicUrl}/api/auth/callback`,
    secure: publicUrl.startsWith("https://"),
  };
}

export function isAuthEnabled(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.sessionSecret);
}

/**
 * Requests that change something must come from this site. Browsers always send
 * Origin on such requests; SameSite=Lax cookies are the first line of defence,
 * this is the second.
 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === new URL(config().publicUrl).host;
  } catch {
    return false;
  }
}

/** The signed-in user for this request, or null. */
export async function currentUser(req: IncomingMessage): Promise<SignedInUser | null> {
  if (!isAuthEnabled()) return null;
  const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!id) return null;
  const session = await sessionStore().get(id);
  if (!session) return null;
  try {
    return {
      login: session.login,
      githubId: session.githubId,
      avatarUrl: session.avatarUrl,
      token: decryptToken(session.tokenSealed, config().sessionSecret),
    };
  } catch {
    // The secret changed or the record was tampered with: treat as signed out.
    return null;
  }
}

/** The user's saved Meta API key, for server-side use only, or null. */
export function savedMetaKey(user: SignedInUser): Promise<string | null> {
  return loadMetaKey(metaKeyStore(), config().sessionSecret, user.githubId);
}

/** Remember the user's Meta API key ("Remember my key"). */
export function rememberMetaKey(user: SignedInUser, key: string): Promise<void> {
  return saveMetaKey(metaKeyStore(), config().sessionSecret, user.githubId, key);
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  res.statusCode = 302;
  res.setHeader("Location", location);
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end();
}

export async function handleAuthRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const [url, query = ""] = (req.url ?? "").split("?");
  const c = config();

  if (req.method === "GET" && url === "/api/auth/me") {
    const user = await currentUser(req);
    sendJson(res, 200, {
      enabled: isAuthEnabled(),
      // Whether a key is saved, never the key itself.
      user: user ? { login: user.login, avatarUrl: user.avatarUrl, hasSavedKey: await hasMetaKey(metaKeyStore(), user.githubId) } : null,
    });
    return true;
  }

  if (!isAuthEnabled()) {
    if (url.startsWith("/api/auth/")) {
      sendJson(res, 404, { error: "Sign-in isn't configured on this server." });
      return true;
    }
    return false;
  }

  if (req.method === "GET" && url === "/api/auth/login") {
    const state = randomBytes(24).toString("base64url");
    redirect(res, authorizeUrl({ clientId: c.clientId, redirectUri: c.redirectUri, state }), [
      sessionCookie(STATE_COOKIE, state, { secure: c.secure, maxAgeSeconds: STATE_MAX_AGE_S }),
    ]);
    return true;
  }

  if (req.method === "GET" && url === "/api/auth/callback") {
    const params = new URLSearchParams(query);
    const fail = (message: string) =>
      redirect(res, `/?auth_error=${encodeURIComponent(message)}`, [clearedCookie(STATE_COOKIE, c.secure)]);
    if (params.get("error")) return fail("GitHub sign-in was cancelled."), true;
    const code = params.get("code");
    if (!code || !isValidState(parseCookies(req.headers.cookie)[STATE_COOKIE], params.get("state") ?? undefined)) {
      return fail("That sign-in link expired or didn't come from here. Please sign in again."), true;
    }
    try {
      const { token } = await exchangeCode({ clientId: c.clientId, clientSecret: c.clientSecret, code, redirectUri: c.redirectUri });
      const who = await fetchIdentity(token);
      const id = newSessionId();
      const now = Date.now();
      await sessionStore().put(id, {
        login: who.login,
        githubId: who.id,
        avatarUrl: who.avatarUrl,
        tokenSealed: encryptToken(token, c.sessionSecret),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_DAYS * 86_400_000).toISOString(),
      });
      redirect(res, "/", [
        clearedCookie(STATE_COOKIE, c.secure),
        sessionCookie(SESSION_COOKIE, id, { secure: c.secure, maxAgeSeconds: SESSION_DAYS * 86_400 }),
      ]);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Sign-in failed.");
    }
    return true;
  }

  if (req.method === "DELETE" && url === "/api/auth/meta-key") {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: "Cross-site request refused." });
      return true;
    }
    const user = await currentUser(req);
    if (!user) {
      sendJson(res, 401, { error: "Sign in to manage your saved key." });
      return true;
    }
    await forgetMetaKey(metaKeyStore(), user.githubId);
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Signing out ends the session only; a saved Meta key stays until the user chooses Forget.
  if (req.method === "POST" && url === "/api/auth/logout") {
    if (!isSameOrigin(req)) {
      sendJson(res, 403, { error: "Cross-site request refused." });
      return true;
    }
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (id) await sessionStore().delete(id);
    res.statusCode = 204;
    res.setHeader("Set-Cookie", clearedCookie(SESSION_COOKIE, c.secure));
    res.end();
    return true;
  }

  return false;
}
