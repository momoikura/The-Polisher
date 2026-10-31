import { useEffect, useState, type MouseEvent } from "react";
import { ExperiencePanel } from "./components/ExperiencePanel.js";
import { Header, type Page } from "./components/Header.js";
import { Icon } from "./components/Icon.js";
import { AboutPage, PrivacyPage, TermsPage } from "./components/InfoPages.js";
import { IssueForm } from "./components/IssueForm.js";
import { MergeBox } from "./components/MergeBox.js";
import { RunsPage } from "./components/RunsPage.js";
import { RunView } from "./components/RunView.js";
import { modelLabel } from "./maintainer/model-label.js";
import { pageFromPath, pathForPage } from "./maintainer/routes.js";
import { useAuth } from "./maintainer/useAuth.js";
import { useMaintainer } from "./maintainer/useMaintainer.js";

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
          <RunsPage user={auth.user} />
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
        <nav aria-label="About this site">
          <a {...footerLink("about")}>About</a>
          <a {...footerLink("privacy")}>Privacy</a>
          <a {...footerLink("terms")}>Terms</a>
          <a href="https://github.com/momoikura/The-Polisher" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
        <p className="muted">An independent project built for the Meta Global AI Developer Hackathon. Not made or endorsed by Meta.</p>
      </footer>
    </div>
  );
}
