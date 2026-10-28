import type { MaintainerView } from "../maintainer/reducer.js";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";

const PHASES = [
  { id: "fetching", label: "Read" },
  { id: "planning", label: "Plan" },
  { id: "baseline", label: "Draft" },
  { id: "polishing", label: "Review" },
  { id: "reconciling", label: "Reconcile" },
  { id: "done", label: "Done" },
] as const;

function stateLabel(view: MaintainerView): { text: string; tone: "solid" | "outline" } {
  if (!view.result) return { text: "In review", tone: "outline" };
  if (view.result.status === "clean") return { text: "Ready to merge", tone: "solid" };
  if (view.result.status === "verified") return { text: "Verified by tests", tone: "solid" };
  if (view.result.status === "failed") return { text: "Failed", tone: "outline" };
  return { text: "Changes requested", tone: "outline" };
}

type Props = { view: MaintainerView; isSimulated: boolean; model: string; onNewRun: () => void };

export function PrHeader({ view, isSimulated, model, onNewRun }: Props) {
  const ctx = view.context;
  const state = stateLabel(view);
  const currentIndex = PHASES.findIndex((p) => p.id === view.phase);
  const pct = view.budgetUSD > 0 ? Math.min(100, (view.costUSD / view.budgetUSD) * 100) : 0;
  const rounds = Math.max(...Object.values(view.lanes).map((l) => l.round), 0);

  return (
    <section className="pr-header" aria-labelledby="pr-title">
      <div className="pr-title-row">
        <h1 id="pr-title" className="pr-title">
          {ctx ? ctx.issue.title : "Reading the issue…"}{" "}
          {ctx && <span className="pr-number">#{ctx.issue.number}</span>}
        </h1>
        {view.result && (
          <Button variant="secondary" size="sm" onClick={onNewRun}>
            New issue
          </Button>
        )}
      </div>

      <div className="pr-meta">
        <span className={`state-label state-${state.tone}`}>
          <Icon name={state.tone === "solid" ? "checkCircle" : view.result ? "timesCircle" : "codeBranch"} size={16} />
          {state.text}
        </span>
        <p className="pr-meta-text">
          {ctx ? (
            <>
              ThePolisher wants to fix{" "}
              <a href={ctx.issue.url} target="_blank" rel="noopener noreferrer" className="link">
                {ctx.repo}#{ctx.issue.number}
              </a>{" "}
              on <span className="mono branch">{ctx.sha.slice(0, 7)}</span>
              {isSimulated ? <span className="label">Demo</span> : <span className="label">{model}</span>}
            </>
          ) : (
            "Starting…"
          )}
        </p>
      </div>

      <div className="pr-progress">
        <ol className="phase-track" aria-label="Progress">
          {PHASES.map((p, i) => (
            <li
              key={p.id}
              className={i < currentIndex ? "is-done" : i === currentIndex ? "is-current" : ""}
              aria-current={i === currentIndex ? "step" : undefined}
            >
              {i < currentIndex ? <Icon name="check" size={12} /> : <span className="phase-dot" aria-hidden="true" />}
              {p.label}
            </li>
          ))}
        </ol>
        <div className="spend" aria-label={`Spent $${view.costUSD.toFixed(3)} of $${view.budgetUSD.toFixed(2)}`}>
          <span className="muted">Round {rounds}</span>
          <span className="mono">
            ${view.costUSD.toFixed(3)} <span className="muted">/ ${view.budgetUSD ? view.budgetUSD.toFixed(2) : "—"}</span>
          </span>
          <span className="meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
        </div>
      </div>
    </section>
  );
}
