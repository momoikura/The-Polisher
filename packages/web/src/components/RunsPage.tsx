import { useEffect, useState } from "react";
import type { MaintainerEvent } from "@thepolisher/agents";
import { initialView, maintainerReducer, type MaintainerView } from "../maintainer/reducer.js";
import { prettyModel } from "../maintainer/model-label.js";
import { Icon, type IconName } from "./Icon.js";
import { MergeBox } from "./MergeBox.js";
import { RunView } from "./RunView.js";

type RunStatus = "running" | "clean" | "verified" | "not_clean" | "failed";

interface RunRecord {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  status: RunStatus;
  totalUSD: number;
  model: string;
  startedAt: string;
}

const STATUS: Record<RunStatus, { label: string; icon: IconName }> = {
  running: { label: "Running", icon: "circleNotch" },
  clean: { label: "Ready to merge", icon: "checkCircle" },
  verified: { label: "Verified by tests", icon: "checkCircle" },
  not_clean: { label: "Changes requested", icon: "timesCircle" },
  failed: { label: "Failed", icon: "timesCircle" },
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

function Replay({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<{ view: MaintainerView; model: string } | { error: string } | null>(null);

  useEffect(() => {
    let isCurrent = true;
    getJson<{ record: RunRecord; events: Array<MaintainerEvent & { at: number }> }>(`/api/runs/${id}`)
      .then(({ record, events }) => {
        if (isCurrent) setState({ view: events.reduce(maintainerReducer, initialView()), model: prettyModel(record.model) });
      })
      .catch((err: unknown) => isCurrent && setState({ error: err instanceof Error ? err.message : "Couldn't load that run." }));
    return () => {
      isCurrent = false;
    };
  }, [id]);

  if (!state) return <p className="blankslate">Loading the run…</p>;
  if ("error" in state)
    return (
      <p className="flash flash-strong" role="alert">
        <Icon name="timesCircle" size={16} />
        <span>{state.error}</span>
      </p>
    );
  return (
    <RunView
      view={state.view}
      isSimulated={false}
      model={state.model}
      action={{ label: "All runs", onClick: onBack }}
      mergeBox={<MergeBox view={state.view} isSimulated={false} prAccess="ready" pr={{ kind: "idle" }} onOpenPr={() => {}} isReplay />}
    />
  );
}

/** Every saved run, newest first, each one replayable in full. */
export function RunsPage() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ runs: RunRecord[] }>("/api/runs")
      .then((r) => setRuns(r.runs))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Couldn't load the run history."));
  }, []);

  if (selected) return <Replay id={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="runs-page">
      <div className="new-head">
        <h1 className="page-title">Runs</h1>
        <p className="page-lede">Every run ThePolisher has made, with its full timeline, the files it changed and how it compares with a single prompt.</p>
      </div>
      {error && (
        <p className="flash flash-strong" role="alert">
          <Icon name="timesCircle" size={16} />
          <span>{error}</span>
        </p>
      )}
      {!runs && !error && <p className="blankslate">Loading runs…</p>}
      {runs?.length === 0 && <p className="blankslate">No runs yet. Fix an issue and it will show up here.</p>}
      {runs && runs.length > 0 && (
        <ul className="box run-list">
          {runs.map((r) => (
            <li key={r.id}>
              <button type="button" className="run-row" onClick={() => setSelected(r.id)}>
                <span className={`run-status run-${r.status}`}>
                  <Icon name={STATUS[r.status].icon} size={16} className={r.status === "running" ? "spin" : ""} />
                  {STATUS[r.status].label}
                </span>
                <span className="run-title">
                  <strong>{r.title || `Issue #${r.issueNumber}`}</strong>
                  <span className="muted">
                    {r.repo}#{r.issueNumber}
                  </span>
                </span>
                <span className="run-meta muted">
                  <span className="mono">${r.totalUSD.toFixed(2)}</span>
                  <time dateTime={r.startedAt}>{dateFormat.format(new Date(r.startedAt))}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
