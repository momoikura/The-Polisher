import { useState } from "react";
import { AgentSidebar } from "./components/AgentSidebar.js";
import { Comparison } from "./components/Comparison.js";
import { ExperiencePanel } from "./components/ExperiencePanel.js";
import { FilesChanged } from "./components/FilesChanged.js";
import { Header, type Page } from "./components/Header.js";
import { Icon, type IconName } from "./components/Icon.js";
import { IssueForm } from "./components/IssueForm.js";
import { MergeBox } from "./components/MergeBox.js";
import { PrHeader } from "./components/PrHeader.js";
import { Timeline } from "./components/Timeline.js";
import { useMaintainer } from "./maintainer/useMaintainer.js";

type Tab = "conversation" | "files" | "comparison";

export default function App() {
  const { view, config, runId, start, reset, startError, isStarting, isConnectionLost, pr, openPr } = useMaintainer();
  const [page, setPage] = useState<Page>("maintainer");
  const [tab, setTab] = useState<Tab>("conversation");
  const isSimulated = config?.isSimulated ?? false;

  const fileCount = view.current?.diffs.length ?? view.baseline?.diffs.length ?? 0;
  const tabs: { id: Tab; label: string; icon: IconName; count?: number; isHidden?: boolean }[] = [
    { id: "conversation", label: "Conversation", icon: "comment", count: view.feed.length },
    { id: "files", label: "Files changed", icon: "fileCode", count: fileCount },
    { id: "comparison", label: "Comparison", icon: "flask", isHidden: !view.comparison },
  ];

  const handleNewRun = () => {
    setTab("conversation");
    reset();
  };

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header config={config} repo={page === "maintainer" ? (view.context?.repo ?? null) : null} page={page} onNavigate={setPage} />

      <main id="main" className="container">
        {page === "memory" ? (
          <div className="memory-page">
            <div className="new-head">
              <h1 className="page-title">Memory</h1>
              <p className="page-lede">
                After every revision the agents record what they tried and whether the gate kept it. Before the next
                revision they recall what fixed the same failing checks, and what broke things.
              </p>
            </div>
            <ExperiencePanel />
          </div>
        ) : !runId ? (
          <IssueForm config={config} isStarting={isStarting} error={startError} onStart={(url, budget) => void start(url, budget)} />
        ) : (
          <div className="pr-page">
            <PrHeader view={view} isSimulated={isSimulated} onNewRun={handleNewRun} />

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

            {isConnectionLost && !view.result && (
              <p className="flash flash-strong" role="alert">
                <Icon name="exclamation" size={16} />
                <span>Lost the live connection to the server. The run may still be going; reload the page to reattach.</span>
              </p>
            )}

            {tab === "conversation" && (
              <div className="pr-layout">
                <div className="pr-main">
                  <Timeline items={view.feed} isLive={!view.result} />
                  <MergeBox
                    view={view}
                    isSimulated={isSimulated}
                    hasGitHubToken={config?.hasGitHubToken ?? false}
                    pr={pr}
                    onOpenPr={() => void openPr()}
                  />
                </div>
                <AgentSidebar lanes={view.lanes} />
              </div>
            )}
            {tab === "files" && <FilesChanged baseline={view.baseline} current={view.current} isFinal={view.result !== null} />}
            {tab === "comparison" && view.comparison && (
              <Comparison before={view.comparison.before} after={view.comparison.after} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
