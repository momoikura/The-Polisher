import type { Challenge, FileDiff, Proof } from "@thepolisher/agents";
import { useEffect, useState } from "react";
import { buildReceipt } from "../maintainer/receipt.js";
import { Icon } from "./Icon.js";

const MAX_TEST_LINES = 60;

type Props = {
  proof: Proof;
  diffs: readonly FileDiff[];
  challenge?: Challenge | null;
  context?: { repo: string; sha: string; issue: { url: string } } | null;
};

/** A stronger model that didn't write the fix tries to break it. */
function ChallengeSection({ challenge }: { challenge: Challenge }) {
  const survived = challenge.failures.length === 0;
  const regressions = challenge.failures.filter((f) => f.failsOnOriginal === false).length;
  return (
    <div className={`proof-challenge${survived ? " is-pass" : " is-warn"}`}>
      <strong>
        Muse Wonder tried to break it: {challenge.passed} of {challenge.total} of its own tests pass
      </strong>
      <p className="muted">
        {survived
          ? "A stronger model that didn't write this fix wrote edge-case tests for it. They ran on the final patch in the sandbox."
          : regressions > 0
            ? "A test passes on the original code and fails with this fix. Check it before you merge."
            : "A failing test here may be a real gap, or a wrong guess by the model."}
      </p>
      {challenge.failures.map((f) => (
        <pre key={f.test} className="proof-output">
          {f.test}
          {f.failsOnOriginal === true && "\nAlso fails on the original code, so this fix didn't cause it."}
          {f.failsOnOriginal === false && "\nPasses on the original code, so this fix changed it."}
          {"\n"}
          {f.message}
        </pre>
      ))}
      <details className="proof-test">
        <summary>
          <Icon name="fileCode" size={16} />
          <span>Its tests</span>
        </summary>
        <pre className="proof-code">{challenge.tests}</pre>
      </details>
    </div>
  );
}

/** Everything the run claims, as a file, with a hash of the patch it's about. */
function Receipt({ proof, diffs, challenge, context }: Required<Pick<Props, "proof" | "diffs">> & { challenge: Challenge | null; context: NonNullable<Props["context"]> }) {
  const [url, setUrl] = useState<{ href: string; hash: string } | null>(null);
  useEffect(() => {
    let href = "";
    let stale = false;
    void buildReceipt({ repo: context.repo, sha: context.sha, issueUrl: context.issue.url, proof, challenge, diffs }).then((receipt) => {
      if (stale) return;
      href = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
      setUrl({ href, hash: receipt.patchSha256 });
    });
    return () => {
      stale = true;
      if (href) URL.revokeObjectURL(href);
    };
  }, [proof, diffs, challenge, context]);
  if (!url) return null;
  return (
    <p className="proof-receipt muted">
      <a href={url.href} download={`thepolisher-receipt-${url.hash.slice(0, 12)}.json`}>
        Download the receipt
      </a>{" "}
      <span className="mono">sha256 {url.hash.slice(0, 12)}</span> of this patch
    </p>
  );
}

/**
 * The run's central claim in one place: the new tests fail on the original code
 * (for the right reason), pass with the fix, and the rest of the suite still passes.
 */
export function ProofCard({ proof, diffs, challenge = null, context = null }: Props) {
  const reproducesBug = proof.failedOnBase && (proof.reproduced > 0 || proof.missingCode === 0);
  const otherFailures = proof.newFailing ?? 0;
  const suitePasses = otherFailures === 0;
  // Every test failing with or without the patch: the suite didn't really run here, so it says nothing either way.
  const suiteDidNotRun = proof.testsPassed === 0 && proof.preexisting > 0;
  const testCode = diffs
    .filter((d) => proof.newTests.includes(d.path))
    .map((d) => ({ path: d.path, lines: d.lines.filter((l) => l.type === "added").map((l) => l.text) }))
    .filter((t) => t.lines.length > 0);

  const suiteSummary = `${proof.fullSuite ? " in the repo's whole suite" : " in the related tests"}${
    proof.preexisting > 0 ? `; ${proof.preexisting} already failed on the original code and aren't caused by the fix` : ""
  }${suitePasses ? "" : `; ${otherFailures} newly ${otherFailures === 1 ? "fails" : "fail"} with the patch`}.`;

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
        <li className={suitePasses && !suiteDidNotRun ? "is-pass" : "is-fail"}>
          <span className="proof-step-icon" aria-hidden="true">
            {suitePasses && !suiteDidNotRun ? "✓" : "✗"}
          </span>
          <div>
            <strong>
              {suiteDidNotRun ? "The test suite couldn't run in the sandbox" : `${proof.testsPassed.toLocaleString()} of ${proof.testsTotal.toLocaleString()} tests pass`}
            </strong>
            <span className="muted">
              {suiteDidNotRun && " Its dependencies or setup are likely missing here, so nothing is known about the rest of the suite."}
              {!suiteDidNotRun && suiteSummary}
            </span>
          </div>
        </li>
      </ol>

      {challenge && <ChallengeSection challenge={challenge} />}

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

      {context && <Receipt proof={proof} diffs={diffs} challenge={challenge} context={context} />}
    </section>
  );
}
