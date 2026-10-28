# The Polisher

**GitHub issue in, tested pull request out, powered by Meta's Muse Spark.**

Built for the Meta Global AI Developer Hackathon, *Push the Frontier* track (software).

Paste a GitHub issue from a Python repository. The Polisher (PolishLoop inside the code) uses Muse Spark through the Meta Model API to write a single-prompt first draft of the fix, then four agents critique and revise it in parallel until the pull request is something a maintainer would merge. The tests run for real in a Modal sandbox. The first draft is kept so you can compare it with the result, side by side.

| Agent | Owns | Must pass |
|---|---|---|
| CodePolish | the fix + pytest tests | compiles, no lint errors, all tests pass, **new tests fail on the original code and pass with the fix**, no deleted/skipped/weakened tests, no debug leftovers, Python-only and focused |
| UIPolish | reviews CodePolish's change from the user's side | error messages say what went wrong and how to fix it, no bare/silent excepts; its critic must also sign off, or CodePolish's revision is not accepted |
| DocPolish | README / CHANGELOG | docs updated, only mentions functions and files that exist, no hype |
| WritePolish | PR title + description | clear title, Summary/Changes/Testing, `Fixes #N`, every changed file mentioned, **no testing claims the sandbox didn't confirm** |

Each owning agent runs the keep-or-reject loop. A revision is kept only if it doesn't break a passing check or add problems, and the critic score only breaks ties. Agents read each other's latest work. A reconcile pass re-checks the docs and PR description against the final code.

## Built during the hackathon

Everything in this repository was written during the building period (Oct 27 to Nov 4, 2026). The first file was created on Oct 27, and there is no earlier codebase. Git history starts on Oct 28, when the repo was created; the commits after that show the rest of the work.

- **Core loop** (`packages/core`): the keep-or-reject gate, re-testing the best version, cost cap and round limits.
- **Four agents and orchestrator** (`packages/agents/src/maintainer`): GitHub issue reading, the single-prompt first draft, the four parallel agents, a reconcile pass, and the before/after comparison.
- **Verifiable fixes** (`sandbox-service/`): a Modal sandbox runs pytest on every candidate, and new tests must fail on the original code and pass with the fix.
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
pnpm --filter @polishloop/web dev:sim
```

**Real runs:** copy `.env.example` to `.env` at the repo root and set:

- a model: `MODEL_PROVIDER=meta` (default) + `MODEL_BASE_URL`, `MODEL_API_KEY`, and optionally `MODEL_ID` (defaults to `muse-spark-1.3`). Claude (`MODEL_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`) is only for local comparison runs.
- the sandbox: deploy `sandbox-service/modal_app.py` (steps in its header), then `SANDBOX_URL` + `SANDBOX_TOKEN`
- optionally `GITHUB_TOKEN` (higher read limits; required for **Open PR**)

```bash
pnpm --filter @polishloop/web dev
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

```bash
pnpm test
pnpm typecheck
```

## License

[MIT](LICENSE)
