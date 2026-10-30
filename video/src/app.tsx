// The real app: its own components, driven by the real events saved from a run.
import type { MaintainerEvent } from "@thepolisher/agents";
import { AgentSidebar } from "../../packages/web/src/components/AgentSidebar.js";
import { Comparison } from "../../packages/web/src/components/Comparison.js";
import { FilesChanged } from "../../packages/web/src/components/FilesChanged.js";
import { Icon, type IconName } from "../../packages/web/src/components/Icon.js";
import { PrHeader } from "../../packages/web/src/components/PrHeader.js";
import { ProofCard } from "../../packages/web/src/components/ProofCard.js";
import { Timeline } from "../../packages/web/src/components/Timeline.js";
import { initialView, maintainerReducer, type MaintainerView } from "../../packages/web/src/maintainer/reducer.js";
import rich from "./data/rich.json";

export const MODEL = "muse-spark-1.3-contributor";
export const richEvents = rich.events as unknown as MaintainerEvent[];
export const viewFrom = (events: MaintainerEvent[], n: number): MaintainerView => events.slice(0, n).reduce(maintainerReducer, initialView());
export const finalRich = richEvents.reduce(maintainerReducer, initialView());
export const richProof = finalRich.proof!;
export const REPO = finalRich.context!.repo;
export const ISSUE = finalRich.context!.issue;
export const eventIndex = (type: string) => richEvents.findIndex((e) => e.type === type);
export const clock = (n: number) => {
  const s = Math.max(0, Math.round((richEvents[Math.min(n, richEvents.length) - 1].at - richEvents[0].at) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const TopBar = ({ page = "Pull requests", repo }: { page?: string; repo?: string }) => (
  <header className="topbar">
    <div className="topbar-row">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="sync" size={18} />
        </span>
        <span className="brand-name">ThePolisher</span>
        {repo && (
          <span className="crumbs">
            <span className="crumb-sep">/</span>
            <span className="mono">{repo}</span>
          </span>
        )}
      </div>
      <div className="topbar-status">
        <span className="status-pill is-on">
          <Icon name="terminal" size={14} />
          <span className="pill-text">Sandbox on</span>
        </span>
        <span className="status-pill is-on">
          <Icon name="brain" size={14} />
          <span className="pill-text">Muse Spark 1.3 Contributor</span>
        </span>
      </div>
    </div>
    <nav className="topnav">
      {["Pull requests", "Runs", "Memory"].map((p) => (
        <button key={p} type="button" className={`topnav-link${p === page ? " is-active" : ""}`}>
          {p}
        </button>
      ))}
    </nav>
  </header>
);

export type Tab = "conversation" | "files" | "comparison";
const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: "conversation", label: "Conversation", icon: "comment" },
  { id: "files", label: "Files changed", icon: "fileCode" },
  { id: "comparison", label: "Comparison", icon: "flask" },
];

const Tabs = ({ view, tab }: { view: MaintainerView; tab: Tab }) => (
  <nav className="underline-nav">
    {TABS.filter((t) => t.id !== "comparison" || view.comparison).map((t) => (
      <button key={t.id} type="button" className={`underline-tab${tab === t.id ? " is-active" : ""}`}>
        <Icon name={t.icon} size={16} />
        {t.label}
        {t.id === "conversation" && <span className="counter">{view.feed.length}</span>}
        {t.id === "files" && <span className="counter">{view.current?.diffs.length ?? 0}</span>}
      </button>
    ))}
  </nav>
);

/** The pull request page, as RunView lays it out, with the tab set from outside. */
export const PrPage = ({ view, tab = "conversation", showProof = false }: { view: MaintainerView; tab?: Tab; showProof?: boolean }) => (
  <div className="pr-page" style={{ maxWidth: 1280, margin: "0 auto" }}>
    <PrHeader view={view} isSimulated={false} model={MODEL} />
    <Tabs view={view} tab={tab} />
    {tab === "conversation" && (
      <div className="pr-layout">
        <div className="pr-main">
          {showProof && view.proof && <ProofCard proof={view.proof} diffs={view.current?.diffs ?? []} />}
          <Timeline items={view.feed} isLive={false} />
        </div>
        <AgentSidebar lanes={view.lanes} />
      </div>
    )}
    {tab === "files" && <FilesChanged baseline={view.baseline} current={view.current} isFinal />}
    {tab === "comparison" && view.comparison && <Comparison before={view.comparison.before} after={view.comparison.after} />}
  </div>
);
