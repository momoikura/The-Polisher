import { describe, expect, it } from "vitest";
import { unsupportedRepo } from "../src/maintainer/orchestrator.js";

describe("which repos it can work on", () => {
  it("takes a Python repo with pytest tests", () => {
    expect(unsupportedRepo(["pkg/__init__.py", "tests/test_pkg.py"])).toBeNull();
    expect(unsupportedRepo(["src/pkg/core.py", "pkg/core_test.py"])).toBeNull();
    expect(unsupportedRepo(["pkg/core.py", "pytest.ini", "checks/check_core.py"])).toBeNull();
  });

  it("says plainly when there's no Python", () => {
    expect(unsupportedRepo(["src/main.ts", "README.md"])).toContain("no Python files");
  });

  it("stops before spending anything on a repo with no tests to prove a fix", () => {
    // microsoft/pylance-release: Python sample files, but it's an issue tracker with no pytest suite.
    const message = unsupportedRepo(["testing/single/src/completion.py", "testing/scikitlearn/test.py", "README.md"]);
    expect(message).toContain("no pytest tests");
  });

  it("doesn't count a data file in a tests folder as a test", () => {
    expect(unsupportedRepo(["pkg/core.py", "tests/fixtures/data.json"])).toContain("no pytest tests");
  });
});
