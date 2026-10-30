/**
 * The run's hard time limit. Model and sandbox calls made through these wrappers
 * stop with a TimeLimitError the moment the signal aborts, so work in flight can't
 * carry a run past its limit. Model calls also get the signal, which cancels the
 * request; a sandbox run is only abandoned (its result may be shared through the
 * client's cache), so it finishes on Modal and is ignored.
 */

import { TimeLimitError } from "@thepolisher/core";
import type { ChatClient } from "../llm/chat-client.js";
import type { SandboxClient } from "./sandbox.js";

export function untilAborted<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new TimeLimitError());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new TimeLimitError());
    signal.addEventListener("abort", stop, { once: true });
    start().then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(signal.aborted ? new TimeLimitError() : error);
      }
    );
  });
}

export function clientUntil(client: ChatClient, signal: AbortSignal): ChatClient {
  return { complete: (messages, options) => untilAborted(signal, () => client.complete(messages, { ...options, signal })) };
}

export function sandboxUntil(sandbox: SandboxClient, signal: AbortSignal): SandboxClient {
  return { validate: (req) => untilAborted(signal, () => sandbox.validate(req)) };
}
