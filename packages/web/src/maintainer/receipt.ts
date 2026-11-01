import type { Challenge, FileDiff, Proof } from "@thepolisher/agents";

/** A SHA-256 of the patch, from the same diffs the page shows, so a saved receipt can be checked against the run. */
export async function patchHash(diffs: readonly FileDiff[]): Promise<string> {
  const text = JSON.stringify(diffs.map((d) => ({ path: d.path, lines: d.lines })));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildReceipt(input: { repo: string; sha: string; issueUrl: string; proof: Proof; challenge: Challenge | null; diffs: readonly FileDiff[] }) {
  const { repo, sha, issueUrl, proof, challenge, diffs } = input;
  return {
    tool: "ThePolisher",
    repo,
    commit: sha,
    issue: issueUrl,
    proven: proof.proven,
    newTests: proof.newTests,
    failedOnOriginalCode: proof.failedOnBase,
    passedWithFix: proof.passedAfter,
    failureOnOriginalCode: proof.baseFailure,
    tests: { passed: proof.testsPassed, total: proof.testsTotal, alreadyFailing: proof.preexisting, newFailing: proof.newFailing ?? null, wholeSuite: proof.fullSuite },
    challenge: challenge && { model: challenge.model, passed: challenge.passed, total: challenge.total, failures: challenge.failures },
    patchSha256: await patchHash(diffs),
  };
}
