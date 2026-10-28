import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleApiRequest } from "./src/server/api.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function polishLoopApiPlugin(): Plugin {
  return {
    name: "polishloop-api-plugin",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith("/api/")) {
          try {
            const handled = await handleApiRequest(req, res);
            if (handled) return;
          } catch (err: unknown) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            const message = err instanceof Error ? err.message : String(err);
            res.end(JSON.stringify({ error: message }));
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Server-only: the API middleware reads MODEL_* from process.env. Nothing here reaches the browser bundle.
  const env = loadEnv(mode, repoRoot, "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  if (mode === "sim") process.env.POLISHLOOP_SIMULATE = "1";
  process.env.POLISHLOOP_ROOT ??= repoRoot;

  return {
    plugins: [react(), polishLoopApiPlugin()],
    server: {
      port: 3000,
      open: false,
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
