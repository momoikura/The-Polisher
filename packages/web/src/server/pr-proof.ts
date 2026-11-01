import type { Challenge, Proof } from "@thepolisher/agents";

function challengeNote(failsOnOriginal: boolean | undefined): string {
  if (failsOnOriginal === true) return "It also fails on the original code, possibly for a different reason.";
  if (failsOnOriginal === false) return "It passes on the original code and fails with this change. Please check it.";
  return "Please check whether this is a real gap.";
}

/**
 * Adds the evidence to the pull request itself, so a maintainer can judge the change without
 * opening ThePolisher. Only for a proven fix, and only what the sandbox reported.
 */
export function withProofSection(pr: string, proof: Proof | null, challenge: Challenge | null, runUrl: string | null): string {
  if (!proof?.proven) return pr;
  // Test output comes from the repo, so it can't be allowed to close the code span it's shown in.
  const code = (text: string) => `\`${text.replaceAll("`", "'")}\``;
  const failure = proof.baseFailure?.split("\n")[0];
  const lines = [
    `New tests (${proof.newTests.map(code).join(", ")}) fail on the original code and pass with this change.`,
    ...(failure ? [`Failure on the original code: ${code(failure)}`] : []),
    `${proof.fullSuite ? "Whole test suite" : "Related tests"}: ${proof.testsPassed} of ${proof.testsTotal} pass${
      proof.preexisting > 0 ? `; ${proof.preexisting} already failed on the original code` : ""
    }; ${proof.newFailing ?? 0} newly fail.`,
    ...(challenge
      ? [
          `Edge-case tests written independently by ${challenge.model}: ${challenge.passed} of ${challenge.total} pass.`,
          ...challenge.failures.map((f) => `Didn't pass: ${code(f.test)}. ${challengeNote(f.failsOnOriginal)}`),
        ]
      : []),
    ...(runUrl ? [`Full run: ${runUrl}`] : []),
  ];
  return `${pr.trimEnd()}\n\n## Proof from the sandbox\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}
