/**
 * Deterministic checks per Auto-Maintainer lane. They look at what the PR
 * adds (the diff against the repo), so existing code is never blamed.
 */

import { computeLineDiff, type TestCheck } from "@thepolisher/core";
import { check, emojiCheck, findEmoji, findSlopPhrases, slopPhraseCheck } from "../slop/shared.js";
import { baseContent, isChangelogPath, isForbiddenPath, isTestPath, mentionsFile, splitPr, type FileMap, type PrBundle, type RepoSnapshot } from "./bundle.js";
import { summarizeValidation, type Validation } from "./sandbox.js";
import { aiCheckboxes, templateHeadings, templatePlaceholders } from "./pr-template.js";

const MAX_ADDED_LINES = 600;

function addedLines(snapshot: RepoSnapshot, path: string, content: string): string[] {
  return computeLineDiff(baseContent(snapshot, path) ?? "", content)
    .filter((c) => c.type === "added")
    .map((c) => c.content);
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

const NEW_TEST_FUNCTION = /^\s*(async\s+)?def\s+test_/;
// An assertion, an expected exception, or a case in a parametrize list (a tuple or pytest.param line).
const TEST_CASE_LINE = /^\s*(assert\b|with\s+pytest\.raises|pytest\.param\(|\(.*\),?\s*$)/;

/**
 * Whether a test file gains a test: a new test function, or more assertions or parametrized cases
 * than it lost (an edited case shows up as one removed and one added line, which isn't new).
 */
function addsTest(snapshot: RepoSnapshot, path: string, content: string): boolean {
  const before = baseContent(snapshot, path) ?? "";
  const changes = computeLineDiff(before, content);
  if (changes.some((c) => c.type === "added" && NEW_TEST_FUNCTION.test(c.content))) return true;
  const casesOnly = /@pytest\.mark\.parametrize/.test(before + content) ? TEST_CASE_LINE : /^\s*(assert\b|with\s+pytest\.raises)/;
  const net = (type: "added" | "removed") => changes.filter((c) => c.type === type && casesOnly.test(c.content)).length;
  return net("added") > net("removed");
}
const testNames = (text: string) => [...text.matchAll(/^\s*(?:async\s+)?def\s+(test_\w+)/gm)].map((m) => m[1]);

// ─── CodePolish (fix + tests) ─────────────────────────────────────────────

export function codeStaticChecks(code: FileMap, snapshot: RepoSnapshot): TestCheck[] {
  const paths = Object.keys(code);
  const changed = paths.filter((p) => code[p] !== baseContent(snapshot, p));

  const scope: string[] = [];
  if (changed.length === 0) scope.push("the patch changes no files");
  for (const p of paths) {
    if (isForbiddenPath(p)) scope.push(`${p} may not be changed by an agent`);
    else if (!/\.pyi?$/.test(p)) scope.push(`${p} is not a Python file (docs belong to DocPolish)`);
  }
  const totalAdded = changed.reduce((n, p) => n + addedLines(snapshot, p, code[p]).length, 0);
  if (totalAdded > MAX_ADDED_LINES) scope.push(`${totalAdded} added lines; keep the fix focused (max ${MAX_ADDED_LINES})`);

  const testFiles = changed.filter(isTestPath);
  const addsTests = testFiles.some((p) => addsTest(snapshot, p, code[p]));

  const intact: string[] = [];
  for (const p of testFiles) {
    const before = baseContent(snapshot, p);
    if (before === null) continue;
    const after = code[p];
    const kept = new Set(testNames(after));
    for (const name of testNames(before)) if (!kept.has(name)) intact.push(`${p}: existing test ${name} was removed`);
    if (count(after, /\bassert\b|pytest\.raises/g) < count(before, /\bassert\b|pytest\.raises/g)) intact.push(`${p}: assertions were removed`);
    const added = addedLines(snapshot, p, after).join("\n");
    if (/@pytest\.mark\.(skip|xfail)|pytest\.skip\(/.test(added)) intact.push(`${p}: tests were skipped or marked xfail`);
  }

  const leftovers: string[] = [];
  for (const p of changed.filter((x) => !isTestPath(x))) {
    const added = addedLines(snapshot, p, code[p]).join("\n");
    // print(..., file=...) is deliberate output (a CLI's error message), not a leftover.
    // A file that already prints (an interactive CLI) uses print() as its output, not as debugging.
    const alreadyPrints = /^\s*print\(/m.test(baseContent(snapshot, p) ?? "");
    const isStrayPrint = (line: string) => /^\s*print\(/.test(line) && !/\bfile\s*=/.test(line);
    if (!alreadyPrints && added.split("\n").some(isStrayPrint)) leftovers.push(`${p}: print() left in library code`);
    if (/breakpoint\(\)|import pdb|pdb\.set_trace/.test(added)) leftovers.push(`${p}: debugger call`);
    if (/#\s*(TODO|FIXME|XXX)\b/.test(added)) leftovers.push(`${p}: TODO/FIXME comment`);
  }

  return [
    check("patch_scope", scope, "Patch is focused and only touches Python files."),
    check("tests_included", addsTests ? [] : ["no new test was added (a test function, assertion or parametrized case)"], "Adds at least one new test."),
    check("tests_intact", intact, "No existing tests removed, weakened or skipped."),
    check("debug_leftovers", leftovers, "No debug leftovers in library code."),
  ];
}

// ─── Error messages in the code change (CodePolish) ─────────────────────

const GENERIC_MESSAGE = /raise\s+\w+\(\s*f?(["'])\s*(invalid( input| value| argument)?|error|bad input|failed|something went wrong|oops)[.!]?\s*\1\s*\)/i;

export function uxChecks(code: FileMap, snapshot: RepoSnapshot): TestCheck[] {
  const problems: string[] = [];
  const addedText: string[] = [];
  for (const [p, content] of Object.entries(code)) {
    if (isTestPath(p)) continue;
    const lines = addedLines(snapshot, p, content);
    const text = lines.join("\n");
    addedText.push(text);
    if (/raise\s+\w+(Error|Exception)\(\s*\)/.test(text)) problems.push(`${p}: an exception is raised with no message`);
    if (GENERIC_MESSAGE.test(text)) problems.push(`${p}: an error message says nothing about what went wrong or how to fix it`);
    if (/^\s*except\s*:/m.test(text)) problems.push(`${p}: bare except hides real errors`);
    if (/except[^\n:]*:\s*\n\s*pass\b/.test(text)) problems.push(`${p}: an exception is silently swallowed`);
  }
  const all = addedText.join("\n");
  const slop = findSlopPhrases(all).map((s) => `generic phrase "${s}" in user-facing text`);
  const emoji = findEmoji(all).length ? ["emoji in code or messages"] : [];
  return [check("ux_messages", [...problems, ...slop, ...emoji], "Errors and messages tell people what happened and what to do.")];
}

// ─── DocPolish ────────────────────────────────────────────────────────────

const pythonDefs = (sources: string[]) =>
  new Set(sources.flatMap((s) => [...s.matchAll(/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)|^([A-Z_][A-Z0-9_]*)\s*=/gm)].map((m) => m[1] ?? m[2])));

export function docChecks(docs: FileMap, bundle: PrBundle, snapshot: RepoSnapshot): TestCheck[] {
  const changed = Object.entries(docs).filter(([p, c]) => c !== baseContent(snapshot, p));
  const added = changed.map(([p, c]) => addedLines(snapshot, p, c).join("\n")).join("\n");

  const pySources = [...Object.values(snapshot.files), ...Object.values(bundle.code)].filter(Boolean);
  const defs = pythonDefs(pySources);
  const knownFiles = new Set([...snapshot.tree, ...Object.keys(bundle.code), ...Object.keys(bundle.docs)]);

  const accuracy: string[] = [];
  for (const m of added.matchAll(/`([A-Za-z_][\w.]*)(\(\))?`/g)) {
    const name = m[1].split(".").pop()!;
    const looksLikeCode = Boolean(m[2]) || m[1].includes(".");
    if (looksLikeCode && /^[a-z_]/i.test(name) && name.length > 2 && !defs.has(name) && !/\.(py|md|toml|txt|cfg)$/.test(m[1])) {
      accuracy.push(`\`${m[0].slice(1, -1)}\` is not defined anywhere in the code`);
    }
  }
  for (const m of added.matchAll(/\b[\w./-]+\.py\b/g)) {
    if (![...knownFiles].some((f) => f === m[0] || f.endsWith(`/${m[0]}`))) accuracy.push(`${m[0]} does not exist`);
  }

  return [
    // Only a repo that keeps a changelog expects an entry; elsewhere a README change is optional.
    check(
      "docs_updated",
      changed.length || !snapshot.tree.some(isChangelogPath) ? [] : ["no documentation was updated (the repo keeps a CHANGELOG)"],
      "Docs reflect the change."
    ),
    check("docs_accuracy", [...new Set(accuracy)].slice(0, 8), "Docs only mention functions and files that exist."),
    slopPhraseCheck(added),
    emojiCheck(added, "docs"),
  ];
}

// ─── WritePolish (PR description) ─────────────────────────────────────────

const TICKED = /^[-*]\s+\[[xX]\]\s+/;

/** How a PR description falls short of the repo's template. */
function templateProblems(body: string, template: string): string[] {
  const lines = body.split("\n").map((l) => l.trim());
  const headings = new Set([...body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1].toLowerCase()));
  const problems = templateHeadings(template)
    .filter((h) => !headings.has(h.toLowerCase()))
    .map((h) => `missing the template's "${h}" section`);
  if (body.includes("<!--")) problems.push("still has the template's HTML comments (instructions to the author); remove them");
  for (const label of aiCheckboxes(template)) {
    if (!lines.some((l) => TICKED.test(l) && l.includes(label))) problems.push(`leaves "${label}" unticked; ThePolisher wrote this PR, so tick it`);
  }
  for (const p of templatePlaceholders(template)) {
    if (lines.includes(p)) problems.push(`still has the template's placeholder "${p}"`);
  }
  return problems;
}

const CLAIMS_PASSING =/\b(all\s+(\d+\s+)?tests?\s+pass|tests?\s+(are\s+)?(now\s+)?pass(ing)?|test suite passes)\b/i;
const COUNTED_CLAIM = /(?<!\ball\s)\b\d+(?:\/\d+)?\s+(?:new\s+)?tests?\s+pass/gi;

export function prChecks(pr: string, bundle: PrBundle, snapshot: RepoSnapshot, validation: Validation | null): TestCheck[] {
  const { title, body } = splitPr(pr);
  const structure: string[] = [];
  if (title.length < 10 || title.length > 72) structure.push(`title is ${title.length} characters (aim for 10-72)`);
  if (/[.!]$/.test(title)) structure.push("title ends with punctuation");
  // With a template, its headings replace the default sections (pr_template checks them).
  if (!snapshot.prTemplate) {
    const headings = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].toLowerCase());
    for (const [label, re] of [["summary", /summary|what|why|problem/], ["changes", /change/], ["testing", /test/]] as const) {
      if (!headings.some((h) => re.test(h))) structure.push(`missing a "${label}" section`);
    }
  }

  // "Fixes #N" closes the issue on merge, so it's only right once the new tests prove the fix;
  // until then the PR must point at the issue without closing it.
  const n = snapshot.issue.number;
  const closes = new RegExp(`\\b(fixes|closes|resolves)\\s+#${n}\\b`, "i").test(body);
  const refers = new RegExp(`\\b(refs|references|related to|part of|see)\\s+#${n}\\b`, "i").test(body);
  const provesFix = Boolean(summarizeValidation(validation)?.provesFix);
  const linkProblems = provesFix
    ? closes
      ? []
      : [`does not say "Fixes #${n}"`]
    : closes
      ? [`says it closes #${n}, but the sandbox hasn't shown the new tests prove the fix; say "Refs #${n}" until it does`]
      : refers
        ? []
        : [`does not say "Refs #${n}" (use "Fixes #${n}" once the new tests prove the fix)`];

  const changedPaths = Object.entries({ ...bundle.code, ...bundle.docs })
    .filter(([p, c]) => c !== baseContent(snapshot, p))
    .map(([p]) => p);
  const unlisted = changedPaths.filter((p) => !mentionsFile(body, p));

  const honesty: string[] = [];
  const allPass = Boolean(validation && validation.tests.ran && validation.tests.total > 0 && validation.tests.failed + validation.tests.errors === 0);
  // A plain count says exactly how many passed, so only the numbers need to match. A blanket claim
  // ("all tests pass", "tests pass") isn't true while any test fails, even one that already failed.
  if (CLAIMS_PASSING.test(body.replace(COUNTED_CLAIM, "")) && !allPass) honesty.push("claims tests pass, but the sandbox run did not confirm that");
  for (const m of body.matchAll(/\b(\d+)(?:\/(\d+))?\s+(?:new\s+)?tests?\s+pass/gi)) {
    if (!validation || Number(m[1]) !== validation.tests.passed) honesty.push(`says ${m[1]} tests pass; the sandbox counted ${validation?.tests.passed ?? "none"}`);
    else if (m[2] && Number(m[2]) !== validation.tests.total) honesty.push(`says ${m[1]}/${m[2]} tests pass; the sandbox ran ${validation.tests.total}`);
  }

  return [
    check("pr_structure", structure, snapshot.prTemplate ? "Clear title." : "Clear title with summary, changes and testing sections."),
    ...(snapshot.prTemplate ? [check("pr_template", templateProblems(body, snapshot.prTemplate), "Fills in the repository's pull request template.")] : []),
    // Projects that accept AI pull requests ask them to say so and name the agent (Rich, pandas).
    check("pr_ai_disclosed", /\bThePolisher\b/.test(body) ? [] : ['does not say it was generated by ThePolisher (end with "Generated by ThePolisher (AI agent).")'], "Says it was generated by ThePolisher."),
    check("pr_links_issue", linkProblems, "Links the issue: closes it only when the tests prove the fix."),
    check("pr_files_listed", unlisted.map((p) => `${p} changed but isn't mentioned`), "Mentions every changed file."),
    check("pr_honest_claims", honesty, "Claims about testing match the sandbox results."),
    slopPhraseCheck(`${title}\n${body}`),
    emojiCheck(`${title}\n${body}`, "the PR description"),
  ];
}
