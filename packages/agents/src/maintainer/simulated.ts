/**
 * Scripted Auto-Maintainer demo: a tiny Python repo with a real bug, plus
 * scripted model and sandbox replies. The orchestrator, gate, checks and
 * memory run for real; only model text and test results are scripted.
 */

import type { ChatClient } from "../llm/chat-client.js";
import { textOf } from "../llm/meta-client.js";
import { serializeFiles, type FileMap, type RepoSnapshot } from "./bundle.js";
import type { SandboxClient, Validation } from "./sandbox.js";

export const DEMO_ISSUE_URL = "https://github.com/polishloop-demo/tinyslug/issues/7";

const SRC = "tinyslug/__init__.py";
const TESTS = "tests/test_slugify.py";

const BASE_SRC = `"""Turn titles into URL slugs."""

import re

__all__ = ["slugify"]


def slugify(text, separator="-"):
    """Return a lowercase slug for \`\`text\`\`."""
    text = text.strip().lower()
    return re.sub(r"\\s+", separator, text)
`;

const BASE_TESTS = `from tinyslug import slugify


def test_spaces_become_dashes():
    assert slugify("hello world") == "hello-world"


def test_custom_separator():
    assert slugify("a b", separator="_") == "a_b"
`;

const README = `# tinyslug

Turn titles into URL slugs.

\`\`\`python
from tinyslug import slugify

slugify("hello world")  # "hello-world"
\`\`\`
`;

const CHANGELOG = `# Changelog

## 0.2.0

- Added custom separators.
`;

export const DEMO_SNAPSHOT: RepoSnapshot = {
  owner: "polishloop-demo",
  repo: "tinyslug",
  defaultBranch: "main",
  sha: "3f2c1a9",
  issue: {
    number: 7,
    title: "slugify keeps punctuation",
    body: 'slugify("Hello, World!") returns "hello,-world!" but should return "hello-world".\n\nAlso, passing separator="" silently glues words together.',
    url: DEMO_ISSUE_URL,
  },
  tree: [SRC, TESTS, "README.md", "CHANGELOG.md", "pyproject.toml"],
  files: { [SRC]: BASE_SRC, [TESTS]: BASE_TESTS, "README.md": README, "CHANGELOG.md": CHANGELOG },
};

// ─── Versions the scripted agents produce ─────────────────────────────────

const BASELINE_CODE: FileMap = {
  [SRC]: BASE_SRC.replace(
    '    text = text.strip().lower()\n',
    '    print("slugifying", text)\n    if not separator:\n        raise ValueError()\n    text = text.strip().lower().replace(",", "")\n'
  ),
  [TESTS]: `${BASE_TESTS}

def test_lowercase():
    assert slugify("ABC") == "abc"
`,
};

const FIXED_SRC_NO_MESSAGE = `"""Turn titles into URL slugs."""

import re

__all__ = ["slugify"]


def slugify(text, separator="-"):
    """Return a lowercase, URL-safe slug for \`\`text\`\`.

    Punctuation is dropped and runs of whitespace collapse into one separator.
    """
    if not separator:
        raise ValueError()
    words = re.findall(r"[a-z0-9]+", text.lower())
    return separator.join(words)
`;

const FIXED_SRC = FIXED_SRC_NO_MESSAGE.replace(
  "raise ValueError()",
  "raise ValueError(\"separator must be a non-empty string, e.g. '-' or '_'\")"
);

const CODE_BAD: FileMap = {
  [SRC]: FIXED_SRC_NO_MESSAGE,
  [TESTS]: `from tinyslug import slugify


def test_spaces_become_dashes():
    assert slugify("hello world") == "hello-world"


def test_punctuation_is_removed():
    assert slugify("Hello, World!") == "hello-world"
`,
};

const CODE_MID: FileMap = {
  [SRC]: FIXED_SRC_NO_MESSAGE,
  [TESTS]: `${BASE_TESTS}

def test_punctuation_is_removed():
    assert slugify("Hello, World!") == "hello-world"


def test_repeated_whitespace_collapses():
    assert slugify("a   b") == "a-b"
`,
};

const CODE_FINAL: FileMap = {
  [SRC]: FIXED_SRC,
  [TESTS]: `import pytest

${BASE_TESTS}

def test_punctuation_is_removed():
    assert slugify("Hello, World!") == "hello-world"


def test_repeated_whitespace_collapses():
    assert slugify("a   b") == "a-b"


def test_empty_separator_is_rejected():
    with pytest.raises(ValueError, match="non-empty"):
        slugify("a b", separator="")
`,
};

const BASELINE_DOCS: FileMap = {
  "README.md": `${README}
## Features

- Blazing-fast slug generation with \`normalize()\` support.
`,
};

const DOCS_FINAL: FileMap = {
  "CHANGELOG.md": CHANGELOG.replace(
    "## 0.2.0",
    "## Unreleased\n\n- `slugify()` now drops punctuation, so `\"Hello, World!\"` becomes `\"hello-world\"` (#7).\n- `slugify()` raises `ValueError` when `separator` is empty.\n\n## 0.2.0"
  ),
};

const BASELINE_PR = `# Fixed stuff!

This PR seamlessly fixes the slug issue. All tests pass.
`;

const PR_MID = `# Drop punctuation in slugify

## Summary

Fixes #7. \`slugify("Hello, World!")\` returned \`hello,-world!\`; it now returns \`hello-world\`.

## Changes

- tinyslug/__init__.py: build the slug from alphanumeric words.
- tests/test_slugify.py: new tests for punctuation and whitespace.
- CHANGELOG.md: note the change.
`;

const PR_FINAL = `${PR_MID.replace(
  "- tinyslug/__init__.py: build the slug from alphanumeric words.",
  "- tinyslug/__init__.py: build the slug from alphanumeric words; reject an empty separator with a clear error."
)}
## Testing

5 tests pass in the sandbox. The three new tests fail on the original code and pass with this change.
`;

const REPAIRS = {
  CodePolish: [
    { files: CODE_BAD, changes: ["Rebuilt slug from alphanumeric words", "Replaced the separator test with a punctuation test"] },
    { files: CODE_MID, changes: ["Restored test_custom_separator", "Added a whitespace-collapsing test"] },
    { files: CODE_FINAL, changes: ["Gave the empty-separator ValueError a message that says how to fix it", "Added a test for the empty separator"] },
  ],
  DocPolish: [
    {
      files: DOCS_FINAL,
      remove: ["README.md"],
      changes: ["Reverted the README edit that promised a non-existent normalize()", "Added an Unreleased CHANGELOG entry"],
    },
  ],
  WritePolish: [
    { text: PR_MID, changes: ['Linked "Fixes #7"', "Listed every changed file"] },
    { text: PR_FINAL, changes: ["Added a Testing section with the sandbox's real results"] },
  ],
} as const;

// ─── Scripted model ───────────────────────────────────────────────────────

type Lane = "CodePolish" | "SecurityPolish" | "DocPolish" | "WritePolish";

function section(text: string, start: string, end?: string): string {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const rest = text.slice(i + start.length);
  const j = end ? rest.indexOf(end) : -1;
  return j >= 0 ? rest.slice(0, j) : rest;
}

function score(lane: Lane, user: string): { score: number; finding?: string } {
  const code = section(user, "Current code + test changes:", "\n\nSandbox:");
  if (lane === "CodePolish") {
    if (code.includes("non-empty string")) return { score: 90 };
    if (code.includes("-def test_custom_separator")) return { score: 82, finding: "An existing test was deleted" };
    if (code.includes("re.findall")) return { score: 80, finding: "No test covers the empty separator the issue mentions" };
    return { score: 45, finding: "Only commas are removed; other punctuation is still kept" };
  }
  if (lane === "SecurityPolish") {
    if (code.includes("non-empty string")) return { score: 91 };
    if (code.includes("raise ValueError()")) return { score: 60, finding: "The separator is untrusted input; reject a non-string or empty value with a clear error before it reaches the slug builder" };
    return { score: 45, finding: "print() echoes every input to stdout, which can leak user data into logs" };
  }
  if (lane === "DocPolish") {
    const docs = section(user, "Documentation changes under review:");
    if (docs.includes("## Unreleased")) return { score: 92 };
    return { score: 35, finding: "README promises normalize(), which does not exist" };
  }
  const pr = section(user, "<artifact>", "</artifact>");
  if (pr.includes("## Testing")) return { score: 93 };
  if (pr.includes("Fixes #7")) return { score: 70, finding: "No Testing section" };
  return { score: 30, finding: "Vague title and no issue link" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSimulatedMaintainerClient(delay: { min: number; max: number } = { min: 500, max: 1200 }): ChatClient {
  const count: Record<Lane, number> = { CodePolish: 0, SecurityPolish: 0, DocPolish: 0, WritePolish: 0 };
  return {
    async complete(messages) {
      await sleep(delay.min + Math.random() * (delay.max - delay.min));
      const system = textOf(messages[0]?.content);
      const user = textOf(messages[messages.length - 1]?.content);
      const reply = (data: unknown) => ({ text: JSON.stringify(data), model: "simulated", promptTokens: 0, completionTokens: 0 });

      if (system.startsWith("PLAN MODE")) {
        return reply({ files: [SRC, TESTS, "README.md", "CHANGELOG.md"], approach: "Build the slug from alphanumeric runs; reject an empty separator; add tests that fail today." });
      }
      if (system.startsWith("BASELINE MODE")) return reply({ code: BASELINE_CODE, docs: BASELINE_DOCS, pr: BASELINE_PR });

      const lane = system.match(/You are (CodePolish|SecurityPolish|DocPolish|WritePolish)/)?.[1] as Lane | undefined;
      if (!lane) return reply({});

      if (system.startsWith("EVALUATOR MODE")) {
        const s = score(lane, user);
        const findings = s.finding
          ? [{ id: "F1", severity: "high", category: "review", description: s.finding, evidence: "(simulated)", recommendedFix: s.finding }]
          : [];
        return reply({ score: s.score, dimensionScores: { correctness: s.score }, findings, criticalFailures: [], requiredFixes: [], recommendedChecks: [] });
      }

      // REPAIR MODE. With verified lessons in the prompt, skip straight to the final version.
      const scripted = REPAIRS[lane as Exclude<Lane, "SecurityPolish">];
      if (user.includes("Worked before for checks failing now")) count[lane] = scripted.length - 1;
      const step = scripted[Math.min(count[lane]++, scripted.length - 1)];
      if ("text" in step) {
        return reply({ candidateArtifact: step.text, changesMade: step.changes, addressedFindingIds: ["F1"], unresolvedIssues: [] });
      }
      return reply({
        files: step.files,
        removeFromPatch: "remove" in step ? step.remove : [],
        changesMade: step.changes,
        addressedFindingIds: ["F1"],
        unresolvedIssues: [],
      });
    },
  };
}

// ─── Scripted sandbox ─────────────────────────────────────────────────────

function validation(total: number, failToPass: Validation["failToPass"]): Validation {
  return {
    install: { ok: true, logTail: "" },
    compile: { ok: true, errors: [] },
    lint: { issues: [] },
    tests: { ran: true, total, passed: total, failed: 0, errors: 0, skipped: 0, failures: [], outputTail: `${total} passed` },
    failToPass,
    security: { ran: true, newIssues: [] },
    durationMs: 1800,
  };
}

const RESULTS = new Map<string, Validation>([
  [serializeFiles(BASELINE_CODE), validation(3, { newTests: [TESTS], failedOnBase: false, passedAfter: true })],
  [serializeFiles(CODE_BAD), validation(2, { newTests: [TESTS], failedOnBase: true, passedAfter: true })],
  [serializeFiles(CODE_MID), validation(4, { newTests: [TESTS], failedOnBase: true, passedAfter: true })],
  [serializeFiles(CODE_FINAL), validation(5, { newTests: [TESTS], failedOnBase: true, passedAfter: true })],
]);

export function createSimulatedSandbox(delay: { min: number; max: number } = { min: 600, max: 1400 }): SandboxClient {
  return {
    async validate(req) {
      await sleep(delay.min + Math.random() * (delay.max - delay.min));
      const known = RESULTS.get(serializeFiles(req.changes));
      if (known) return known;
      return {
        ...validation(0, null),
        tests: { ran: true, total: 0, passed: 0, failed: 0, errors: 1, skipped: 0, failures: [{ test: "collection", message: "simulated sandbox: unknown patch" }], outputTail: "" },
      };
    },
  };
}
