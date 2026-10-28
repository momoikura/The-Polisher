import type { LaneId, SideMetrics } from "@polishloop/agents";
import { LANE_IDS } from "../maintainer/reducer.js";
import { LANE_META } from "../maintainer/lanes.js";

type Row = { label: string; before: string; after: string; better: boolean | null };

const tests = (m: SideMetrics) => (m.testsTotal === null ? "not run" : `${m.testsPassed}/${m.testsTotal} pass`);
const proves = (m: SideMetrics) => (m.provesFix === null ? "not run" : m.provesFix ? "yes" : "no");
const lint = (m: SideMetrics) => (m.lintIssues === null ? "not run" : String(m.lintIssues));
const checks = (m: SideMetrics, l: LaneId) => `${m.checks[l].passed}/${m.checks[l].total}`;
const score = (m: SideMetrics, l: LaneId) => (m.scores[l] === null ? "—" : String(m.scores[l]));

function rows(before: SideMetrics, after: SideMetrics): Row[] {
  const cmp = (b: number | null, a: number | null, higherIsBetter = true) =>
    b === null || a === null || a === b ? null : higherIsBetter ? a > b : a < b;
  const ratio = (m: SideMetrics) => (m.testsTotal ? (m.testsPassed ?? 0) / m.testsTotal : null);
  return [
    { label: "Tests", before: tests(before), after: tests(after), better: cmp(ratio(before), ratio(after)) },
    { label: "New tests prove the fix", before: proves(before), after: proves(after), better: before.provesFix === after.provesFix ? null : Boolean(after.provesFix) },
    { label: "Lint issues", before: lint(before), after: lint(after), better: cmp(before.lintIssues, after.lintIssues, false) },
    ...LANE_IDS.flatMap((l): Row[] => [
      { label: `${LANE_META[l].agent} checks`, before: checks(before, l), after: checks(after, l), better: cmp(before.checks[l].passed / Math.max(before.checks[l].total, 1), after.checks[l].passed / Math.max(after.checks[l].total, 1)) },
      { label: `${LANE_META[l].agent} critic`, before: score(before, l), after: score(after, l), better: cmp(before.scores[l], after.scores[l]) },
    ]),
    { label: "Files changed", before: String(before.files), after: String(after.files), better: null },
    { label: "Lines added", before: String(before.linesAdded), after: String(after.linesAdded), better: null },
  ];
}

export function Comparison({ before, after }: { before: SideMetrics; after: SideMetrics }) {
  return (
    <section className="comparison" aria-labelledby="cmp-title">
      <h2 id="cmp-title" className="section-title">
        One prompt vs. The Polisher
      </h2>
      <p className="muted">Same issue, same model. Every number comes from the checks and the sandbox, not from a model's opinion of itself, except the critic scores.</p>
      <div className="box table-wrap">
        <table className="cmp-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">First draft</th>
              <th scope="col">After The Polisher</th>
            </tr>
          </thead>
          <tbody>
            {rows(before, after).map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="mono">{r.before}</td>
                <td className={`mono${r.better === true ? " is-better" : r.better === false ? " is-worse" : ""}`}>
                  {r.after}
                  {r.better === true && <span className="sr-only"> (better)</span>}
                  {r.better === false && <span className="sr-only"> (worse)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
