/**
 * Deterministic checks per Auto-Maintainer lane. They look at what the PR
 * adds (the diff against the repo), so existing code is never blamed.
 */

import { computeLineDiff, type TestCheck } from "@polishloop/core";
import { check, emojiCheck, findEmoji, findSlopPhrases, slopPhraseCheck } from "../slop/shared.js";
import { baseContent, isForbiddenPath, isTestPath, splitPr, type FileMap, type PrBundle, type RepoSnapshot } from "./bundle.js";
import type { Validation } from "./sandbox.js";

const MAX_ADDED_LINES = 600;

function addedLines(snapshot: RepoSnapshot, path: string, content: string): string[] {
  return computeLineDiff(baseContent(snapshot, path) ?? "", content)
    .filter((c) => c.type === "added")
    .map((c) => c.content);
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
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
  const addsTests = testFiles.some((p) => addedLines(snapshot, p, code[p]).some((l) => /^\s*(async\s+)?def\s+test_/.test(l)));

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
    if (/^\s*print\(/m.test(added)) leftovers.push(`${p}: print() left in library code`);
    if (/breakpoint\(\)|import pdb|pdb\.set_trace/.test(added)) leftovers.push(`${p}: debugger call`);
    if (/#\s*(TODO|FIXME|XXX)\b/.test(added)) leftovers.push(`${p}: TODO/FIXME comment`);
  }

  return [
    check("patch_scope", scope, "Patch is focused and only touches Python files."),
    check("tests_included", addsTests ? [] : ["no new test functions were added"], "Adds at least one new test."),
    check("tests_intact", intact, "No existing tests removed, weakened or skipped."),
    check("debug_leftovers", leftovers, "No debug leftovers in library code."),
  ];
}

// ─── UIPolish (UX review of the code change) ──────────────────────────────

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
    check("docs_updated", changed.length ? [] : ["no documentation was updated (README, docs or CHANGELOG)"], "Docs reflect the change."),
    check("docs_accuracy", [...new Set(accuracy)].slice(0, 8), "Docs only mention functions and files that exist."),
    slopPhraseCheck(added),
    emojiCheck(added, "docs"),
  ];
}

// ─── WritePolish (PR description) ─────────────────────────────────────────

const CLAIMS_PASSING = /\b(all\s+(\d+\s+)?tests?\s+pass|tests?\s+(are\s+)?(now\s+)?pass(ing)?|test suite passes)\b/i;

export function prChecks(pr: string, bundle: PrBundle, snapshot: RepoSnapshot, validation: Validation | null): TestCheck[] {
  const { title, body } = splitPr(pr);
  const structure: string[] = [];
  if (title.length < 10 || title.length > 72) structure.push(`title is ${title.length} characters (aim for 10-72)`);
  if (/[.!]$/.test(title)) structure.push("title ends with punctuation");
  const headings = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].toLowerCase());
  for (const [label, re] of [["summary", /summary|what|why|problem/], ["changes", /change/], ["testing", /test/]] as const) {
    if (!headings.some((h) => re.test(h))) structure.push(`missing a "${label}" section`);
  }

  const linksIssue = new RegExp(`\\b(fixes|closes|resolves)\\s+#${snapshot.issue.number}\\b`, "i").test(body);

  const changedPaths = Object.entries({ ...bundle.code, ...bundle.docs })
    .filter(([p, c]) => c !== baseContent(snapshot, p))
    .map(([p]) => p);
  const unlisted = changedPaths.filter((p) => !body.includes(p) && !body.includes(p.split("/").pop()!));

  const honesty: string[] = [];
  const allPass = Boolean(validation && validation.tests.ran && validation.tests.total > 0 && validation.tests.failed + validation.tests.errors === 0);
  if (CLAIMS_PASSING.test(body) && !allPass) honesty.push("claims tests pass, but the sandbox run did not confirm that");
  for (const m of body.matchAll(/\b(\d+)\s+(?:new\s+)?tests?\s+pass/gi)) {
    if (!validation || Number(m[1]) !== validation.tests.passed) honesty.push(`says ${m[1]} tests pass; the sandbox counted ${validation?.tests.passed ?? "none"}`);
  }

  return [
    check("pr_structure", structure, "Clear title with summary, changes and testing sections."),
    check("pr_links_issue", linksIssue ? [] : [`does not say "Fixes #${snapshot.issue.number}"`], "Links the issue it fixes."),
    check("pr_files_listed", unlisted.map((p) => `${p} changed but isn't mentioned`), "Mentions every changed file."),
    check("pr_honest_claims", honesty, "Claims about testing match the sandbox results."),
    slopPhraseCheck(`${title}\n${body}`),
    emojiCheck(`${title}\n${body}`, "the PR description"),
  ];
}
