import { useState } from "react";
import type { FileDiff } from "@polishloop/agents";
import type { Side } from "../maintainer/reducer.js";
import { Icon } from "./Icon.js";

type Version = "final" | "draft";

function DiffFile({ diff, isOpen }: { diff: FileDiff; isOpen: boolean }) {
  return (
    <details className="diff-file" open={isOpen}>
      <summary>
        <Icon name="fileCode" size={16} />
        <span className="mono diff-path">{diff.path}</span>
        {diff.status === "added" && <span className="label">New</span>}
        <span className="mono diff-stat">
          +{diff.added} −{diff.removed}
          <span className="diff-blocks" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => {
              const total = diff.added + diff.removed || 1;
              const filled = Math.round((diff.added / total) * 5);
              return <span key={i} className={i < filled ? "is-add" : "is-del"} />;
            })}
          </span>
        </span>
      </summary>
      <div className="diff-body">
        <table className="diff-table">
          <tbody>
            {diff.lines.map((l, i) => (
              <tr key={i} className={`diff-${l.type}`}>
                <td className="diff-sign" aria-hidden="true">
                  {l.type === "added" ? "+" : l.type === "removed" ? "−" : l.type === "gap" ? "⋯" : ""}
                </td>
                <td className="diff-code">
                  {l.type === "added" && <span className="sr-only">Added: </span>}
                  {l.type === "removed" && <span className="sr-only">Removed: </span>}
                  {l.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

type Props = { baseline: Side | null; current: Side | null; isFinal: boolean };

export function FilesChanged({ baseline, current, isFinal }: Props) {
  const [version, setVersion] = useState<Version>("final");
  const [showDescription, setShowDescription] = useState(false);
  const side = version === "final" ? current : baseline;
  const added = side?.diffs.reduce((n, d) => n + d.added, 0) ?? 0;
  const removed = side?.diffs.reduce((n, d) => n + d.removed, 0) ?? 0;

  return (
    <section className="files" aria-label="Files changed">
      <div className="files-toolbar">
        <div className="segmented" role="radiogroup" aria-label="Version">
          {(["final", "draft"] as const).map((v) => (
            <label key={v} className={`segment${version === v ? " is-active" : ""}`}>
              <input type="radio" name="version" checked={version === v} onChange={() => setVersion(v)} />
              {v === "final" ? (isFinal ? "After The Polisher" : "Current best") : "First draft"}
            </label>
          ))}
        </div>
        <label className="check-toggle">
          <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} />
          Show PR description
        </label>
        <span className="mono files-total">
          {side?.diffs.length ?? 0} files <strong>+{added}</strong> <span className="muted">−{removed}</span>
        </span>
      </div>

      <p className="files-note muted">
        {version === "draft" ? "One prompt, no review. Kept unchanged so you can compare." : isFinal ? "The version the reviewers approved, or the best they reached." : "Updates live as revisions are kept."}
      </p>

      {!side ? (
        <p className="blankslate">Nothing written yet.</p>
      ) : (
        <>
          {showDescription && <pre className="pr-text">{side.pr}</pre>}
          {side.diffs.length === 0 ? (
            <p className="blankslate">No file changes.</p>
          ) : (
            <div className="diff-list">
              {side.diffs.map((d, i) => (
                <DiffFile key={`${version}-${d.path}`} diff={d} isOpen={i < 3} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
