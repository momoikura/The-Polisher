import { describe, it, expect } from "vitest";
import { runMaintainer } from "../../agents/src/maintainer/orchestrator.js";
import { DEMO_SNAPSHOT, createSimulatedMaintainerClient, createSimulatedSandbox } from "../../agents/src/maintainer/simulated.js";
import type { MaintainerEvent } from "../../agents/src/maintainer/events.js";
import { initialView, maintainerReducer } from "../src/maintainer/reducer.js";

async function recordRun(): Promise<MaintainerEvent[]> {
  const events: MaintainerEvent[] = [];
  await runMaintainer(
    { kind: "snapshot", snapshot: DEMO_SNAPSHOT },
    {
      client: createSimulatedMaintainerClient({ min: 0, max: 0 }),
      sandbox: createSimulatedSandbox({ min: 0, max: 0 }),
      onEvent: (e) => events.push(e),
    }
  );
  return events;
}

describe("maintainerReducer", () => {
  it("turns a real run into the final view, keeping the first draft beside the result", async () => {
    const view = (await recordRun()).reduce(maintainerReducer, initialView());

    expect(view.phase).toBe("done");
    expect(view.result).toMatchObject({ status: "clean", canOpenPr: true });
    expect(view.context?.issue.number).toBe(7);
    expect(view.baseline?.pr).toContain("Fixed stuff");
    expect(view.current?.pr).toContain("Fixes #7");
    expect(view.comparison?.after.provesFix).toBe(true);
    for (const lane of ["code", "security", "doc", "write"] as const) expect(view.lanes[lane].state).toBe("clean");
  });

  it("shows SecurityPolish correcting CodePolish in the feed", async () => {
    const view = (await recordRun()).reduce(maintainerReducer, initialView());
    expect(view.feed.some((f) => f.lane === "security" && f.text.startsWith("→ CodePolish"))).toBe(true);
  });

  it("lists each candidate fix and marks the one the tests chose", () => {
    const view = maintainerReducer(initialView(), {
      type: "candidates",
      candidates: [
        { index: 0, provesFix: false, objectiveFailing: 4, linesAdded: 2, testsPassed: null, testsTotal: null, chosen: false },
        { index: 1, provesFix: true, objectiveFailing: 0, linesAdded: 68, testsPassed: 652, testsTotal: 657, chosen: true },
      ],
      at: 0,
    });
    const texts = view.feed.map((f) => f.text);
    expect(texts[0]).toBe("Tested 2 candidate fixes in parallel; the tests picked candidate 2");
    expect(texts[1]).toBe("Candidate 1: doesn't prove the fix, 4 failing checks, tests not run, +2 lines");
    expect(texts[2]).toBe("Candidate 2 (chosen): proves the fix, all checks pass, 652/657 tests pass, +68 lines");
  });

  it("shows an agent changing approach in the feed", () => {
    const view = maintainerReducer(initialView(), {
      type: "adapt",
      lane: "code",
      round: 4,
      mode: "minimal",
      label: "narrows to the smallest fix for py tests",
      at: 0,
    });
    expect(view.feed.at(-1)).toMatchObject({ lane: "code", text: "Changes approach: narrows to the smallest fix for py tests" });
  });

  it("is deterministic and never mutates the previous view", async () => {
    const events = await recordRun();
    expect(events.reduce(maintainerReducer, initialView())).toEqual(events.reduce(maintainerReducer, initialView()));
    const before = initialView();
    const snapshot = JSON.stringify(before);
    maintainerReducer(before, { type: "lane_state", lane: "code", state: "validating", round: 1, at: 0 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
