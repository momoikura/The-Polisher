import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { MaintainerEvent } from "@thepolisher/agents";
import { initialView, maintainerReducer, type MaintainerView } from "./reducer.js";

export interface MaintainerConfig {
  provider: "simulated" | "anthropic" | "meta";
  isSimulated: boolean;
  isConfigured: boolean;
  model: string;
  setupHint: string | null;
  isSandboxConfigured: boolean;
  /** Whether this visitor can open a PR: as themselves (signed in) or with the server's GITHUB_TOKEN (local). */
  prAccess: PrAccess;
  demoIssueUrl: string | null;
  activeRunId: string | null;
  isAuthEnabled: boolean;
  /** Runs must bring the user's own Meta key (public deployments). */
  requiresUserKey: boolean;
}

export type PrAccess = "ready" | "sign_in" | "set_token";

export type PrState = { kind: "idle" } | { kind: "opening" } | { kind: "opened"; url: string } | { kind: "error"; message: string };

type Action = { type: "event"; event: MaintainerEvent } | { type: "reset" };

function reducer(view: MaintainerView, action: Action): MaintainerView {
  return action.type === "reset" ? initialView() : maintainerReducer(view, action.event);
}

export function useMaintainer() {
  const [view, dispatch] = useReducer(reducer, undefined, initialView);
  const [config, setConfig] = useState<MaintainerConfig | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isConnectionLost, setIsConnectionLost] = useState(false);
  const [pr, setPr] = useState<PrState>({ kind: "idle" });
  const sourceRef = useRef<EventSource | null>(null);

  const attach = useCallback((id: string) => {
    sourceRef.current?.close();
    dispatch({ type: "reset" });
    setRunId(id);
    setPr({ kind: "idle" });
    setIsConnectionLost(false);
    const source = new EventSource(`/api/maintainer/${id}/events`);
    sourceRef.current = source;
    // The server replays the full history on every (re)connect.
    source.onopen = () => {
      dispatch({ type: "reset" });
      setIsConnectionLost(false);
    };
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as MaintainerEvent;
      dispatch({ type: "event", event });
      if (event.type === "complete") source.close();
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setIsConnectionLost(true);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    fetch("/api/maintainer/config")
      .then((r) => (r.ok ? (r.json() as Promise<MaintainerConfig>) : null))
      .then((c) => {
        if (isCancelled || !c) return;
        setConfig(c);
        if (c.activeRunId) attach(c.activeRunId);
      })
      .catch(() => setConfig(null));
    return () => {
      isCancelled = true;
      sourceRef.current?.close();
    };
  }, [attach]);

  const start = useCallback(
    /** Resolves to whether the run started. */
    async (issueUrl: string, budgetUSD: number, metaApiKey?: string, rememberKey = false): Promise<boolean> => {
      setIsStarting(true);
      setStartError(null);
      try {
        const res = await fetch("/api/maintainer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The key goes with this one request; nothing in the browser keeps it. With
          // rememberKey the server saves it, encrypted, to the signed-in account.
          body: JSON.stringify({ issueUrl, budgetUSD, ...(metaApiKey ? { metaApiKey, rememberKey } : {}) }),
        });
        const data = (await res.json()) as { id?: string; error?: string };
        if (!res.ok || !data.id) {
          setStartError(data.error ?? `Couldn't start the run (HTTP ${res.status}).`);
          return false;
        }
        attach(data.id);
        return true;
      } catch {
        setStartError("Couldn't reach the server. Is the dev server still running?");
        return false;
      } finally {
        setIsStarting(false);
      }
    },
    [attach]
  );

  const openPr = useCallback(async () => {
    if (!runId) return;
    setPr({ kind: "opening" });
    try {
      const res = await fetch(`/api/maintainer/${runId}/pr`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      setPr(res.ok && data.url ? { kind: "opened", url: data.url } : { kind: "error", message: data.error ?? `HTTP ${res.status}` });
    } catch {
      setPr({ kind: "error", message: "Couldn't reach the server." });
    }
  }, [runId]);

  const reset = useCallback(() => {
    sourceRef.current?.close();
    setRunId(null);
    setPr({ kind: "idle" });
    dispatch({ type: "reset" });
  }, []);

  return { view, config, runId, start, reset, startError, isStarting, isConnectionLost, pr, openPr };
}
