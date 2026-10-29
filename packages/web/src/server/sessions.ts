/**
 * Background runs with an event log that Server-Sent Events replay on
 * (re)connect. How many can run at once is decided by the run limits
 * (auth/limits.ts); finished runs are also saved to the run history.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

type Timed = { type: string; at: number };

export interface Session<E extends Timed, R> {
  id: string;
  events: E[];
  listeners: Set<(event: E | null) => void>;
  isDone: boolean;
  result: R | null;
  /** Free-form per-session state for follow-up actions (e.g. the opened PR). */
  meta: Record<string, unknown>;
}

/** Finished runs kept in memory for live reattach; older ones are replayed from the run history. */
const MAX_SESSIONS = 50;

export class SessionRegistry<E extends Timed, R> {
  private readonly sessions = new Map<string, Session<E, R>>();

  get(id: string): Session<E, R> | undefined {
    return this.sessions.get(id);
  }

  active(): Session<E, R> | undefined {
    return [...this.sessions.values()].find((s) => !s.isDone);
  }

  /** Every run still going, for per-user and global limits. */
  activeSessions(): Session<E, R>[] {
    return [...this.sessions.values()].filter((s) => !s.isDone);
  }

  start(run: (publish: (event: E) => void) => Promise<R>, onCrash: (message: string) => E): Session<E, R> {
    const session: Session<E, R> = { id: crypto.randomUUID(), events: [], listeners: new Set(), isDone: false, result: null, meta: {} };
    this.sessions.set(session.id, session);
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].find((s) => s.isDone);
      if (!oldest) break;
      this.sessions.delete(oldest.id);
    }

    const publish = (event: E) => {
      session.events.push(event);
      for (const listener of session.listeners) listener(event);
    };

    void run(publish)
      .then((result) => {
        session.result = result;
      })
      .catch((err: unknown) => publish(onCrash(err instanceof Error ? err.message : String(err))))
      .finally(() => {
        session.isDone = true;
        for (const listener of session.listeners) listener(null);
        session.listeners.clear();
      });

    return session;
  }

  stream(req: IncomingMessage, res: ServerResponse, session: Session<E, R>): void {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    const write = (event: E) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    session.events.forEach(write);
    if (session.isDone) {
      res.end();
      return;
    }
    const listener = (event: E | null) => (event ? write(event) : res.end());
    session.listeners.add(listener);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      session.listeners.delete(listener);
    });
  }
}
