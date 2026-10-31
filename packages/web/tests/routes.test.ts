import { describe, expect, it } from "vitest";
import { pageFromPath, pathForPage } from "../src/maintainer/routes.js";

describe("page routes", () => {
  it("opens the info pages at their own addresses, so they can be linked", () => {
    expect(pageFromPath("/privacy")).toBe("privacy");
    expect(pageFromPath("/terms")).toBe("terms");
    expect(pageFromPath("/about")).toBe("about");
    expect(pageFromPath("/about/")).toBe("about");
  });

  it("opens the app's own pages", () => {
    expect(pageFromPath("/runs")).toBe("runs");
    expect(pageFromPath("/memory")).toBe("memory");
  });

  it("falls back to the issue form for anything else", () => {
    expect(pageFromPath("/")).toBe("maintainer");
    expect(pageFromPath("/nope")).toBe("maintainer");
    expect(pageFromPath("/constructor")).toBe("maintainer");
  });

  it("gives every page an address that opens it again", () => {
    for (const page of ["maintainer", "runs", "memory", "about", "privacy", "terms"] as const) {
      expect(pageFromPath(pathForPage(page))).toBe(page);
    }
  });
});
