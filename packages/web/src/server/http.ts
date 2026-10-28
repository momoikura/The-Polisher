import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  ClaudeChatClient,
  GitHubClient,
  MetaModelClient,
  ModalSandboxClient,
  chatClientFromMeta,
  createSimulatedMaintainerClient,
  createSimulatedSandbox,
  isClaudeConfigured,
  resolveClaudeConfig,
  type ChatClient,
  type SandboxClient,
} from "@polishloop/agents";

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`Request body is larger than ${Math.round(maxBytes / 1024)} KB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

const MIN_STUDIO_TIMEOUT_MS = 120_000;

export const isSimulated = () => process.env.POLISHLOOP_SIMULATE === "1";

export function metaClient(): MetaModelClient {
  const envTimeout = Number(process.env.MODEL_TIMEOUT_MS) || 0;
  return new MetaModelClient({ timeoutMs: Math.max(envTimeout, MIN_STUDIO_TIMEOUT_MS) });
}

export type Provider = "simulated" | "anthropic" | "meta";

/** POLISHLOOP_SIMULATE=1 wins; otherwise MODEL_PROVIDER picks Claude ("anthropic"/"claude") or Meta (default). */
export function activeProvider(): Provider {
  if (isSimulated()) return "simulated";
  const chosen = (process.env.MODEL_PROVIDER ?? "meta").trim().toLowerCase();
  return chosen === "anthropic" || chosen === "claude" ? "anthropic" : "meta";
}

export interface ProviderStatus {
  provider: Provider;
  isConfigured: boolean;
  model: string;
  /** Plain-language fix when not configured. */
  setupHint: string | null;
}

export function providerStatus(): ProviderStatus {
  const provider = activeProvider();
  if (provider === "simulated") return { provider, isConfigured: true, model: "simulated", setupHint: null };
  if (provider === "anthropic") {
    const isConfigured = isClaudeConfigured();
    return {
      provider,
      isConfigured,
      model: resolveClaudeConfig().model,
      setupHint: isConfigured ? null : "Set ANTHROPIC_API_KEY in .env at the repo root and restart the dev server.",
    };
  }
  const meta = metaClient();
  return {
    provider,
    isConfigured: meta.isConfigured(),
    model: meta.getModelId(),
    setupHint: meta.isConfigured()
      ? null
      : "Set MODEL_BASE_URL, MODEL_API_KEY and MODEL_ID in .env at the repo root (or MODEL_PROVIDER=anthropic with ANTHROPIC_API_KEY) and restart the dev server.",
  };
}

/** The model to use, or null when none is configured. */
export function modelClientOrNull(): ChatClient | null {
  switch (activeProvider()) {
    case "simulated":
      return createSimulatedMaintainerClient();
    case "anthropic":
      return isClaudeConfigured() ? new ClaudeChatClient() : null;
    case "meta": {
      const meta = metaClient();
      return meta.isConfigured() ? chatClientFromMeta(meta) : null;
    }
  }
}

let sandboxClient: { key: string; client: ModalSandboxClient } | null = null;

/** Real test runs on Modal when SANDBOX_URL + SANDBOX_TOKEN are set; simulated in demo mode. */
export function sandboxClientOrNull(): SandboxClient | null {
  if (isSimulated()) return createSimulatedSandbox();
  const url = process.env.SANDBOX_URL?.trim();
  const token = process.env.SANDBOX_TOKEN?.trim();
  if (!url || !token) return null;
  const key = `${url}\n${token}`;
  if (sandboxClient?.key !== key) {
    try {
      sandboxClient = { key, client: new ModalSandboxClient({ url, token }) };
    } catch {
      return null;
    }
  }
  return sandboxClient.client;
}

export function githubClient(): GitHubClient {
  return new GitHubClient({ token: process.env.GITHUB_TOKEN?.trim() || undefined });
}

/** Repo-level data folder; vite.config sets POLISHLOOP_ROOT. */
export function dataDir(...parts: string[]): string {
  return path.join(process.env.POLISHLOOP_ROOT ?? process.cwd(), "data", ...parts);
}
