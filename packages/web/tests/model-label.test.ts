import { describe, it, expect } from "vitest";
import { modelLabel, prettyModel } from "../src/maintainer/model-label.js";
import type { MaintainerConfig } from "../src/maintainer/useMaintainer.js";

const config = (overrides: Partial<MaintainerConfig>): MaintainerConfig =>
  ({ provider: "meta", isConfigured: true, isSimulated: false, model: "muse-spark-1.3", ...overrides }) as MaintainerConfig;

describe("prettyModel", () => {
  it("turns Muse model IDs into readable names", () => {
    expect(prettyModel("muse-spark-1.3")).toBe("Muse Spark 1.3");
    expect(prettyModel("muse-spark-open-1026")).toBe("Muse Spark Open 1026");
  });

  it("leaves other model IDs unchanged", () => {
    expect(prettyModel("claude-opus-5-5")).toBe("claude-opus-5-5");
  });
});

describe("modelLabel", () => {
  it("names the Meta model, flags demo mode and missing keys", () => {
    expect(modelLabel(config({}))).toBe("Muse Spark 1.3");
    expect(modelLabel(config({ isSimulated: true }))).toBe("Demo mode");
    expect(modelLabel(config({ isConfigured: false }))).toBe("Meta key not set");
    expect(modelLabel(null)).toBe("Checking…");
  });
});
