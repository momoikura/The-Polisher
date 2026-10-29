import { describe, expect, it } from "vitest";
import { applyEdits, excerpt, issueSymbols } from "../src/maintainer/large-files.js";

const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `x_${tag}_${i} = ${i}`).join("\n");

const source = [
  '"""Big module."""',
  "import functools",
  "",
  filler(200, "a"),
  "",
  "@functools.wraps(len)",
  "def replace(",
  "    iterable,",
  "    pred,",
  "    window_size=1,",
  "):",
  '    """Replace items."""',
  "    if window_size < 1:",
  "        raise ValueError('window_size must be at least 1')",
  "",
  "    return windowed(iterable, window_size)",
  "",
  filler(300, "b"),
  "",
  "class Other:",
  "    def replace(self):",
  "        return 1",
  "",
  filler(300, "c"),
].join("\n");

describe("excerpt", () => {
  it("shows the file header and the whole definition of each focus symbol, with its decorator and multi-line signature", () => {
    const text = excerpt(source, ["replace"]);

    expect(text).toContain('"""Big module."""');
    expect(text).toContain("@functools.wraps(len)\ndef replace(\n    iterable,");
    expect(text).toContain("    return windowed(iterable, window_size)");
    expect(text).toContain("    def replace(self):\n        return 1");
  });

  it("marks what it leaves out, so the model knows the file goes on", () => {
    const text = excerpt(source, ["replace"]);

    expect(text).toMatch(/⋯ lines \d+-\d+ not shown ⋯/);
    expect(text).not.toContain("x_b_150 = 150");
  });

  it("includes the lines around changes already made", () => {
    const lines = source.split("\n");
    const at = lines.indexOf("x_c_150 = 150");

    const text = excerpt(source, [], [at + 1]);

    expect(text).toContain("x_c_150 = 150");
    expect(text).toContain("x_c_145 = 145");
  });

  it("falls back to lines that mention a symbol when it has no definition here", () => {
    const text = excerpt(`${filler(400, "a")}\nresult = windowed(data, 2)\n${filler(400, "b")}`, ["windowed"]);

    expect(text).toContain("result = windowed(data, 2)");
  });

  it("stays within its size budget", () => {
    const huge = Array.from({ length: 3000 }, (_, i) => `def f${i}():\n    return ${"y".repeat(60)}`).join("\n");

    expect(excerpt(huge, Array.from({ length: 3000 }, (_, i) => `f${i}`)).length).toBeLessThan(26_000);
  });
});

describe("applyEdits", () => {
  const files = { "pkg/more.py": "a = 1\nb = 2\nb = 2\nc = 3\n" };

  it("applies an edit whose find text matches exactly once", () => {
    const { files: out, notes } = applyEdits(files, [{ path: "pkg/more.py", find: "a = 1\n", replace: "a = 10\n" }]);

    expect(out["pkg/more.py"]).toBe("a = 10\nb = 2\nb = 2\nc = 3\n");
    expect(notes).toEqual([]);
  });

  it("applies several edits to the same file in order", () => {
    const { files: out } = applyEdits(files, [
      { path: "pkg/more.py", find: "a = 1", replace: "a = 10" },
      { path: "pkg/more.py", find: "c = 3", replace: "c = 30" },
    ]);

    expect(out["pkg/more.py"]).toBe("a = 10\nb = 2\nb = 2\nc = 30\n");
  });

  it("skips an edit that matches more than once and says how to fix it", () => {
    const { files: out, notes } = applyEdits(files, [{ path: "pkg/more.py", find: "b = 2", replace: "b = 20" }]);

    expect(out).toEqual({});
    expect(notes[0]).toMatch(/pkg\/more\.py.*matches 2 places/);
  });

  it("skips an edit whose find text isn't in the file", () => {
    const { notes } = applyEdits(files, [{ path: "pkg/more.py", find: "z = 9", replace: "" }]);

    expect(notes[0]).toMatch(/isn't in the file/);
  });

  it("skips an edit to a file that wasn't loaded", () => {
    const { notes } = applyEdits(files, [{ path: "pkg/other.py", find: "x", replace: "y" }]);

    expect(notes[0]).toMatch(/pkg\/other\.py.*wasn't loaded/);
  });
});

describe("issueSymbols", () => {
  it("picks code names out of the issue: backticked names and calls", () => {
    const names = issueSymbols("replace() yields None", "With `window_size > 1`, `more_itertools.replace()` calls `windowed(...)` and pred(x).");

    expect(names).toEqual(expect.arrayContaining(["replace", "windowed", "pred"]));
    expect(names).not.toContain("window_size > 1");
  });
});
