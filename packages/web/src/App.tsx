import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ExperiencePanel } from "./components/ExperiencePanel.js";
import { Header, type Page } from "./components/Header.js";
import { Icon } from "./components/Icon.js";
import { AboutPage, PrivacyPage, TermsPage } from "./components/InfoPages.js";
import { IssueForm } from "./components/IssueForm.js";
import { MergeBox } from "./components/MergeBox.js";
import { RunsPage } from "./components/RunsPage.js";
import { RunView } from "./components/RunView.js";
import { modelLabel } from "./maintainer/model-label.js";
import { EVIDENCE } from "./maintainer/evidence.js";
import { pageFromPath, pathForPage } from "./maintainer/routes.js";
import { useAuth } from "./maintainer/useAuth.js";
import { useMaintainer } from "./maintainer/useMaintainer.js";

const REPO_URL = "https://github.com/momoikura/The-Polisher";

const ExternalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
    <Icon name="external" size={12} />
  </a>
);

export default function App() {
  const { view, config, runId, start, reset, startError, isStarting, isConnectionLost, pr, openPr } = useMaintainer();
  const auth = useAuth();
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  useEffect(() => {
    const onBack = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);
  const navigate = (next: Page) => {
    if (next !== page) window.history.pushState(null, "", pathForPage(next));
    setPage(next);
    window.scrollTo(0, 0);
  };
  const footerLink = (next: Page) => ({
    href: pathForPage(next),
    onClick: (e: MouseEvent) => {
      e.preventDefault();
      navigate(next);
    },
  });
  const isSimulated = config?.isSimulated ?? false;

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header config={config} auth={auth} repo={page === "maintainer" ? (view.context?.repo ?? null) : null} page={page} onNavigate={navigate} />

      <main id="main" className="container">
        {auth.error && (
          <p className="flash flash-strong" role="alert">
            <Icon name="timesCircle" size={16} />
            <span>{auth.error}</span>
          </p>
        )}
        {page === "about" ? (
          <AboutPage />
        ) : page === "privacy" ? (
          <PrivacyPage />
        ) : page === "terms" ? (
          <TermsPage />
        ) : page === "memory" ? (
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
        ) : page === "runs" ? (
          <RunsPage />
        ) : !runId ? (
          <IssueForm
            config={config}
            user={auth.user}
            isStarting={isStarting}
            error={startError}
            onStart={(url, budget, key, remember) =>
              void start(url, budget, key, remember).then((started) => {
                if (started && key && remember) auth.markKeySaved();
              })
            }
            onForgetKey={auth.forgetKey}
          />
        ) : (
          <RunView
            view={view}
            isSimulated={isSimulated}
            model={modelLabel(config)}
            action={{ label: "New issue", onClick: reset }}
            notice={
              isConnectionLost &&
              !view.result && (
                <p className="flash flash-strong" role="alert">
                  <Icon name="exclamation" size={16} />
                  <span>Lost the live connection to the server. The run may still be going; reload the page to reattach.</span>
                </p>
              )
            }
            mergeBox={
              <MergeBox view={view} isSimulated={isSimulated} prAccess={config?.prAccess ?? "set_token"} pr={pr} onOpenPr={() => void openPr()} />
            }
          />
        )}
      </main>
      <footer className="site-footer">
        <div className="footer-columns">
          <nav aria-label="Product">
            <h2>Product</h2>
            <a {...footerLink("maintainer")}>Fix an issue</a>
            <a {...footerLink("runs")}>Runs</a>
            <a {...footerLink("memory")}>Memory</a>
          </nav>
          <nav aria-label="Learn">
            <h2>Learn</h2>
            <a {...footerLink("about")}>About</a>
            <ExternalLink href={EVIDENCE.url}>Benchmarks</ExternalLink>
            <ExternalLink href={`${REPO_URL}/blob/main/docs/architecture.md`}>Architecture</ExternalLink>
            <ExternalLink href={`${REPO_URL}#run-it-locally`}>Run it yourself</ExternalLink>
          </nav>
          <nav aria-label="Project">
            <h2>Project</h2>
            <ExternalLink href={REPO_URL}>Source on GitHub</ExternalLink>
            <ExternalLink href={`${REPO_URL}/issues`}>Report an issue</ExternalLink>
            <a {...footerLink("privacy")}>Privacy</a>
            <a {...footerLink("terms")}>Terms</a>
          </nav>
        </div>
        <p className="muted">
          MIT licensed. Built for the Meta Global AI Developer Hackathon 2026. An independent project, not made or endorsed by Meta.
        </p>
      </footer>
    </div>
  );
}
