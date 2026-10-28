/**
 * GitHub access for the Auto-Maintainer. Reads are anonymous unless a token is
 * given; the only write (createPullRequest) happens on an explicit user action.
 */

import { z } from "zod";

const API = "https://api.github.com";
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

/** Accepts only https://github.com/{owner}/{repo}/issues/{n} (optionally with #anchor or query). */
export function parseIssueUrl(input: string): IssueRef {
  const m = input.trim().match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)\/?(?:[?#].*)?$/);
  const isName = (s: string) => NAME.test(s) && !/^\.+$/.test(s);
  if (!m || !isName(m[1]) || !isName(m[2])) {
    throw new Error("Use a GitHub issue link like https://github.com/owner/repo/issues/123.");
  }
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string(),
  state: z.string(),
  pull_request: z.unknown().optional(),
});
export type Issue = z.infer<typeof IssueSchema>;

const RepoSchema = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  private: z.boolean(),
  permissions: z.object({ push: z.boolean() }).partial().optional(),
});

const TreeSchema = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional() })),
  truncated: z.boolean(),
});

export class GitHubError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GitHubClientOptions {
  token?: string;
  fetchFn?: typeof fetch;
  /** Wait between checks while GitHub finishes creating a fork (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface RepoRef {
  owner: string;
  repo: string;
}

const FORK_READY_ATTEMPTS = 10;
const FORK_READY_DELAY_MS = 3_000;

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  headSha: string;
  isPrivate: boolean;
  canPush: boolean;
}

export interface FileEntry {
  path: string;
  size: number;
}

export interface PullRequestInput {
  owner: string;
  repo: string;
  /** Where the branch is pushed when it isn't the repo itself (a fork); the PR still targets owner/repo. */
  head?: RepoRef;
  baseBranch: string;
  baseSha: string;
  branch: string;
  /** New full content per path; null deletes the file. */
  files: Record<string, string | null>;
  title: string;
  body: string;
}

export class GitHubClient {
  private readonly fetchFn: typeof fetch;
  constructor(private readonly opts: GitHubClientOptions = {}) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  hasToken(): boolean {
    return Boolean(this.opts.token);
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) throw new GitHubError("Not found on GitHub (or the token can't see it).", 404);
    if (res.status === 401) throw new GitHubError("GitHub rejected GITHUB_TOKEN.", 401);
    if (res.status === 403 || res.status === 429) {
      throw new GitHubError(
        this.opts.token ? "GitHub refused the request (permissions or rate limit)." : "GitHub rate limit hit; set GITHUB_TOKEN for higher limits.",
        res.status
      );
    }
    if (!res.ok) throw new GitHubError(`GitHub returned HTTP ${res.status}.`, res.status);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new GitHubError("GitHub returned an unexpected response.");
    return parsed.data;
  }

  async getIssue(ref: IssueRef): Promise<Issue> {
    const issue = await this.request(`/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`, IssueSchema);
    if (issue.pull_request) throw new GitHubError("That link is a pull request, not an issue.");
    return issue;
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const info = await this.request(`/repos/${owner}/${repo}`, RepoSchema);
    const branch = await this.request(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(info.default_branch)}`,
      z.object({ commit: z.object({ sha: z.string() }) })
    );
    return {
      fullName: info.full_name,
      defaultBranch: info.default_branch,
      headSha: branch.commit.sha,
      isPrivate: info.private,
      canPush: info.permissions?.push ?? false,
    };
  }

  async listFiles(owner: string, repo: string, sha: string): Promise<{ files: FileEntry[]; truncated: boolean }> {
    const tree = await this.request(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`, TreeSchema);
    return {
      files: tree.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size ?? 0 })),
      truncated: tree.truncated,
    };
  }

  async getFile(owner: string, repo: string, path: string, sha: string): Promise<string> {
    const file = await this.request(
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
      z.object({ content: z.string(), encoding: z.literal("base64") })
    );
    return Buffer.from(file.content, "base64").toString("utf8");
  }

  /**
   * The token's fork of owner/repo (created if needed), with its default branch
   * synced to the original so the commit a fix was built on exists in the fork.
   */
  async forkFor(owner: string, repo: string, defaultBranch: string): Promise<RepoRef> {
    if (!this.opts.token) throw new GitHubError("Set GITHUB_TOKEN to open pull requests.");
    const me = await this.request("/user", z.object({ login: z.string() }));
    if (me.login.toLowerCase() === owner.toLowerCase()) {
      throw new GitHubError(`${owner}/${repo} is your own repo, but GITHUB_TOKEN can't push to it. Give the token repo access.`);
    }
    const fork = await this.request(`/repos/${owner}/${repo}/forks`, z.object({ name: z.string(), owner: z.object({ login: z.string() }) }), {
      method: "POST",
      body: JSON.stringify({ default_branch_only: true }),
    });
    const ref = { owner: fork.owner.login, repo: fork.name };
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    // Forking is asynchronous: until GitHub finishes, the fork answers 404/409.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.request(`/repos/${ref.owner}/${ref.repo}/merge-upstream`, z.object({}).passthrough(), {
          method: "POST",
          body: JSON.stringify({ branch: defaultBranch }),
        });
        return ref;
      } catch (err) {
        const pending = err instanceof GitHubError && (err.status === 404 || err.status === 409);
        if (!pending || attempt >= FORK_READY_ATTEMPTS) {
          throw new GitHubError(`Couldn't sync your fork ${ref.owner}/${ref.repo} with ${owner}/${repo}. Sync it on GitHub and try again.`);
        }
        await sleep(FORK_READY_DELAY_MS);
      }
    }
  }

  /** Branch + commit + PR through the Git Data API. Requires push access to the head repo. */
  async createPullRequest(input: PullRequestInput): Promise<{ url: string; number: number }> {
    if (!this.opts.token) throw new GitHubError("Set GITHUB_TOKEN to open pull requests.");
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(input.branch) || input.branch.includes("..")) {
      throw new GitHubError("Invalid branch name.");
    }
    const headRepo = input.head ?? { owner: input.owner, repo: input.repo };
    const base = `/repos/${headRepo.owner}/${headRepo.repo}`;
    const sha = z.object({ sha: z.string() });

    const entries = await Promise.all(
      Object.entries(input.files).map(async ([path, content]) => {
        if (content === null) return { path, mode: "100644", type: "blob", sha: null };
        const blob = await this.request(`${base}/git/blobs`, sha, {
          method: "POST",
          body: JSON.stringify({ content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" }),
        });
        return { path, mode: "100644", type: "blob", sha: blob.sha };
      })
    );
    const tree = await this.request(`${base}/git/trees`, sha, {
      method: "POST",
      body: JSON.stringify({ base_tree: input.baseSha, tree: entries }),
    });
    const commit = await this.request(`${base}/git/commits`, sha, {
      method: "POST",
      body: JSON.stringify({ message: input.title, tree: tree.sha, parents: [input.baseSha] }),
    });
    await this.request(`${base}/git/refs`, z.object({ ref: z.string() }), {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: commit.sha }),
    });
    const head = input.head ? `${input.head.owner}:${input.branch}` : input.branch;
    const pr = await this.request(`/repos/${input.owner}/${input.repo}/pulls`, z.object({ html_url: z.string(), number: z.number() }), {
      method: "POST",
      body: JSON.stringify({ title: input.title, body: input.body, head, base: input.baseBranch }),
    });
    return { url: pr.html_url, number: pr.number };
  }
}
