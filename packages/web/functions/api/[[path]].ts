/**
 * Cloudflare Pages Function: forwards every /api/* request to the API server on
 * Modal. The browser only ever talks to the Pages address, so session cookies
 * are first-party and SameSite=Lax keeps working.
 *
 * Pages settings (encrypted environment variables):
 *   BACKEND_URL   the Modal web URL, e.g. https://<workspace>--thepolisher-web-api.modal.run
 *   PROXY_SECRET  the same value as THEPOLISHER_PROXY_SECRET in the Modal secret
 */

interface Env {
  BACKEND_URL: string;
  PROXY_SECRET: string;
}

interface Context {
  request: Request;
  env: Env;
}

/** Modal answers requests that run past 150 s with a 303 to its own result URL. */
const MODAL_LONG_REQUEST_STATUS = 303;
const MAX_HOPS = 20;

export async function onRequest({ request, env }: Context): Promise<Response> {
  if (!env.BACKEND_URL || !env.PROXY_SECRET) {
    return Response.json({ error: "The site isn't connected to its server yet." }, { status: 503 });
  }
  const backend = new URL(env.BACKEND_URL);
  const incoming = new URL(request.url);
  let target = new URL(incoming.pathname + incoming.search, backend);

  const headers = new Headers(request.headers);
  headers.set("x-thepolisher-proxy", env.PROXY_SECRET.trim());
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    // "manual" so the app's own redirects (GitHub sign-in) reach the browser with their cookies.
    const response = await fetch(target, { method: request.method, headers, body, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status === MODAL_LONG_REQUEST_STATUS && location) {
      const next = new URL(location, target);
      // Follow Modal's own wait-for-result redirect here, so the browser never sees the backend address.
      if (next.origin === backend.origin) {
        target = next;
        continue;
      }
    }
    return response;
  }
  return Response.json({ error: "The server took too long to answer." }, { status: 504 });
}
