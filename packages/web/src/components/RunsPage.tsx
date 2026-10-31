import { useEffect, useState } from "react";
import type { MaintainerEvent } from "@thepolisher/agents";
import { initialView, maintainerReducer, type MaintainerView } from "../maintainer/reducer.js";
import { prettyModel } from "../maintainer/model-label.js";
import { requestPullRequest } from "../maintainer/pull-request.js";
import type { PrState } from "../maintainer/useMaintainer.js";
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
  issueUrl: string;
  source?: "web" | "benchmark";
  benchmark?: { list: string; provesFix: boolean; baselineProvesFix: boolean | null; tests: string | null; wallSeconds: number; seenBefore: boolean; hasTimeline: boolean };
}

const STATUS: Record<RunStatus, { label: string; icon: IconName }> = {
  running: { label: "Running", icon: "circleNotch" },
  clean: { label: "Ready to merge", icon: "checkCircle" },
  verified: { label: "Verified by tests", icon: "checkCircle" },
  not_clean: { label: "Changes requested", icon: "timesCircle" },
  failed: { label: "Failed", icon: "timesCircle" },
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
/** Older benchmark runs only know the day they ran ("2026-10-29"); don't invent a time. */
const when = (startedAt: string) => (startedAt.length === 10 ? dayFormat.format(new Date(`${startedAt}T00:00:00Z`)) : dateFormat.format(new Date(startedAt)));
const yesNo = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "not measured");

/** A benchmark run saved before timelines were kept: exactly what was recorded, nothing more. */
function BenchmarkSummary({ record, onBack }: { record: RunRecord; onBack: () => void }) {
  const b = record.benchmark!;
  return (
    <div className="box benchmark-summary">
      <div className="box-header">
        <h2 className="box-title">{record.title || `Issue #${record.issueNumber}`}</h2>
        <button type="button" className="link-button" onClick={onBack}>
          All runs
        </button>
      </div>
      <div className="box-body">
        <p className="muted">
          <a className="link" href={record.issueUrl} target="_blank" rel="noopener noreferrer">
            {record.repo}#{record.issueNumber}
          </a>{" "}
          · benchmark <span className="mono">{b.list}</span> · {when(record.startedAt)}
        </p>
        <dl className="summary-grid">
          <div>
            <dt>Result</dt>
            <dd>{STATUS[record.status].label}</dd>
          </div>
          <div>
            <dt>Fix proven by its tests</dt>
            <dd>{yesNo(b.provesFix)}</dd>
          </div>
          <div>
            <dt>Single-prompt draft proven</dt>
            <dd>{yesNo(b.baselineProvesFix)}</dd>
          </div>
          <div>
            <dt>Tests after</dt>
            <dd className="mono">{b.tests ?? "—"}</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd className="mono">${record.totalUSD.toFixed(3)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd className="mono">{Math.round(b.wallSeconds / 60)} min</dd>
          </div>
        </dl>
        <p className="field-help">
          Run from the benchmark script with {prettyModel(record.model)}; only this summary was saved, not the step-by-step timeline.
          {b.seenBefore && " This issue was also used while ThePolisher was being built."}
        </p>
      </div>
    </div>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

function Replay({ id, onBack }: { id: string; onBack: () => void }) {
  const [state, setState] = useState<{ view: MaintainerView; model: string; isMine: boolean; record: RunRecord; hasEvents: boolean } | { error: string } | null>(null);
  const [pr, setPr] = useState<PrState>({ kind: "idle" });

  useEffect(() => {
    let isCurrent = true;
    getJson<{ record: RunRecord; events: Array<MaintainerEvent & { at: number }>; isMine: boolean }>(`/api/runs/${id}`)
      .then(({ record, events, isMine }) => {
        if (isCurrent)
          setState({ view: events.reduce(maintainerReducer, initialView()), model: prettyModel(record.model), isMine, record, hasEvents: events.length > 0 });
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
  if (state.record.benchmark && !state.hasEvents) return <BenchmarkSummary record={state.record} onBack={onBack} />;
  // Your own saved run can still open its pull request (the server checks it's yours too).
  return (
    <RunView
      view={state.view}
      isSimulated={false}
      model={state.model}
      action={{ label: "All runs", onClick: onBack }}
      mergeBox={
        <MergeBox
          view={state.view}
          isSimulated={false}
          prAccess="ready"
          pr={pr}
          onOpenPr={() => {
            setPr({ kind: "opening" });
            void requestPullRequest(id).then(setPr);
          }}
          isReplay={!state.isMine}
        />
      }
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
                  {r.source === "benchmark" && <span className="label">Benchmark</span>}
                  <span className="muted">
                    {r.repo}#{r.issueNumber}
                  </span>
                </span>
                <span className="run-meta muted">
                  <span className="mono">${r.totalUSD.toFixed(2)}</span>
                  <time dateTime={r.startedAt}>{when(r.startedAt)}</time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
