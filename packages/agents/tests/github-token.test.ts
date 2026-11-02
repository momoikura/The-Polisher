import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient, GitHubError } from "../src/maintainer/github.js";

const respondWith = (status: number) => vi.stubGlobal("fetch", async () => new Response("{}", { status }));

describe("a GitHub token", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("works when GitHub accepts it", async () => {
    respondWith(200);
    expect(await new GitHubClient({ token: "t" }).tokenWorks()).toBe(true);
  });

  it("doesn't work when GitHub rejects it", async () => {
    respondWith(401);
    expect(await new GitHubClient({ token: "t" }).tokenWorks()).toBe(false);
  });

  it("isn't blamed for a rate limit or an outage", async () => {
    respondWith(403);
    expect(await new GitHubClient({ token: "t" }).tokenWorks()).toBe(true);
    respondWith(503);
    expect(await new GitHubClient({ token: "t" }).tokenWorks()).toBe(true);
  });

  it("tells a signed-in person what to do when rejected", async () => {
    respondWith(401);
    const failed = new GitHubClient({ token: "t" }).getIssue({ owner: "o", repo: "r", number: 1 });
    await expect(failed).rejects.toThrow(GitHubError);
    await expect(failed).rejects.toThrow("sign in again");
  });
});
