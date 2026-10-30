# ThePolisher

**GitHub issue in, tested pull request out, powered by Meta's Muse Spark.**

Built for the Meta Global AI Developer Hackathon, *Push the Frontier* track (software).

Paste a GitHub issue from a Python repository. ThePolisher uses Muse Spark through the Meta Model API to write three candidate fixes at once. Each is tested in its own Modal sandbox, and the tests pick the one to polish: the one whose new tests prove the fix, then the fewest failing checks, then the smallest diff. Four agents then critique and revise it in parallel until the pull request is something a maintainer would merge. The first draft is kept as the single-prompt baseline so you can compare it with the result, side by side.

| Agent | Owns | Must pass |
|---|---|---|
| CodePolish | the fix + pytest tests | compiles, no lint errors, all tests pass, **new tests fail on the original code and pass with the fix**, no deleted/skipped/weakened tests, no debug leftovers, error messages say what went wrong and how to fix it, Python-only and focused |
| SecurityPolish | reviews CodePolish's change for security problems | **the sandbox's bandit scan finds no new medium or high finding** in the changed code; its critic (injection, path traversal, unsafe deserialization, secrets, unvalidated input) must also sign off, or CodePolish's revision is not accepted |
| DocPolish | README / CHANGELOG | docs updated, only mentions functions and files that exist, no hype |
| WritePolish | PR title + description | clear title, Summary/Changes/Testing, `Fixes #N` only when the tests prove the fix (`Refs #N` otherwise), every changed file mentioned, **no testing claims the sandbox didn't confirm** |

Each owning agent runs the keep-or-reject loop. A revision is kept only if it doesn't break a passing check or add problems, and the critic score only breaks ties. Agents read each other's latest work. A reconcile pass re-checks the docs and PR description against the final code.

**Try it:** [thepolisher.pages.dev](https://thepolisher.pages.dev). Sign in with GitHub; your first 3 runs are free, then bring your own Meta Model API key.

## Results

On **17 real, open issues from 9 popular Python projects** (Rich, jsonschema, sqlglot, urllib3, Pygments, astroid, pyparsing, more-itertools, humanize), chosen and committed before any run:

| | ThePolisher | Single prompt (same model) |
|---|---|---|
| Fix **proven** by its own new tests in the sandbox | **14 of 17 (82%)** | 7 of 17 (41%) |
| On the 12 issues never seen while building it | **10 of 12** | 5 of 12 |
| Unproven first draft turned into a proven fix | 7 | |
| Proven first draft made worse | 0 | |

Total model cost for all 17: **$0.66** (median $0.04 per issue, Muse Spark 1.3 Contributor). When it couldn't prove a fix, it said so instead of claiming one. Every issue, the method and the limits: [benchmarks/results/issues-2026-10-29.md](benchmarks/results/issues-2026-10-29.md).

A day later the same issues were re-run after speed changes ([results](benchmarks/results/issues-2026-10-30.md)): 12 of 16 proven, and the run exposed two bugs (targeted test runs naming tests differently, and the gate rejecting a proven fix over a lint error). After fixing both, the five issues they had hurt were all proven, Rich ones in 3 to 5 minutes instead of 12 to 22.

## Built during the hackathon

Everything in this repository was written during the building period (Oct 27 to Nov 4, 2026). The first file was created on Oct 27, and there is no earlier codebase. Git history starts on Oct 28, when the repo was created; the commits after that show the rest of the work.

- **Core loop** (`packages/core`): the keep-or-reject gate, re-testing the best version, cost cap and round limits.
- **Four agents and orchestrator** (`packages/agents/src/maintainer`): GitHub issue reading, parallel candidate fixes chosen by the tests, the four parallel agents (they adapt when a revision is rejected), a reconcile pass, and the before/after comparison.
- **Verifiable fixes** (`sandbox-service/`): a Modal sandbox runs pytest and a bandit security scan on every candidate; new tests must fail on the original code and pass with the fix, and the scan must find nothing new.
- **Experience memory** (`packages/agents/src/memory`): agents record which revisions the gate kept and recall them in later runs.
- **Web app** (`packages/web`): live run view, files changed, comparison, memory, and an explicit "Open pull request" button.

Third-party code is limited to open-source packages listed in the `package.json` files, plus Line Awesome icons (MIT) and the Mona Sans and Monaspace fonts (OFL).

## Run it

Requires Node 20+ and pnpm.

```bash
pnpm install
pnpm build
```

**Demo (no keys):** a built-in demo repo with scripted model and test results. The orchestrator, gate, checks and memory are real.

```bash
pnpm --filter @thepolisher/web dev:sim
```

**Real runs:** copy `.env.example` to `.env` at the repo root and set:

- a model: `MODEL_PROVIDER=meta` (default) + `MODEL_BASE_URL`, `MODEL_API_KEY`, and optionally `MODEL_ID` (defaults to `muse-spark-1.3-contributor`, Meta's lower-cost tier, about 21× cheaper than `muse-spark-1.3`; Meta may use what is sent to it to train its models, so use it on public repositories only). Claude (`MODEL_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) is only for local comparison runs.
- the sandbox: deploy `sandbox-service/modal_app.py` (steps in its header), then `SANDBOX_URL` + `SANDBOX_TOKEN`
- optionally `GITHUB_TOKEN` (higher read limits; required for **Open PR**)

```bash
pnpm --filter @thepolisher/web dev
```

Open http://localhost:3000.

## Safety

- **Untrusted code only runs in Modal Sandboxes**, which have no secrets and can only reach GitHub and PyPI. The endpoint holding the sandbox token never runs repo code.
- Agents can't change workflows, packaging/config files, or anything outside Python source, tests and docs.
- **Opening a PR is always an explicit click**, with a confirmation that names the repo. It needs a token with push access. Nothing is ever pushed automatically.
- Issue text and repo files are treated as untrusted data in every prompt.

## Learning from runs

After every keep-or-reject decision, the agent records what it tried and the outcome. Before each revision it recalls strategies that fixed the same failing checks, and ones that broke things. Memory is kept per model provider (`data/experience/`) and shown on the **Memory** page. Lessons are hints only; the gate still decides.

## Limits

- Python repositories with pytest; public repos only for the sandbox.
- Each sandbox validation downloads the repo and installs dependencies (expect 30–90 s); identical patches are cached.
- Cost estimates use per-model rates in `packages/core/src/controller/cost-tracker.ts`; Meta model pricing isn't configured.

## Development

How a run flows, where each part is deployed, and what is stored: [docs/architecture.md](docs/architecture.md).

```bash
pnpm test
pnpm typecheck
```

## License

[MIT](LICENSE)
