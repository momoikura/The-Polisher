import { useState, type FormEvent } from "react";
import type { AuthUser } from "../maintainer/useAuth.js";
import type { MaintainerConfig } from "../maintainer/useMaintainer.js";
import { LANE_IDS } from "../maintainer/reducer.js";
import { LANE_META } from "../maintainer/lanes.js";
import { EVIDENCE } from "../maintainer/evidence.js";
import { prettyModel } from "../maintainer/model-label.js";
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
  /** Signed-in user, or null; only consulted when the server has sign-in enabled. */
  user: AuthUser | null;
  isStarting: boolean;
  error: string | null;
  onStart: (issueUrl: string, budgetUSD: number, metaApiKey?: string, rememberKey?: boolean) => void;
  /** Delete the saved key; resolves to an error message, or null. */
  onForgetKey: () => Promise<string | null>;
};

export function IssueForm({ config, user, isStarting, error, onStart, onForgetKey }: Props) {
  const [issueUrl, setIssueUrl] = useState("");
  const [budget, setBudget] = useState(3);
  // Held only in this component for one submit; never written to localStorage or cookies.
  const [metaKey, setMetaKey] = useState("");
  const [rememberKey, setRememberKey] = useState(true);
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const trimmed = issueUrl.trim();
  const isValid = ISSUE_URL.test(trimmed);
  const showInvalid = trimmed.length > 0 && !isValid;
  const needsSignIn = Boolean(config?.isAuthEnabled) && !user;
  const showKeyField = Boolean(config?.isAuthEnabled) && !config?.isSimulated;
  const usesSavedKey = Boolean(user?.hasSavedKey) && !isReplacingKey;
  const freeLeft = config?.freeRunsLeft ?? 0;
  const isFreeRun = Boolean(config?.requiresUserKey) && !usesSavedKey && metaKey.trim().length === 0 && freeLeft > 0;
  const isKeyMissing = Boolean(config?.requiresUserKey) && !usesSavedKey && metaKey.trim().length === 0 && freeLeft === 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || isKeyMissing) return;
    const typed = usesSavedKey ? undefined : metaKey.trim() || undefined;
    onStart(trimmed, budget, typed, Boolean(user) && rememberKey);
  };

  const handleForget = async () => {
    setKeyError(await onForgetKey());
    setIsReplacingKey(false);
    setMetaKey("");
  };

  return (
    <div className="new-page">
      <div className="new-head">
        <h1 className="page-title">Fix an issue</h1>
        <p className="page-lede">Paste a GitHub issue from a Python repository. You get a pull request whose tests prove the fix.</p>
        <a className="evidence" href={EVIDENCE.url} target="_blank" rel="noopener noreferrer">
          <span className="evidence-stat">
            <strong>{EVIDENCE.proven}</strong>
            <span>of {EVIDENCE.issues} fixes proven</span>
          </span>
          <span className="evidence-vs">vs</span>
          <span className="evidence-stat is-muted">
            <strong>{EVIDENCE.singlePrompt}</strong>
            <span>with a single prompt</span>
          </span>
          <span className="evidence-note">
            On {EVIDENCE.issues} real open issues from {EVIDENCE.projects} popular Python projects, same model, issues chosen before running. ${EVIDENCE.totalUSD.toFixed(2)} for all of them.{" "}
            <span className="link">See every issue</span>
            <Icon name="external" size={12} />
          </span>
        </a>
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

            {showKeyField && usesSavedKey && (
              <div className="field">
                <p className="field-label">Your Meta Model API key</p>
                <div className="saved-key">
                  <Icon name="checkCircle" size={16} />
                  <span>Using the key saved to your account.</span>
                  <button type="button" className="link-button" onClick={() => setIsReplacingKey(true)}>
                    Use a different key
                  </button>
                  <button type="button" className="link-button" onClick={() => void handleForget()}>
                    Forget it
                  </button>
                </div>
                <p className="field-help">Saved encrypted on the server and never shown again. Runs are billed to your Meta account.</p>
              </div>
            )}
            {showKeyField && !usesSavedKey && (
              <div className="field">
                <label htmlFor="meta-key" className="field-label">
                  Your Meta Model API key{config?.requiresUserKey && freeLeft === 0 ? "" : " (optional)"}
                </label>
                {config?.freeRunsLeft != null && (
                  <p className={`free-runs${freeLeft === 0 ? " is-out" : ""}`} role="note">
                    <Icon name={freeLeft > 0 ? "checkCircle" : "info"} size={16} />
                    <span>
                      {freeLeft > 0
                        ? `${freeLeft} of ${config.freeRunsPerUser} free runs left. Leave the key empty to use one; add your own key for unlimited runs.`
                        : "You've used your free runs. Add your own key to keep going."}
                    </span>
                  </p>
                )}
                <input
                  id="meta-key"
                  className="input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={metaKey}
                  onChange={(e) => setMetaKey(e.target.value)}
                  placeholder="From dev.meta.ai → API keys"
                  aria-describedby="meta-key-help"
                />
                {user && (
                  <label className="check-toggle">
                    <input type="checkbox" checked={rememberKey} onChange={(e) => setRememberKey(e.target.checked)} />
                    Remember my key on this account
                  </label>
                )}
                <p id="meta-key-help" className="field-help">
                  {isFreeRun
                    ? `Free runs use ThePolisher's key and stop at $${(config?.freeRunBudgetUSD ?? 0).toFixed(2)} each.`
                    : `${
                        user && rememberKey
                          ? "Saved encrypted on the server so you don't have to paste it again; you can forget it anytime. Never shown again."
                          : "Used for this run only and never stored."
                      } Runs are billed to your Meta account.`}
                </p>
              </div>
            )}
            {keyError && (
              <p className="flash flash-strong" role="alert">
                <Icon name="timesCircle" size={16} />
                <span>{keyError}</span>
              </p>
            )}

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
            {config && !config.isSimulated && config.model.endsWith("-contributor") && (
              <p className="flash" role="note">
                <Icon name="info" size={16} />
                <span>
                  Runs use {prettyModel(config.model)}, Meta's lower-cost tier: Meta may use the issue, the repository code and the
                  drafts sent to it to train its models. Only use it on public repositories.
                </span>
              </p>
            )}
            {config && !config.isConfigured && (
              <p className="flash flash-strong" role="note">
                <Icon name="exclamation" size={16} />
                <span>
                  {config.setupHint} To try the demo without a key, run <code>pnpm --filter @thepolisher/web dev:sim</code>.
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
            {needsSignIn ? (
              <a className="btn btn-primary btn-md" href="/api/auth/login">
                <Icon name="github" size={16} />
                <span>Sign in with GitHub to fix this issue</span>
              </a>
            ) : (
              <Button
                type="submit"
                isLoading={isStarting}
                loadingLabel="Starting…"
                disabled={!isValid || isKeyMissing || (config !== null && !config.isConfigured && !metaKey.trim())}
                trailingIcon={<Icon name="arrowRight" size={16} />}
              >
                Fix this issue
              </Button>
            )}
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
