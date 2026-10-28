import type { MaintainerConfig } from "../maintainer/useMaintainer.js";
import { modelLabel } from "../maintainer/model-label.js";
import { Icon } from "./Icon.js";

export type Page = "maintainer" | "memory";

const PAGES: Array<{ id: Page; label: string }> = [
  { id: "maintainer", label: "Pull requests" },
  { id: "memory", label: "Memory" },
];

type Props = { config: MaintainerConfig | null; repo: string | null; page: Page; onNavigate: (page: Page) => void };

export function Header({ config, repo, page, onNavigate }: Props) {
  const modelText = modelLabel(config);

  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="sync" size={18} />
          </span>
          <span className="brand-name">PolishLoop</span>
          {repo && (
            <span className="crumbs">
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="mono">{repo}</span>
            </span>
          )}
        </div>

        <div className="topbar-status">
          {config && (
            <span className={`status-pill${config.isSandboxConfigured ? " is-on" : ""}`} title={config.isSandboxConfigured ? "Patches are tested in a Modal sandbox" : "Set SANDBOX_URL and SANDBOX_TOKEN to run tests on Modal"}>
              <Icon name="terminal" size={14} />
              <span className="pill-text">Sandbox {config.isSandboxConfigured ? (config.isSimulated ? "scripted" : "on") : "off"}</span>
            </span>
          )}
          <span className={`status-pill${config?.isConfigured ? " is-on" : ""}`} role="status">
            <Icon name="brain" size={14} />
            <span className="pill-text">{modelText}</span>
          </span>
        </div>
      </div>

      <nav className="topnav" aria-label="Main">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`topnav-link${page === p.id ? " is-active" : ""}`}
            aria-current={page === p.id ? "page" : undefined}
            onClick={() => onNavigate(p.id)}
          >
            <Icon name={p.id === "maintainer" ? "codeBranch" : "history"} size={16} />
            {p.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
