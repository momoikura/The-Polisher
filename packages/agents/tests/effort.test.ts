import { describe, expect, it } from "vitest";
import { codeRepairEffort } from "../src/maintainer/effort.js";

describe("codeRepairEffort", () => {
  it("starts CodePolish at low reasoning and thinks harder only once a revision was rejected", () => {
    expect(codeRepairEffort("normal")).toBe("low");
    expect(codeRepairEffort("rethink")).toBeUndefined();
    expect(codeRepairEffort("minimal")).toBeUndefined();
  });
});
