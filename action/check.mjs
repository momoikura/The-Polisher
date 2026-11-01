// Runs on the project's GitHub Actions runner. It never checks out or runs the pull request's code:
// it sends the PR's link to ThePolisher, whose sandbox runs the code, then posts the result as a comment.
// A verdict never fails the workflow: this informs the maintainer, who decides.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const MARKER = "<!-- thepolisher-check -->";
const POLL_MS = 15_000;
/** The server stops a check at 20 minutes. */
const MAX_WAIT_MS = 25 * 60_000;
const BUSY_RETRIES = 8;
const BUSY_WAIT_MS = 60_000;

const input = (env, name) => (env[`INPUT_${name.toUpperCase()}`] ?? "").trim();

async function startCheck({ server, pullUrl, metaApiKey, fetch, sleep }) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${server}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pullUrl, metaApiKey }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.id) return data.id;
    // One check per repo at a time, so a burst of PRs waits its turn.
    if (res.status === 429 && attempt < BUSY_RETRIES) {
      await sleep(BUSY_WAIT_MS);
      continue;
    }
    throw new Error(data.error ?? `ThePolisher returned HTTP ${res.status}.`);
  }
}

async function waitForCheck({ server, id, fetch, sleep }) {
  const started = Date.now();
  while (Date.now() - started < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    const res = await fetch(`${server}/api/runs/${id}`);
    if (!res.ok) continue; // Saving the run's start can lag behind the first poll.
    const run = await res.json();
    if (run.record?.status === "running") continue;
    const check = run.events?.find((e) => e.type === "pr_check")?.check;
    if (check) return check;
    const error = run.events?.findLast((e) => e.type === "error")?.message;
    throw new Error(error ?? "The check ended without a result.");
  }
  throw new Error("The check didn't finish in time.");
}

async function postComment({ repo, number, body, token, fetch }) {
  const api = `https://api.github.com/repos/${repo}/issues`;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const listed = await fetch(`${api}/${number}/comments?per_page=100`, { headers });
  if (!listed.ok) throw new Error(`GitHub returned HTTP ${listed.status} reading comments.`);
  // Updated in place, so new commits don't pile up comments.
  const existing = (await listed.json()).find((c) => c.body?.includes(MARKER));
  const res = await fetch(existing ? `${api}/comments/${existing.id}` : `${api}/${number}/comments`, {
    method: existing ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ body: `${MARKER}\n${body}` }),
  });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status} posting the comment. Does the workflow have pull-requests: write?`);
}

export async function runAction({ env, fetch, readEvent, log, sleep }) {
  const pull = readEvent().pull_request;
  if (!pull) {
    log("::warning::ThePolisher only checks pull_request or pull_request_target events.");
    return;
  }
  const metaApiKey = input(env, "meta-api-key");
  if (!metaApiKey) {
    log("::warning::No meta-api-key. Add it as a repository secret. Secrets aren't available to pull_request workflows from forks; use pull_request_target.");
    return;
  }
  log(`::add-mask::${metaApiKey}`);
  const server = input(env, "server").replace(/\/+$/, "");
  try {
    const id = await startCheck({ server, pullUrl: pull.html_url, metaApiKey, fetch, sleep });
    log(`Checking ${pull.html_url}: ${server}/runs/${id}`);
    const check = await waitForCheck({ server, id, fetch, sleep });
    await postComment({ repo: env.GITHUB_REPOSITORY, number: pull.number, body: check.comment, token: input(env, "github-token"), fetch });
    log(`${check.headline}.`);
  } catch (err) {
    log(`::warning::ThePolisher couldn't check this PR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAction({
    env: process.env,
    fetch: globalThis.fetch,
    readEvent: () => JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    log: console.log,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}
