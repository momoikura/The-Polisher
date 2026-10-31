import type { ReactNode } from "react";
import { EVIDENCE } from "../maintainer/evidence.js";

const REPO_URL = "https://github.com/momoikura/The-Polisher";
const ISSUES_URL = `${REPO_URL}/issues`;
const CONTACT_EMAIL = "markdanila12@gmail.com";
const UPDATED = "October 31, 2026";

const External = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children}
  </a>
);

const Email = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const Page = ({ title, lede, updated, children }: { title: string; lede: string; updated?: boolean; children: ReactNode }) => (
  <article className="info-page">
    <div className="new-head">
      <h1 className="page-title">{title}</h1>
      <p className="page-lede">{lede}</p>
      {updated && <p className="info-updated muted">Last updated {UPDATED}</p>}
    </div>
    {children}
  </article>
);

export function AboutPage() {
  return (
    <Page title="About ThePolisher" lede="A verifiable agent: paste a GitHub issue from a Python repository and get a pull request whose tests prove the fix.">
      <h2>Why it exists</h2>
      <p>
        AI can write a fix in seconds. Someone still has to check it, and open source maintainers are being flooded with AI pull requests they can't trust without checking each one. ThePolisher is for maintainers
        and contributors who need a pull request that comes with evidence.
      </p>

      <h2>How it works</h2>
      <ol>
        <li>Muse Spark, Meta's model, reads the issue, the code and any screenshots, then writes three fixes at once.</li>
        <li>Each fix runs in its own sandbox, and the tests pick the one to continue with.</li>
        <li>Four agents improve the code, security, docs and pull request description. A revision is only kept if it doesn't break a check that was passing.</li>
        <li>The whole test suite runs on a fresh copy of the repository. New tests must fail on the original code and pass with the fix.</li>
        <li>You review the result. A pull request opens only when you click and confirm.</li>
      </ol>

      <h2>Results</h2>
      <p>
        On {EVIDENCE.issues} real open issues in {EVIDENCE.projects} popular Python projects, with the list committed before any run, ThePolisher proved {EVIDENCE.proven} fixes. A single prompt with the same model
        proved {EVIDENCE.singlePrompt}. <External href={EVIDENCE.url}>Every issue and the method</External> are published, including the ones it couldn't prove.
      </p>

      <h2>Limits</h2>
      <ul>
        <li>It works on public Python repositories with pytest tests.</li>
        <li>Proven means the new tests fail before the fix and pass after it. You should still review every change.</li>
        <li>It doesn't prove every issue. When it can't, it says so.</li>
      </ul>

      <h2>Who made it</h2>
      <p>
        ThePolisher was built for the Meta Global AI Developer Hackathon. It is an independent project, not made or endorsed by Meta. The code is <External href={REPO_URL}>open source on GitHub</External> under the
        MIT license. For questions, email <Email />. For bug reports, <External href={ISSUES_URL}>open an issue</External>.
      </p>
    </Page>
  );
}

export function PrivacyPage() {
  return (
    <Page title="Privacy" lede="What ThePolisher collects, why, who else handles it, and how to remove it." updated>
      <h2>The short version</h2>
      <ul>
        <li>
          <strong>Runs are public.</strong> Anyone can see a run on the Runs page. Don't use ThePolisher on anything you want to keep private.
        </li>
        <li>
          <strong>Meta may train on what is sent to it.</strong> Runs use a Meta model tier that allows this.
        </li>
        <li>There are no ads, no analytics and no tracking cookies. Your data isn't sold.</li>
      </ul>

      <h2>What is collected</h2>
      <table className="info-table">
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Why</th>
            <th scope="col">How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>GitHub username, user ID and avatar link</td>
            <td>To sign you in and count your free runs</td>
            <td>The session lasts up to 7 days. Your user ID stays with your free-run count and any saved key.</td>
          </tr>
          <tr>
            <td>GitHub access token, encrypted</td>
            <td>To open a pull request when you ask, as you</td>
            <td>Removed when you sign out. Otherwise it stops being used after 7 days, though the encrypted record may remain until cleaned up.</td>
          </tr>
          <tr>
            <td>Meta API key, if you enter one</td>
            <td>To pay for your run with your own account</td>
            <td>"Remember my key" is on by default when you're signed in: the key is stored encrypted until you choose "Forget it". Untick it and the key is used for that run only.</td>
          </tr>
          <tr>
            <td>Runs: the issue link and text, code changes, test results, cost and your GitHub username</td>
            <td>To show results and let you open the pull request later</td>
            <td>Kept until removed. Everything except your username is public. Your username stays on the server, to apply run limits and let only you open the run's pull request.</td>
          </tr>
          <tr>
            <td>Lessons from runs the tests verified: short notes on what worked</td>
            <td>To improve later runs for all users</td>
            <td>Kept. They describe strategies and aren't linked to your username.</td>
          </tr>
          <tr>
            <td>Server logs, such as errors and request details</td>
            <td>To keep the service running and fix problems</td>
            <td>Handled under the hosting providers' policies.</td>
          </tr>
        </tbody>
      </table>

      <h2>GitHub permissions</h2>
      <p>
        Signing in asks for <code>read:user</code>, to know who you are, and <code>public_repo</code>, which lets the app fork public repositories and open pull requests as you. That permission covers all your public
        repositories, but ThePolisher only uses it after you click "Open pull request" and confirm. You can revoke access at any time in your{" "}
        <External href="https://github.com/settings/applications">GitHub settings</External>.
      </p>

      <h2>Who else handles data</h2>
      <ul>
        <li>
          <strong>Meta</strong> runs the model. It receives the issue, repository code and drafts, and may use them to train its models.
        </li>
        <li>
          <strong>GitHub</strong> handles sign-in, repository reading and pull requests.
        </li>
        <li>
          <strong>Modal</strong> hosts the server and runs repository code in sandboxes that hold no secrets.
        </li>
        <li>
          <strong>Amazon Web Services</strong> stores the data in the Asia Pacific (Sydney) region.
        </li>
        <li>
          <strong>Cloudflare</strong> serves the website and passes requests to the server.
        </li>
      </ul>
      <p>These companies may process data in other countries.</p>

      <h2>Cookies</h2>
      <p>ThePolisher uses only the cookies sign-in needs: one short-lived security cookie during sign-in, and a session cookie that lasts up to 7 days. Page scripts can't read them.</p>

      <h2>Your choices</h2>
      <ul>
        <li>Sign out to end your session and remove its stored GitHub token.</li>
        <li>Choose "Forget it" on the issue form to delete a remembered Meta key.</li>
        <li>Revoke the app's access in your GitHub settings.</li>
        <li>
          To remove a run or your other data, email <Email />. Lessons and data already sent to Meta may not be removable.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions about privacy: <Email />.
      </p>

      <h2>Children</h2>
      <p>ThePolisher requires a GitHub account and isn't meant for children under 13.</p>

      <h2>Changes</h2>
      <p>If this page changes, the date at the top changes too. The history is public in the project's repository.</p>
    </Page>
  );
}

export function TermsPage() {
  return (
    <Page title="Terms" lede="The simple rules for using ThePolisher." updated>
      <h2>A hackathon project</h2>
      <p>ThePolisher is an experimental project built for a hackathon. It may change, break or shut down at any time, and saved runs may be lost.</p>

      <h2>You are responsible for what you submit</h2>
      <ul>
        <li>ThePolisher writes code with AI, and AI makes mistakes. Passing tests don't guarantee a change is correct or safe.</li>
        <li>Review every change before you open a pull request. A pull request is opened as you, and it is yours.</li>
        <li>Follow each project's contribution rules, including its rules on AI. Some don't accept AI-generated pull requests.</li>
      </ul>

      <h2>Fair use</h2>
      <ul>
        <li>Only use it on public repositories and on content you are allowed to share. Runs are public, and Meta may train on what is sent to it.</li>
        <li>Don't use it to flood projects with pull requests, or to attack, overload or misuse the service, its sandboxes or anyone else's systems.</li>
        <li>Don't try to get around the limits on free runs.</li>
      </ul>

      <h2>Keys and costs</h2>
      <p>If you use your own Meta API key, runs are billed to your Meta account up to the budget you choose. Cost figures in the app are estimates. Your Meta account remains your responsibility.</p>

      <h2>No warranty</h2>
      <p>
        ThePolisher is provided as is, without warranties of any kind. To the extent the law allows, its authors aren't liable for damage from using it, including from code it writes or pull requests you open with it.
      </p>

      <h2>Open source</h2>
      <p>
        The code is available under the <External href={`${REPO_URL}/blob/main/LICENSE`}>MIT license</External>. "Meta" and "Muse Spark" belong to Meta. ThePolisher is not made or endorsed by Meta.
      </p>

      <h2>Contact</h2>
      <p>
        Email <Email />, or <External href={ISSUES_URL}>open an issue on GitHub</External>.
      </p>
    </Page>
  );
}
