import { useState, type ReactNode } from "react";
import type { MaintainerView } from "../maintainer/reducer.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { Comparison } from "./Comparison.js";
import { FilesChanged } from "./FilesChanged.js";
import { Icon, type IconName } from "./Icon.js";
import { PrHeader } from "./PrHeader.js";
import { ProofCard } from "./ProofCard.js";
import { Timeline } from "./Timeline.js";

type Tab = "conversation" | "files" | "comparison";

type Props = {
  view: MaintainerView;
  isSimulated: boolean;
  model: string;
  /** Header button, e.g. "New issue" for a live run or "All runs" for a replay. */
  action?: { label: string; onClick: () => void };
  /** Shown above the tabs, e.g. a lost-connection warning. */
  notice?: ReactNode;
  /** The merge box for a live run; a replay passes its own read-only one. */
  mergeBox: ReactNode;
};

/** One run as a pull request page: shared by the live run and saved-run replays. */
export function RunView({ view, isSimulated, model, action, notice, mergeBox }: Props) {
  const [tab, setTab] = useState<Tab>("conversation");
  const fileCount = view.current?.diffs.length ?? view.baseline?.diffs.length ?? 0;
  const tabs: { id: Tab; label: string; icon: IconName; count?: number; isHidden?: boolean }[] = [
    { id: "conversation", label: "Conversation", icon: "comment", count: view.feed.length },
    { id: "files", label: "Files changed", icon: "fileCode", count: fileCount },
    { id: "comparison", label: "Comparison", icon: "flask", isHidden: !view.comparison },
  ];

  return (
    <div className="pr-page">
      <PrHeader view={view} isSimulated={isSimulated} model={model} action={action} />

      <nav className="underline-nav" aria-label="Pull request">
        {tabs
          .filter((t) => !t.isHidden)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              className={`underline-tab${tab === t.id ? " is-active" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
              {t.count !== undefined && <span className="counter">{t.count}</span>}
            </button>
          ))}
      </nav>

      {notice}

      {tab === "conversation" && (
        <div className="pr-layout">
          <div className="pr-main">
            {view.proof && <ProofCard proof={view.proof} diffs={view.current?.diffs ?? view.baseline?.diffs ?? []} />}
            <Timeline items={view.feed} isLive={!view.result} />
            {mergeBox}
          </div>
          <AgentSidebar lanes={view.lanes} />
        </div>
      )}
      {tab === "files" && <FilesChanged baseline={view.baseline} current={view.current} isFinal={view.result !== null} />}
      {tab === "comparison" && view.comparison && <Comparison before={view.comparison.before} after={view.comparison.after} />}
    </div>
  );
}
