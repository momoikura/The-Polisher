/**
 * The proof that a fix works, from the final whole-suite sandbox run: the new
 * tests fail on the original code (for the right reason) and pass with the fix,
 * and the rest of the suite still passes. Shown as the run's Proof card.
 */

import { newFailing, summarizeValidation, type Validation } from "./sandbox.js";

export interface Proof {
  /** The sandbox's verdict: new tests fail on the original for the right reason and pass with the fix. */
  proven: boolean;
  newTests: string[];
  failedOnBase: boolean;
  passedAfter: boolean;
  /** How a new test failed on the original code, from the sandbox's output. */
  baseFailure: string | null;
  /** New tests that failed by reproducing the bug, and ones that only failed because the fix's code was missing. */
  reproduced: number;
  missingCode: number;
  testsPassed: number;
  testsTotal: number;
  /** Failing tests that also fail on the original code (not caused by the patch). */
  preexisting: number;
  /** Failing tests that pass on the original code. Saved runs from before this field don't have it. */
  newFailing?: number;
  fullSuite: boolean;
}

export function proofFrom(v: Validation | null): Proof | null {
  const ftp = v?.failToPass;
  if (!v || !ftp) return null;
  return {
    proven: Boolean(summarizeValidation(v)?.provesFix),
    newTests: ftp.newTests,
    failedOnBase: ftp.failedOnBase,
    passedAfter: ftp.passedAfter,
    baseFailure: ftp.baseFailures?.example || null,
    reproduced: ftp.baseFailures?.reproduced ?? 0,
    missingCode: ftp.baseFailures?.missingCode ?? 0,
    testsPassed: v.tests.passed,
    testsTotal: v.tests.total,
    preexisting: v.tests.preexistingCount ?? 0,
    newFailing: newFailing(v),
    fullSuite: v.tests.scope !== "targeted",
  };
}
