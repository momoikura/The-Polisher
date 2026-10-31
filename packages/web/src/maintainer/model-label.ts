import type { MaintainerConfig } from "./useMaintainer.js";

/** "muse-spark-1.3" → "Muse Spark 1.3"; other IDs pass through unchanged. */
export function prettyModel(model: string): string {
  if (!model.startsWith("muse-")) return model;
  return model
    .split("-")
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/** What the agents run on, in words a judge or user reads at a glance. */
export function modelLabel(config: MaintainerConfig | null): string {
  if (!config) return "Checking…";
  if (config.isSimulated) return "Demo mode";
  if (!config.isConfigured) return "Meta key not set";
  return prettyModel(config.model);
}
