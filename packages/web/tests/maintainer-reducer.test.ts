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
    for (const lane of ["code", "ui", "doc", "write"] as const) expect(view.lanes[lane].state).toBe("clean");
  });

  it("shows UIPolish correcting CodePolish in the feed", async () => {
    const view = (await recordRun()).reduce(maintainerReducer, initialView());
    expect(view.feed.some((f) => f.lane === "ui" && f.text.startsWith("→ CodePolish"))).toBe(true);
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
