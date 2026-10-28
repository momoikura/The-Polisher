/**
 * GitHub OAuth (web application flow).
 *
 * Scopes: `read:user` to know who signed in, `public_repo` to fork a public repo
 * and open a pull request as that user. Nothing on private repos.
 */

import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const OAUTH_SCOPES = "read:user public_repo";
const MIN_STATE_LENGTH = 16;

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", o.clientId);
  url.searchParams.set("redirect_uri", o.redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", o.state);
  url.searchParams.set("allow_signup", "true");
  return url.toString();
}

/** The `state` round-trip stops someone from finishing a sign-in they didn't start (login CSRF). */
export function isValidState(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received || expected.length < MIN_STATE_LENGTH || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

const TokenSchema = z.object({ access_token: z.string().min(1), scope: z.string().default("") });
const UserSchema = z.object({ login: z.string(), id: z.number(), avatar_url: z.string() });

export interface GitHubIdentity {
  login: string;
  id: number;
  avatarUrl: string;
}

export async function exchangeCode(
  o: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchFn: typeof fetch = fetch
): Promise<{ token: string; scopes: string[] }> {
  const res = await fetchFn("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, code: o.code, redirect_uri: o.redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = TokenSchema.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success) throw new Error("GitHub didn't accept the sign-in code. Try signing in again.");
  return { token: parsed.data.access_token, scopes: parsed.data.scope.split(",").filter(Boolean) };
}

export async function fetchIdentity(token: string, fetchFn: typeof fetch = fetch): Promise<GitHubIdentity> {
  const res = await fetchFn("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = UserSchema.safeParse(await res.json().catch(() => null));
  if (!res.ok || !parsed.success) throw new Error("Couldn't read your GitHub profile.");
  return { login: parsed.data.login, id: parsed.data.id, avatarUrl: parsed.data.avatar_url };
}
