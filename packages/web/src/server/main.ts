/**
 * Production API server. In development the same routes run inside Vite
 * (vite.config.ts). In production this file is bundled into one script
 * (scripts/build-server.mjs) and runs on Modal (deploy/modal_web.py), behind the
 * Cloudflare Pages proxy (functions/api/[[path]].ts), which serves the site and
 * forwards /api/* here on the same origin so session cookies stay first-party.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { handleApiRequest } from "./api.js";
import { sendJson } from "./http.js";

const PORT = Number(process.env.PORT) || 8000;
/** Set by the Cloudflare proxy; requests without it came straight to Modal and are refused. */
const PROXY_HEADER = "x-thepolisher-proxy";

/** Settings the public deployment can't run without. */
const REQUIRED_ENV = [
  "THEPOLISHER_PUBLIC_URL",
  "THEPOLISHER_PROXY_SECRET",
  "THEPOLISHER_SESSION_SECRET",
  "THEPOLISHER_TABLE",
  "AWS_REGION",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "SANDBOX_URL",
  "SANDBOX_TOKEN",
];

const missing = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`ThePolisher can't start: set ${missing.join(", ")} in the Modal secret.`);
  process.exit(1);
}
if (!process.env.THEPOLISHER_PUBLIC_URL!.startsWith("https://")) {
  console.error("ThePolisher can't start: THEPOLISHER_PUBLIC_URL must be an https:// address.");
  process.exit(1);
}

const proxySecret = Buffer.from(process.env.THEPOLISHER_PROXY_SECRET!.trim());

function isFromProxy(header: string | string[] | undefined): boolean {
  if (typeof header !== "string") return false;
  const given = Buffer.from(header);
  return given.length === proxySecret.length && timingSafeEqual(given, proxySecret);
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!isFromProxy(req.headers[PROXY_HEADER])) {
    sendJson(res, 403, { error: "Use the site's address, not the backend's." });
    return;
  }
  try {
    if (path.startsWith("/api/") && (await handleApiRequest(req, res))) return;
    sendJson(res, 404, { error: "Not found." });
  } catch (err: unknown) {
    // Details go to the server log only; the browser gets a plain message.
    console.error(`${req.method} ${path} failed:`, err);
    if (res.headersSent) res.end();
    else sendJson(res, 500, { error: "Something went wrong on the server. Try again in a moment." });
  }
});

// Live run updates (Server-Sent Events) stay open for the whole run.
server.requestTimeout = 0;
server.listen(PORT, "0.0.0.0", () => console.log(`ThePolisher API listening on :${PORT}`));
