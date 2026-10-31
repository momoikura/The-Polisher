import { describe, expect, it } from "vitest";
import { publicRun, runForViewer } from "../src/server/history.js";
import type { RunRecord } from "../src/server/store/index.js";

const record: RunRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  issueUrl: "https://github.com/o/r/issues/1",
  repo: "o/r",
  issueNumber: 1,
  title: "t",
  status: "clean",
  totalUSD: 0.01,
  model: "muse-spark-1.3-contributor",
  startedAt: "2026-10-31T00:00:00.000Z",
  finishedAt: "2026-10-31T00:01:00.000Z",
  user: "someone",
};

describe("public run data", () => {
  it("never contains who started the run", () => {
    expect(JSON.stringify(publicRun(record))).not.toContain("someone");
    expect(publicRun(record)).not.toHaveProperty("user");
    expect(publicRun(record).repo).toBe("o/r");
  });

  it("tells a signed-in owner the run is theirs, without saying whose it is to anyone else", () => {
    const saved = { record, events: [] };

    expect(runForViewer(saved, "someone").isMine).toBe(true);
    for (const viewer of ["another-person", null]) {
      const shown = runForViewer(saved, viewer);
      expect(shown.isMine).toBe(false);
      expect(JSON.stringify(shown)).not.toContain("someone");
    }
  });

  it("gives a run nobody signed in for no owner, even to a viewer with no login", () => {
    expect(runForViewer({ record: { ...record, user: null }, events: [] }, null).isMine).toBe(false);
  });
});
