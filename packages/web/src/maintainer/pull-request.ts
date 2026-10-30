import type { PrState } from "./useMaintainer.js";

/** Asks the server to open the run's pull request; used by the live run and by saved runs. */
export async function requestPullRequest(runId: string): Promise<PrState> {
  try {
    const res = await fetch(`/api/maintainer/${runId}/pr`, { method: "POST" });
    const data = (await res.json()) as { url?: string; error?: string };
    return res.ok && data.url ? { kind: "opened", url: data.url } : { kind: "error", message: data.error ?? `HTTP ${res.status}` };
  } catch {
    return { kind: "error", message: "Couldn't reach the server." };
  }
}
