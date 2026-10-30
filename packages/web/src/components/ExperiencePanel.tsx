import { useCallback, useEffect, useState } from "react";
import type { LaneMemorySummary } from "@thepolisher/agents";
import { Button } from "./Button.js";
import { LANE_META } from "../maintainer/lanes.js";
import { Icon } from "./Icon.js";

const PROVIDER_LABEL: Record<string, string> = { simulated: "the simulated demo", anthropic: "Claude", meta: "the Meta model" };

interface Summary {
  provider: string;
  total: number;
  lanes: LaneMemorySummary[];
}

export function ExperiencePanel() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/experience");
      if (!res.ok) throw new Error(String(res.status));
      setSummary((await res.json()) as Summary);
      setError(null);
    } catch {
      setError("Couldn't load what the agents have learned.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = async () => {
    setIsConfirming(false);
    await fetch("/api/experience", { method: "DELETE" });
    await load();
  };

  return (
    <section className="experience" aria-labelledby="experience-title">
      <div className="experience-head">
        <div>
          <h2 id="experience-title" className="section-title">
            What the agents learned <span className="counter">{summary?.total ?? 0}</span>
          </h2>
          <p className="muted">
            Every repair is remembered with the gate's verdict. Before the next repair, each agent recalls what fixed the
            same failing checks and what broke things.
            {summary &&
              ` Showing what was learned with ${PROVIDER_LABEL[summary.provider] ?? summary.provider}; each model keeps its own memory.`}
          </p>
        </div>
        {summary && summary.total > 0 &&
          (isConfirming ? (
            <span className="ref-confirm">
              <Button variant="secondary" size="sm" onClick={() => setIsConfirming(false)}>Keep</Button>
              <Button variant="danger" size="sm" onClick={() => void forget()}>Forget all</Button>
            </span>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setIsConfirming(true)}>Forget…</Button>
          ))}
      </div>

      {error && <p className="flash flash-strong" role="alert">{error}</p>}

      {summary && summary.total === 0 ? (
        <p className="blankslate">Nothing yet. Memory fills up automatically as runs finish.</p>
      ) : (
        <div className="experience-grid">
          {summary?.lanes.map((lane) => {
            const { agent, icon } = LANE_META[lane.lane];
            return (
              <article key={lane.lane} className="box experience-lane">
                <h3 className="box-header">
                  <span className="avatar" aria-hidden="true">
                    <Icon name={icon} size={14} />
                  </span>
                  {agent}
                </h3>
                <div className="box-body">
                {/* SecurityPolish only reviews CodePolish's work, so it never has a repair to remember. */}
                {lane.lane === "security" ? (
                  <p className="muted">Reviews CodePolish's work and makes no repairs of its own, so it has nothing to remember here.</p>
                ) : (
                <>
                <p className="mono experience-tally">
                  {lane.attempts} attempts: {lane.kept} kept, {lane.rejected} rejected
                </p>
                {lane.topStrategies.length ? (
                  <ul>
                    {lane.topStrategies.map((s) => (
                      <li key={s.strategy}>
                        <span>{s.strategy}</span>
                        <span className="experience-fixes">
                          fixed {s.checks.map((c) => c.replace(/_/g, " ")).join(", ")} ({s.kept}x)
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No proven strategies yet.</p>
                )}
                </>
                )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
