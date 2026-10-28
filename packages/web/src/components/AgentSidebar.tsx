import type { LaneId } from "@thepolisher/agents";
import { LANE_IDS, reasonText, type MaintainerView } from "../maintainer/reducer.js";
import { ACTIVE_STATES, LANE_META, STATE_LABEL, stateIcon } from "../maintainer/lanes.js";
import { Icon } from "./Icon.js";

const CLEAN_SCORE = 85;

function AgentDetail({ lane, view }: { lane: LaneId; view: MaintainerView["lanes"][LaneId] }) {
  const meta = LANE_META[lane];
  const score = view.scores[view.scores.length - 1];
  const total = view.checks ? view.checks.passed + view.checks.failed : 0;
  const isActive = ACTIVE_STATES.includes(view.state);

  return (
    <section className={`agent agent-${view.state}`} aria-labelledby={`agent-${lane}`}>
      <header className="agent-head">
        <span className="avatar" aria-hidden="true">
          <Icon name={meta.icon} size={14} />
        </span>
        <h3 id={`agent-${lane}`}>{meta.agent}</h3>
        <span className={`agent-state${isActive ? " is-active" : ""}`} aria-live="polite">
          <Icon name={stateIcon(view.state)} size={16} className={isActive ? "spin" : ""} />
          <span>{STATE_LABEL[view.state]}</span>
        </span>
      </header>

      <dl className="agent-stats">
        <div>
          <dt>{lane === "security" ? "Security review" : "Critic"}</dt>
          <dd className="mono">
            {score ?? "—"}
            <span className="muted">/100</span>
            {score !== undefined && score >= CLEAN_SCORE && <Icon name="check" size={12} label="meets the bar" />}
          </dd>
        </div>
        <div>
          <dt>Checks</dt>
          <dd className="mono">
            {view.checks ? view.checks.passed : "—"}
            <span className="muted">/{total || "—"}</span>
          </dd>
        </div>
        <div>
          <dt>Round</dt>
          <dd className="mono">{view.round}</dd>
        </div>
      </dl>

      {view.checks && view.checks.failed > 0 && (
        <ul className="agent-failing">
          {view.checks.failing.slice(0, 3).map((f) => (
            <li key={f.check}>
              <Icon name="times" size={12} />
              <span>
                <span className="failing-name">{f.check.replace(/_/g, " ")}</span> <span className="muted">{f.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="agent-foot muted">
        {lane === "security"
          ? "CodePolish's revision is only kept when this review approves it too."
          : view.decision
            ? `${view.decision.accepted ? "Kept" : "Rejected"} round ${view.decision.round}: ${reasonText(view.decision.reason)}. ${view.kept} kept, ${view.rejected} rejected.`
            : "No revision judged yet."}
        {(view.recalled.length > 0 || view.learned > 0) && (
          <span className="agent-memory">
            <Icon name="history" size={12} />
            {view.recalled.length > 0 && `${view.recalled.length} recalled`}
            {view.recalled.length > 0 && view.learned > 0 && ", "}
            {view.learned > 0 && `${view.learned} remembered`}
          </span>
        )}
      </p>
    </section>
  );
}

export function AgentSidebar({ lanes }: { lanes: MaintainerView["lanes"] }) {
  return (
    <aside className="pr-sidebar" aria-label="Reviewers">
      <h2 className="side-title">Reviewers</h2>
      {LANE_IDS.map((lane) => (
        <AgentDetail key={lane} lane={lane} view={lanes[lane]} />
      ))}
    </aside>
  );
}
