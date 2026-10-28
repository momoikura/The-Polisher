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

## Run 2b: sentry-v2#64 again, with adaptive agents (2026-10-28)

Same issue and repo commit as run 2, after the parser, scope, sandbox-filter
and adaptation changes (`bd3502a`, `39e0c3c`).

| Measure | First draft | After |
|---|---|---|
| Tests | 646/651 pass | 652/657 pass (5 skipped) |
| New tests prove the fix | no | yes |
| Lint issues | 0 | 0 |
| CodePolish checks / critic | 3/4, 58 | **4/4**, 82 |
| UIPolish checks / critic | 1/1, 68 | 1/1, 96 |
| DocPolish checks / critic | 4/4, 78 | 4/4, 96 |
| WritePolish checks / critic | 4/6, 36 | **6/6, 94** |
| Files changed / lines added | 2 / 68 | 3 / 119 |

- Status: not clean, but only CodePolish's critic score (82, bar 85) blocked
  it; every objective check passes. Cost $1.787. Wall time 17 min 11 s.
- vs run 2: CodePolish passed every check on its first revision (run 2 needed
  four rounds to get down to one false alarm). WritePolish went from stalled to
  approved: it rethought after a rejection, then narrowed to the one failing
  check (`pr_files_listed`) and fixed it.

What still went wrong:
- CodePolish spent rounds 3-6 re-adding a CHANGELOG line. Out-of-scope files
  are now discarded, so those revisions came back unchanged, scored the same
  82, and were rejected as "no improvement". The adaptation brief said what it
  tried but not that the edit was discarded, so it kept trying. Meanwhile the
  critic's real requests (rename `_build`, reword "it holds no events", give
  the fallback error a fix hint) went unaddressed.

## Run 2c: sentry-v2#64, with discard feedback (2026-10-28)

Same issue again after `210f998` (agents are told when edits to files they
don't own are discarded).

| Measure | First draft | After |
|---|---|---|
| Tests | not run (draft didn't compile) | 656/661 pass (5 skipped) |
| New tests prove the fix | not run | yes |
| Lint issues | not run | 0 |
| CodePolish checks / critic | 2/4, 0 | **4/4**, 78 |
| UIPolish checks / critic | 1/1, 12 | 1/1, 91 |
| DocPolish checks / critic | 4/4, 8 | 4/4, 96 |
| WritePolish checks / critic | 3/6, 12 | 6/6, 94 |
| Files changed / lines added | 1 / 2 | 3 / 110 |

- Status: not clean; only CodePolish's critic score (78, bar 85) blocked it.
  Cost $2.415. Wall time 21 min 53 s.
- The single prompt produced a 2-line patch that didn't compile. CodePolish
  recovered: round 2 broke an existing test and was rejected; it adapted
  ("rethink"), round 3 passed everything but two test checks, and round 4
  passed every check with critic 78.
- No rounds were wasted on CHANGELOG edits this time; round 4 went to the
  critic's findings (renamed a vague helper, stripped `__init__` from errors).

What still went wrong:
- After round 5 broke the tests, the adaptation brief made CodePolish
  overcorrect: round 6 changed nothing ("retained last-kept ... unchanged"),
  which can never improve the score. "Don't repeat that" needs to come with
  "but still make a safe change".
- Remaining critic findings are real UX polish: the non-object error says
  `int`/`str` instead of the JSON terms the user wrote, and the missing-field
  wording is awkward.

## Reporting change: "verified" (after run 2c)

Runs now end in one of four states: **clean** (every check passes and every
critic approved), **verified** (every objective check passes and the new tests
prove the fix in the sandbox, but a critic wants more polish), **not clean**,
or **failed**. Under this rule runs 2b and 2c would have been reported as
verified: in both, CodePolish passed every check and only its critic score
(82, 78) was under the 85 bar. The critic bar itself is unchanged.
