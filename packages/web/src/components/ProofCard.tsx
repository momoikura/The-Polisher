import type { FileDiff, Proof } from "@thepolisher/agents";
import { Icon } from "./Icon.js";

const MAX_TEST_LINES = 60;

type Props = { proof: Proof; diffs: readonly FileDiff[] };

/**
 * The run's central claim in one place: the new tests fail on the original code
 * (for the right reason), pass with the fix, and the rest of the suite still passes.
 */
export function ProofCard({ proof, diffs }: Props) {
  const reproducesBug = proof.failedOnBase && (proof.reproduced > 0 || proof.missingCode === 0);
  const otherFailures = proof.testsTotal - proof.testsPassed - proof.preexisting;
  const suitePasses = otherFailures <= 0;
  const testCode = diffs
    .filter((d) => proof.newTests.includes(d.path))
    .map((d) => ({ path: d.path, lines: d.lines.filter((l) => l.type === "added").map((l) => l.text) }))
    .filter((t) => t.lines.length > 0);

  return (
    <section className={`proof-card${proof.proven ? " is-proven" : ""}`} aria-labelledby="proof-title">
      <header className="proof-head">
        <Icon name={proof.proven ? "checkCircle" : "timesCircle"} size={24} />
        <div>
          <h2 id="proof-title">{proof.proven ? "Proof: the new tests show the fix works" : "Not proven yet"}</h2>
          <p className="muted">
            New tests must fail on the original code because of the bug, then pass with the fix, on a fresh copy of the repo in the sandbox.
          </p>
        </div>
      </header>

      <ol className="proof-steps">
        <li className={reproducesBug ? "is-pass" : "is-fail"}>
          <span className="proof-step-icon" aria-hidden="true">
            {proof.failedOnBase ? "✗" : "?"}
          </span>
          <div>
            <strong>Fails on the original code</strong>
            <span className="muted">
              {!proof.failedOnBase
                ? " The new tests already pass without the fix, so they don't show the bug."
                : reproducesBug
                  ? ` It reproduces the bug${proof.baseFailure ? ":" : "."}`
                  : ` But only because it uses code the fix adds, which proves nothing about the bug${proof.baseFailure ? ":" : "."}`}
            </span>
            {proof.baseFailure && <pre className="proof-output">{proof.baseFailure}</pre>}
          </div>
        </li>
        <li className={proof.passedAfter ? "is-pass" : "is-fail"}>
          <span className="proof-step-icon" aria-hidden="true">
            {proof.passedAfter ? "✓" : "✗"}
          </span>
          <div>
            <strong>{proof.passedAfter ? "Passes with the fix" : "Still fails with the fix"}</strong>
          </div>
        </li>
        <li className={suitePasses ? "is-pass" : "is-fail"}>
          <span className="proof-step-icon" aria-hidden="true">
            {suitePasses ? "✓" : "✗"}
          </span>
          <div>
            <strong>
              {proof.testsPassed.toLocaleString()} of {proof.testsTotal.toLocaleString()} tests pass
            </strong>
            <span className="muted">
              {proof.fullSuite ? " in the repo's whole suite" : " in the related tests"}
              {proof.preexisting > 0 && `; ${proof.preexisting} already failed on the original code and aren't caused by the fix`}
              {!suitePasses && `; ${otherFailures} fail because of the patch`}.
            </span>
          </div>
        </li>
      </ol>

      {testCode.map((t) => (
        <details key={t.path} className="proof-test" open={testCode.length === 1}>
          <summary>
            <Icon name="fileCode" size={16} />
            <span className="mono">{t.path}</span>
          </summary>
          <pre className="proof-code">
            {t.lines.slice(0, MAX_TEST_LINES).join("\n")}
            {t.lines.length > MAX_TEST_LINES && `\n… ${t.lines.length - MAX_TEST_LINES} more lines in Files changed`}
          </pre>
        </details>
      ))}
    </section>
  );
}
