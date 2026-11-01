import { useState } from "react";
import type { MaintainerView } from "../maintainer/reducer.js";
import { ChallengeSection, ProofCard } from "./ProofCard.js";
import { FilesChanged } from "./FilesChanged.js";
import { Icon } from "./Icon.js";

type Props = {
  view: MaintainerView;
  action?: { label: string; onClick: () => void };
};

const GOOD = new Set(["proven"]);
const NEUTRAL = new Set(["no_tests", "only_new_code", "tests_pass_without_it", "not_run"]);

/** The result of checking someone's pull request. Nothing here posts to GitHub. */
export function PrCheckView({ view, action }: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const { context, prCheck: check, proof, challenge } = view;
  const tone = !check ? "" : GOOD.has(check.verdict) ? " is-good" : NEUTRAL.has(check.verdict) ? " is-neutral" : " is-bad";

  const copy = () => {
    if (!check) return;
    void navigator.clipboard.writeText(check.comment).then(() => setIsCopied(true));
  };

  return (
    <div className="pr-page check-page">
      <section className="pr-header">
        <p className="check-kicker">Pull request check</p>
        <h1 className="pr-title">
          {context?.issue.title ?? "Reading the pull request"}
          {context && <span className="pr-number"> #{context.issue.number}</span>}
        </h1>
        {context && (
          <p className="pr-meta-text">
            <a href={context.issue.url} target="_blank" rel="noopener noreferrer" className="link">
              {context.repo}#{context.issue.number}
            </a>{" "}
            tested on <span className="mono">{context.sha.slice(0, 7)}</span>
          </p>
        )}
        {action && (
          <button type="button" className="btn" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </section>

      {!check && !view.result && (
        <p className="flash" role="status">
          <Icon name="circleNotch" size={16} />
          <span>Running the repo's tests with this PR, then Muse Wonder tries to break it. This can take several minutes.</span>
        </p>
      )}

      {check && (
        <section className={`check-verdict${tone}`} aria-label="Result">
          <h2>{check.headline}</h2>
          <p>{check.detail}</p>
          {check.notApplied.length > 0 && (
            <p className="muted">
              Not applied in the sandbox, because they aren't Python or were removed: <span className="mono">{check.notApplied.join(", ")}</span>
            </p>
          )}
          <button type="button" className="btn" onClick={copy}>
            <Icon name={isCopied ? "check" : "comment"} size={16} />
            {isCopied ? "Copied" : "Copy as a review comment"}
          </button>
        </section>
      )}

      {proof ? <ProofCard proof={proof} diffs={view.current?.diffs ?? []} challenge={challenge} context={context} /> : challenge && <ChallengeSection challenge={challenge} />}
      {view.current && <FilesChanged baseline={null} current={view.current} isFinal={view.result !== null} isPlain />}
    </div>
  );
}
