/**
 * Experience memory endpoints (scoped to the active provider):
 *   GET    /api/experience   → per-agent summary of what was learned
 *   DELETE /api/experience   → forget this provider's experience (local storage only)
 */

import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { summarizeExperience } from "@thepolisher/agents";
import { activeProvider, dataDir, sendJson } from "./http.js";
import { isSharedStorage, sharedMemory } from "./store/index.js";

export async function handleExperienceRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = (req.url ?? "").split("?")[0];
  if (url !== "/api/experience") return false;
  const provider = activeProvider();

  if (req.method === "GET") {
    const all = await sharedMemory(provider).list();
    sendJson(res, 200, {
      provider,
      total: all.filter((e) => e.provider === provider).length,
      lanes: summarizeExperience(all, provider),
      isShared: isSharedStorage(),
    });
    return true;
  }

  if (req.method === "DELETE") {
    // Shared memory belongs to every user's agents; nobody can wipe it from the app.
    if (isSharedStorage()) {
      sendJson(res, 403, { error: "Shared memory can't be cleared from the app." });
      return true;
    }
    // Rewrite the file without this provider's entries; other providers' memory is untouched.
    const all = await sharedMemory(provider).list();
    const keep = all.filter((e) => e.provider !== provider);
    const file = path.join(dataDir("experience"), "experiences.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""), "utf8");
    sendJson(res, 200, { removed: all.length - keep.length });
    return true;
  }

  return false;
}
