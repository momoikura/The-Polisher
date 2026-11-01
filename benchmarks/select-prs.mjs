// Picks the pull requests for the PR check benchmark by a fixed rule, so none are hand-picked:
// in each repo, the newest 3 merged and newest 3 closed-without-merging PRs that change a Python
// file outside the tests, leaving out bots. Writes benchmarks/<name>.json; commit it before running.
//
//   node benchmarks/select-prs.mjs pr-check-2026-11-02

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const REPOS = ["Textualize/rich", "python-jsonschema/jsonschema", "python-humanize/humanize", "more-itertools/more-itertools"];
const PER_KIND = 3;

const gh = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8", maxBuffer: 50_000_000 }));
const issues = [];
for (const repo of REPOS) {
  const prs = gh(["pr", "list", "--repo", repo, "--state", "closed", "--limit", "100", "--json", "url,number,mergedAt,author,closedAt"]);
  for (const merged of [true, false]) {
    let taken = 0;
    for (const pr of prs.filter((p) => Boolean(p.mergedAt) === merged && !p.author.is_bot && !/\[bot\]$/.test(p.author.login))) {
      if (taken === PER_KIND) break;
      const files = gh(["api", `repos/${repo}/pulls/${pr.number}/files?per_page=100`]);
      if (!files.some((f) => f.filename.endsWith(".py") && f.status !== "removed" && !/(^|\/)tests?\/|test_[^/]*\.py$/.test(f.filename))) continue;
      issues.push({ url: pr.url, outcome: merged ? "merged" : "closed" });
      taken += 1;
    }
  }
}

const name = process.argv[2];
fs.writeFileSync(
  new URL(`./${name}.json`, import.meta.url),
  `${JSON.stringify(
    {
      chosen: "The newest 3 merged and 3 closed-without-merging human PRs per repo that change Python outside the tests (benchmarks/select-prs.mjs). Checked after they closed, so they're run on what was submitted. Closed doesn't mean bad: a PR can close for many reasons.",
      budgetUSD: 1,
      concurrency: 3,
      challengeModel: "muse-wonder-1.0",
      issues,
    },
    null,
    2
  )}\n`
);
console.log(issues.length, "pull requests");
