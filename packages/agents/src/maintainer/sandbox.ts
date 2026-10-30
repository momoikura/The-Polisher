/**
 * Runs a candidate patch for real (service: sandbox-service/modal_app.py, /validate).
 * Results are cached per (repo, sha, changes), so re-tests before each gate are free.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { TestCheck } from "@thepolisher/core";
import { check } from "../slop/shared.js";

export const ValidationSchema = z.object({
  install: z.object({ ok: z.boolean(), logTail: z.string() }),
  compile: z.object({ ok: z.boolean(), errors: z.array(z.string()) }),
  lint: z.object({ issues: z.array(z.object({ file: z.string(), line: z.number(), code: z.string(), message: z.string() })) }),
  tests: z.object({
    ran: z.boolean(),
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    errors: z.number(),
    skipped: z.number(),
    failures: z.array(z.object({ test: z.string(), message: z.string() })),
    /** Failing tests that also fail on the original code; not counted against the patch. */
    preexisting: z.array(z.string()).optional(),
    preexistingCount: z.number().optional(),
    outputTail: z.string(),
    /** "targeted": only the patch's tests and the test files for the changed modules. */
    scope: z.enum(["targeted", "full"]).optional(),
    selectedFiles: z.number().nullable().optional(),
  }),
  failToPass: z
    .object({
      newTests: z.array(z.string()),
      failedOnBase: z.boolean(),
      passedAfter: z.boolean(),
      /** How the new tests failed on the original code: reproducing the bug, or only missing code the fix adds. */
      baseFailures: z.object({ reproduced: z.number(), missingCode: z.number(), example: z.string() }).nullable().optional(),
    })
    .nullable(),
  /** Bandit findings (medium/high) the patch introduced in the source files it changes. */
  security: z
    .object({
      ran: z.boolean(),
      newIssues: z.array(
        z.object({ file: z.string(), line: z.number(), testId: z.string(), severity: z.string(), confidence: z.string(), text: z.string() })
      ),
    })
    .optional(),
  durationMs: z.number(),
});
export type Validation = z.infer<typeof ValidationSchema>;

export interface ValidateRequest {
  repo: string;
  sha: string;
  /** Full content per changed path (code + tests only; docs don't need running). */
  changes: Record<string, string>;
  /** Test files the PR adds or changes; checked for fail-to-pass. */
  newTests: string[];
  /** "targeted" (fast, while polishing) or "full" (the whole suite; the default). */
  scope?: "targeted" | "full";
}

export interface SandboxClient {
  validate(req: ValidateRequest): Promise<Validation>;
}

export interface ModalSandboxConfig {
  url: string;
  token: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 6 * 60_000;
const CACHE_SIZE = 40;

export class ModalSandboxClient implements SandboxClient {
  private readonly cache = new Map<string, Promise<Validation>>();
  private readonly fetchFn: typeof fetch;

  constructor(private readonly cfg: ModalSandboxConfig) {
    if (!/^https:\/\//.test(cfg.url)) throw new Error("SANDBOX_URL must be an https:// URL.");
    this.fetchFn = cfg.fetchFn ?? globalThis.fetch;
  }

  validate(req: ValidateRequest): Promise<Validation> {
    const scope = req.scope ?? "full";
    const key = createHash("sha256").update(JSON.stringify([req.repo, req.sha, Object.entries(req.changes).sort(), [...req.newTests].sort(), scope])).digest("hex");
    const cached = this.cache.get(key);
    if (cached) return cached;
    // The sandbox only runs Python; docs in the patch don't affect tests and would be refused.
    const pending = this.post({
      repo: req.repo,
      sha: req.sha,
      newTests: req.newTests,
      testScope: scope,
      changes: Object.fromEntries(Object.entries(req.changes).filter(([p]) => /\.py$/.test(p))),
    });
    this.cache.set(key, pending);
    pending.catch(() => this.cache.delete(key));
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string);
    return pending;
  }

  private async post(req: Omit<ValidateRequest, "scope"> & { testScope: "targeted" | "full" }): Promise<Validation> {
    const res = await this.fetchFn(this.cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.token}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error("Sandbox rejected SANDBOX_TOKEN.");
    if (!res.ok) throw new Error(`Sandbox returned HTTP ${res.status}.`);
    const parsed = ValidationSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("Sandbox returned an unexpected response.");
    return parsed.data;
  }
}

// ─── Checks ───────────────────────────────────────────────────────────────

export function validationChecks(v: Validation): TestCheck[] {
  const tests = v.tests;
  // Failures that also happen on the original code aren't the patch's doing.
  const preexisting = tests.preexistingCount ?? 0;
  const newFailing = Math.max(tests.failed + tests.errors - preexisting, 0);
  // A failed install only matters if the tests couldn't run; an optional dev tool failing doesn't.
  const testProblems = !tests.ran
    ? [!v.install.ok ? `dependencies failed to install: ${v.install.logTail.split("\n").slice(-2).join(" ")}` : "pytest did not run"]
    : tests.total === 0
      ? ["no tests were collected"]
      : [
          ...tests.failures.slice(0, 5).map((f) => `${f.test}: ${f.message.slice(0, 160)}`),
          ...(newFailing > tests.failures.length ? [`${newFailing} failing in total`] : []),
        ];
  const testsPassMessage = preexisting
    ? `No new failures (${preexisting} tests already failed on the original code).`
    : `All ${tests.total} tests pass.`;

  const ftp = v.failToPass;
  const ftpProblems = !ftp
    ? ["no new or changed tests to prove the fix"]
    : [
        ...(ftp.failedOnBase ? [] : ["the new tests already pass on the original code, so they don't catch the bug"]),
        ...(ftp.failedOnBase && failsOnlyForMissingCode(ftp)
          ? [
              `the new tests fail on the original code only because they import or call code the fix adds (${ftp.baseFailures?.example}); test the bug through behaviour that already exists`,
            ]
          : []),
        ...(ftp.passedAfter ? [] : ["the new tests do not pass with the fix applied"]),
      ];

  return [
    check("py_compile", v.compile.errors.slice(0, 5), "All changed files compile."),
    check("py_lint", v.lint.issues.slice(0, 8).map((i) => `${i.file}:${i.line} ${i.code} ${i.message}`), "No lint errors in changed files."),
    check("py_tests", testProblems, testsPassMessage),
    check("fail_to_pass", ftpProblems, "New tests fail before the fix and pass after it."),
    check("security_scan", securityProblems(v.security), "The patch adds no medium or high security findings (bandit)."),
  ];
}

/**
 * A test that fails on the original code only because it imports or calls something the fix
 * adds proves nothing about the bug. Older sandbox results have no classification: trust them.
 */
function failsOnlyForMissingCode(ftp: NonNullable<Validation["failToPass"]>): boolean {
  const f = ftp.baseFailures;
  return Boolean(f && f.reproduced === 0 && f.missingCode > 0);
}

function securityProblems(security: Validation["security"]): string[] {
  if (!security?.ran) return ["Not verified: the sandbox didn't run the security scan"];
  return security.newIssues
    .slice(0, 8)
    .map((i) => `${i.file}:${i.line} ${i.testId} (${i.severity.toLowerCase()}): ${i.text}`);
}

/** A validation that could not run must never look like a pass. */
export function validationFailureChecks(reason: string): TestCheck[] {
  return (["py_compile", "py_lint", "py_tests", "fail_to_pass", "security_scan"] as const).map((testType) => ({
    testType,
    authority: "objective" as const,
    passed: false,
    problemCount: 1,
    message: `Not verified: sandbox unavailable (${reason})`,
  }));
}

export function summarizeValidation(v: Validation | null) {
  if (!v) return null;
  return {
    testsPassed: v.tests.passed,
    testsTotal: v.tests.total,
    lintIssues: v.lint.issues.length,
    compiles: v.compile.ok,
    provesFix: Boolean(v.failToPass?.failedOnBase && v.failToPass?.passedAfter && !failsOnlyForMissingCode(v.failToPass)),
  };
}
