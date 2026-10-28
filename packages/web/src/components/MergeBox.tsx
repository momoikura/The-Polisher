import { useState } from "react";
import { LANE_IDS, type MaintainerView } from "../maintainer/reducer.js";
import { LANE_META } from "../maintainer/lanes.js";
import type { PrState } from "../maintainer/useMaintainer.js";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

type Props = {
  view: MaintainerView;
  isSimulated: boolean;
  hasGitHubToken: boolean;
  pr: PrState;
  onOpenPr: () => void;
  /** A saved run: no pull request can be opened from it. */
  isReplay?: boolean;
};

/** GitHub-style merge box: per-agent checks, then the only action that writes to GitHub. */
export function MergeBox({ view, isSimulated, hasGitHubToken, pr, onOpenPr, isReplay = false }: Props) {
  const [isConfirming, setIsConfirming] = useState(false);
  const result = view.result;
  const repo = view.context?.repo ?? "the repository";
  const isClean = result?.status === "clean";
  const isVerified = result?.status === "verified";
  const canOpen = Boolean(result?.canOpenPr) && !isSimulated && hasGitHubToken;

  const heading = !result
    ? "Review in progress"
    : isClean
      ? "All reviewers approved"
      : isVerified
        ? "Verified by tests, polish pending"
        : result.status === "failed"
          ? "The run failed"
          : "Some reviewers requested changes";
  const icon = !result ? "circleNotch" : isClean || isVerified ? "checkCircle" : "timesCircle";

  return (
    <section className={`merge-box${isClean || isVerified ? " is-ready" : ""}`} aria-labelledby="merge-title" aria-live="polite">
      <div className="merge-row merge-summary">
        <span className="merge-icon" aria-hidden="true">
          <Icon name={icon} size={24} className={!result ? "spin" : ""} />
        </span>
        <div>
          <h2 id="merge-title">{heading}</h2>
          <p className="muted">{result ? result.message : "Each agent revises its part until its checks pass and its critic approves."}</p>
        </div>
        {result && <span className="mono muted merge-cost">${result.totalUSD.toFixed(3)}</span>}
      </div>

      <ul className="merge-checks">
        {LANE_IDS.map((lane) => {
          const l = view.lanes[lane];
          const summary = result?.lanes[lane];
          const approved = summary ? summary.clean : l.state === "clean";
          const detail = summary
            ? summary.clean
              ? "Approved"
              : summary.remaining.slice(0, 2).join("; ") || summary.status
            : l.checks
              ? `${l.checks.passed} of ${l.checks.passed + l.checks.failed} checks passing`
              : "Waiting";
          return (
            <li key={lane} className={approved ? "is-pass" : ""}>
              <Icon name={approved ? "check" : summary ? "times" : "dotCircle"} size={16} label={approved ? "approved" : "not approved"} />
              <strong>{LANE_META[lane].agent}</strong>
              <span className="muted">{detail}</span>
            </li>
          );
        })}
      </ul>

      {isReplay && result && (
        <p className="merge-row field-help">This is a saved run. To open a pull request, start a new run on the issue.</p>
      )}
      {!isReplay && result?.canOpenPr && (
        <div className="merge-row merge-actions">
          {pr.kind === "opened" ? (
            <p className="opened">
              <Icon name="checkCircle" size={16} /> Pull request opened:{" "}
              <a className="link" href={pr.url} target="_blank" rel="noopener noreferrer">
                {pr.url} <Icon name="external" size={12} />
              </a>
            </p>
          ) : isConfirming ? (
            <div className="confirm">
              <p>
                This opens a real pull request on <strong>{repo}</strong>
                {!isClean && ", even though not every reviewer approved"}. If your GitHub token can't push there, it
                first forks {repo} to your account and pushes the branch to the fork.
              </p>
              <div className="confirm-actions">
                <Button variant="secondary" size="sm" onClick={() => setIsConfirming(false)}>
                  Cancel
                </Button>
                <Button size="sm" isLoading={pr.kind === "opening"} loadingLabel="Opening…" onClick={onOpenPr}>
                  Open pull request
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button disabled={!canOpen} onClick={() => setIsConfirming(true)} icon={<Icon name="github" size={16} />}>
                Open pull request on GitHub
              </Button>
              {isSimulated && <span className="field-help">The demo repo isn't on GitHub, so this is turned off.</span>}
              {!isSimulated && !hasGitHubToken && (
                <span className="field-help">
                  Set <code>GITHUB_TOKEN</code> in .env to turn this on.
                </span>
              )}
            </>
          )}
          {pr.kind === "error" && (
            <p className="flash flash-strong" role="alert">
              <Icon name="timesCircle" size={16} />
              <span>{pr.message}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
