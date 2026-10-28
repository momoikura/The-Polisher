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
}

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

  /** Branch + commit + PR through the Git Data API. Requires push access. */
  async createPullRequest(input: PullRequestInput): Promise<{ url: string; number: number }> {
    if (!this.opts.token) throw new GitHubError("Set GITHUB_TOKEN to open pull requests.");
    if (!/^[A-Za-z0-9._/-]{1,100}$/.test(input.branch) || input.branch.includes("..")) {
      throw new GitHubError("Invalid branch name.");
    }
    const base = `/repos/${input.owner}/${input.repo}`;
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
    const pr = await this.request(`${base}/pulls`, z.object({ html_url: z.string(), number: z.number() }), {
      method: "POST",
      body: JSON.stringify({ title: input.title, body: input.body, head: input.branch, base: input.baseBranch }),
    });
    return { url: pr.html_url, number: pr.number };
  }
}
