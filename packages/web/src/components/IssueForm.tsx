import { useState, type FormEvent } from "react";
import type { MaintainerConfig } from "../maintainer/useMaintainer.js";
import { LANE_IDS } from "../maintainer/reducer.js";
import { LANE_META } from "../maintainer/lanes.js";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

const BUDGETS = [1, 3, 5, 10];
const ISSUE_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/;

const STEPS = [
  "Three first drafts are written at once and tested on Modal; the tests pick which one to polish.",
  "Four agents review and revise their part in parallel; every revision is checked before it is kept.",
  "New tests must fail on the original code and pass with the fix, and a security scan must find nothing new.",
  "You compare the first draft with the result, then open the pull request yourself.",
];

type Props = {
  config: MaintainerConfig | null;
  isStarting: boolean;
  error: string | null;
  onStart: (issueUrl: string, budgetUSD: number) => void;
};

export function IssueForm({ config, isStarting, error, onStart }: Props) {
  const [issueUrl, setIssueUrl] = useState("");
  const [budget, setBudget] = useState(3);
  const trimmed = issueUrl.trim();
  const isValid = ISSUE_URL.test(trimmed);
  const showInvalid = trimmed.length > 0 && !isValid;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isValid) onStart(trimmed, budget);
  };

  return (
    <div className="new-page">
      <div className="new-head">
        <h1 className="page-title">Fix an issue</h1>
        <p className="page-lede">Paste a GitHub issue from a Python repository. You get a pull request whose tests prove the fix.</p>
      </div>

      <div className="new-grid">
        <form className="box" onSubmit={handleSubmit} noValidate aria-labelledby="new-form-title">
          <div className="box-header">
            <h2 id="new-form-title" className="box-title">
              <Icon name="github" size={18} />
              Issue
            </h2>
          </div>
          <div className="box-body form-stack">
            <div className="field">
              <label htmlFor="issue-url" className="field-label">
                Issue link
              </label>
              <input
                id="issue-url"
                className="input"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={issueUrl}
                onChange={(e) => setIssueUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/issues/123"
                aria-describedby="issue-help"
                aria-invalid={showInvalid || undefined}
              />
              <p id="issue-help" className={`field-help${showInvalid ? " is-error" : ""}`}>
                {showInvalid ? (
                  <>
                    <Icon name="exclamation" size={14} /> Use a link like https://github.com/owner/repo/issues/123.
                  </>
                ) : (
                  "Public repositories with pytest tests."
                )}
              </p>
              {config?.demoIssueUrl && (
                <button type="button" className="link-button" onClick={() => setIssueUrl(config.demoIssueUrl!)}>
                  Use the demo issue: tinyslug #7, “slugify keeps punctuation”
                </button>
              )}
            </div>

            <fieldset className="field">
              <legend className="field-label">Budget cap</legend>
              <div className="segmented" role="radiogroup" aria-label="Budget cap">
                {BUDGETS.map((b) => (
                  <label key={b} className={`segment${budget === b ? " is-active" : ""}`}>
                    <input type="radio" name="budget" value={b} checked={budget === b} onChange={() => setBudget(b)} />
                    ${b}
                  </label>
                ))}
              </div>
              <p className="field-help">The run stops here even if not every agent has approved.</p>
            </fieldset>

            {config?.isSimulated && (
              <p className="flash" role="note">
                <Icon name="info" size={16} />
                <span>Demo mode. The model and test results are scripted and a built-in demo repo is used, whatever link you paste. The checks, the gate and the memory are real.</span>
              </p>
            )}
            {config && !config.isConfigured && (
              <p className="flash flash-strong" role="note">
                <Icon name="exclamation" size={16} />
                <span>
                  {config.setupHint} To try the demo without a key, run <code>pnpm --filter @polishloop/web dev:sim</code>.
                </span>
              </p>
            )}
            {config && config.isConfigured && !config.isSimulated && !config.isSandboxConfigured && (
              <p className="flash" role="note">
                <Icon name="exclamation" size={16} />
                <span>
                  Tests can't run yet, so no pull request can be fully approved. Deploy <code>sandbox-service/</code> to Modal and set{" "}
                  <code>SANDBOX_URL</code> and <code>SANDBOX_TOKEN</code>.
                </span>
              </p>
            )}
            {error && (
              <p className="flash flash-strong" role="alert">
                <Icon name="timesCircle" size={16} />
                <span>{error}</span>
              </p>
            )}
          </div>
          <div className="box-footer">
            <Button
              type="submit"
              isLoading={isStarting}
              loadingLabel="Starting…"
              disabled={!isValid || (config !== null && !config.isConfigured)}
              trailingIcon={<Icon name="arrowRight" size={16} />}
            >
              Fix this issue
            </Button>
          </div>
        </form>

        <aside className="new-side" aria-label="How it works">
          <section className="side-section">
            <h2 className="side-title">How it works</h2>
            <ol className="steps-list">
              {STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
          <section className="side-section">
            <h2 className="side-title">Reviewers</h2>
            <ul className="reviewer-list">
              {LANE_IDS.map((lane) => (
                <li key={lane}>
                  <span className="avatar" aria-hidden="true">
                    <Icon name={LANE_META[lane].icon} size={14} />
                  </span>
                  <span>
                    <strong>{LANE_META[lane].agent}</strong>
                    <span className="muted">{LANE_META[lane].job}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
