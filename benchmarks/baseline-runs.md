# Baseline runs

Real runs on public GitHub issues with Muse Spark 1.3 (Meta Model API) and the
Modal sandbox. "First draft" is a single prompt; "After" is the four-agent
result. Numbers come from the app's Comparison tab, copied by hand.

## Run 1: deBilla/platform-mcp#23 (2026-10-28)

Environment names that differ only in case silently overwrite each other.
Repo at `969e4ef`, 139 existing tests.

| Measure | First draft | After |
|---|---|---|
| Tests | 140/140 pass | 140/140 pass |
| New tests prove the fix (fail before, pass after) | yes | yes |
| Lint issues | 0 | 0 |
| CodePolish checks / critic | 4/4, 97 | 4/4, 97 |
| UIPolish checks / critic | 1/1, 93 | 1/1, 93 |
| DocPolish checks / critic | 3/4, 68 | 4/4, 96 |
| WritePolish checks / critic | 5/6, 68 | 6/6, 96 |
| Files changed / lines added | 2 / 29 | 3 / 36 |

- Status: clean (all four agents approved). Cost $0.219. Wall time 2 min 8 s.
- The fix matches the issue's requested behaviour and error message.
- A human contributor has an open claim on this issue; no PR was opened.

Observations:
- The issue was easy: the single prompt already produced a correct, proven fix.
  The agents improved only the docs and the PR description.
- UIPolish flagged a real problem (the error always names
  `PLATFORM_MCP_ENVIRONMENTS`, even when the registry came from the TOML file),
  but its score was above the bar, so CodePolish never revised. Concrete
  reviewer findings should trigger at least one revision.
- DocPolish created a new `CHANGELOG.md` in a repo that had none. Docs should
  update existing files rather than add new ones.

## Run 2: jamesconwaydev/sentry-v2#64 (2026-10-28)

`policy test --event` gives Python-internal errors for wrong-shaped event files.
Repo at `4083be2`, 652 existing tests (5 skipped).

The first attempt failed before review: Muse Spark followed a valid ~25 KB JSON
reply with extra text and the parser rejected it. Fixed in `053d3bc`; this is
the rerun.

| Measure | First draft | After |
|---|---|---|
| Tests | 141/1157 pass (draft broke the suite) | 651/656 pass (5 skipped) |
| New tests prove the fix (fail before, pass after) | no | yes |
| Lint issues | 0 | 0 |
| CodePolish checks / critic | 2/4, 38 | 3/4, 80 |
| UIPolish checks / critic | 1/1, 42 | 1/1, 90 |
| DocPolish checks / critic | 4/4, 90 | 4/4, 90 |
| WritePolish checks / critic | 4/6, 42 | 5/6, 38 |
| Files changed / lines added | 2 / 65 | 3 / 132 |

- Status: not clean. Cost $1.805. Wall time 16 min 54 s (9 rounds).
- The single prompt broke the existing suite and proved nothing; the agents
  turned it into a fix whose new tests fail before and pass after, with every
  existing test passing.
- A human contributor has an open PR on this issue; no PR was opened.

Why it didn't finish clean, and what it showed:
- `debug_leftovers` flagged `print(..., file=sys.stderr)` in `cli.py`. That is
  the CLI's intended error output (the issue asks for exactly these messages),
  so this is a false positive in our check.
- CodePolish repeatedly added a CHANGELOG line (out of its scope). The sandbox
  only accepts `.py` files, so it rejected the whole request (HTTP 422) and
  every compile/test check reported failure. Three of six revisions were lost
  this way. Fix: send only Python files to the sandbox, and tell CodePolish to
  drop out-of-scope files.
- WritePolish claimed "1157 tests pass" when the sandbox counted 141; the
  `pr_honest_claims` check caught it. It then stalled on not listing the new
  test file.
- One added line ("Rolling back... systemd is slow") looks unrelated to the
  issue; worth a scope check.
