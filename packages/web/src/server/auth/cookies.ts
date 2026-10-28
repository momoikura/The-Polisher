/**
 * Session cookies are HttpOnly (page scripts can't read them, which blunts XSS),
 * SameSite=Lax (other sites' forms and fetches don't carry them, which blunts
 * CSRF) and Secure once the site is served over HTTPS.
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    try {
      out[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // A malformed cookie from somewhere else on the domain; ignore it.
    }
  }
  return out;
}

export function sessionCookie(name: string, value: string, opts: { secure: boolean; maxAgeSeconds: number }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${opts.maxAgeSeconds}`,
    ...(opts.secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearedCookie(name: string, secure: boolean): string {
  return sessionCookie(name, "", { secure, maxAgeSeconds: 0 });
}
