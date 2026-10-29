/**
 * Bundles the production API server (src/server/main.ts) and everything it
 * imports into one file, dist-server/server.mjs, so the Modal image needs only
 * Node and this file. Build @thepolisher/core and @thepolisher/agents first.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(webRoot, "src/server/main.ts")],
  outfile: path.join(webRoot, "dist-server/server.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Some bundled dependencies are CommonJS and call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
