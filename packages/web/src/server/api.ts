/**
 * API router for the dev server. All model calls, GitHub tokens and sandbox
 * tokens stay server-side; the browser only ever sees artifacts and metrics.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { handleExperienceRequest } from "./experience-api.js";
import { handleAuthRequest } from "./auth/auth-api.js";
import { handleHistoryRequest } from "./history.js";
import { handleMaintainerRequest } from "./maintainer-api.js";

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? "";
  if (url.startsWith("/api/auth/")) return handleAuthRequest(req, res);
  if (url.startsWith("/api/maintainer")) return handleMaintainerRequest(req, res);
  if (url.startsWith("/api/experience")) return handleExperienceRequest(req, res);
  if (url.startsWith("/api/runs")) return handleHistoryRequest(req, res);
  return false;
}
