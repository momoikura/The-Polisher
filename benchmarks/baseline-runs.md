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

## Run 3: veerjain-1/agent-guard-eval#3 (2026-10-28)

Report generation crashes with uncaught filesystem errors when an output file
can't be written. Repo at `2a43bb8`, 61 existing tests. Run with every change
up to `c7cd7b6`.

| Measure | First draft | After |
|---|---|---|
| Tests | 76/76 pass | 76/76 pass |
| New tests prove the fix | yes | yes |
| Lint issues | 0 | 0 |
| CodePolish checks / critic | 4/4, 96 | 4/4, 96 |
| UIPolish checks / critic | 1/1, 92 | 1/1, 92 |
| DocPolish checks / critic | 4/4, 78 | 4/4, 94 |
| WritePolish checks / critic | 4/6, 72 | 6/6, 96 |
| Files changed / lines added | 3 / 232 | 4 / 239 |

- Status: **clean** (all four agents approved). Cost $0.551. Wall time 4 min 47 s.
- The single prompt already wrote a correct, proven fix (15 new tests), so the
  code was kept unchanged. The agents improved the docs and the PR.
- WritePolish's first draft said "Sandbox did not run"; the honesty check
  caught it and the final PR reports the real results (76/76 pass, new tests
  fail before and pass after, 0 lint issues).
- DocPolish adapted twice (rethink, then smallest fix) and fixed a README
  reference to an `--output` flag that doesn't exist.
- A human contributor has an open PR on this issue; no PR was opened.

Still open:
- DocPolish again created a new `CHANGELOG.md` in a repo that had none (also
  seen in run 1). It should only update docs that exist.
- UIPolish noted the write-failure message names the path and reason but not
  how to fix it; as a minor finding it didn't trigger a revision.

## Root cause found: files over 20,000 characters were shown cut short (2026-10-28)

Run 2d (parallel candidates on sentry-v2#64) produced three empty candidates.
Investigating showed that files up to 40 KB were loaded as context but each
was cut at 20,000 characters in the prompt. `src/sentry_v2/cli.py` is 20,720
bytes, so in every sentry-v2 run Muse Spark saw a truncated `cli.py` while
being asked for its full new contents. That explains the empty or tiny first
drafts (runs 2c, 2d) and the repeated "doesn't compile" revisions in runs 2,
2b and 2c. Run 2d was stopped. Fixed in the next commit: a loaded file is
always shown in full (both limits now share one constant). Runs 2-2c on this
issue were handicapped by this bug; runs 1 and 3 had no file over the limit.

## Correction: issue #64 was fixed upstream mid-session (2026-10-28)

`jamesconwaydev/sentry-v2#64` was closed at 11:23 UTC by commit `28118f5`
(the human contributor's fix, PR #103). The app works on the repo's latest
commit, so every run that started after that "fixed" code that already
contained the fix:

| Run | Started (UTC) | Valid? |
|---|---|---|
| 2 | 10:39 | yes (repo at `4083be2`; `cli.py` shown truncated, see above) |
| 2b | 11:06 | yes (same) |
| 2c | 11:25 | **no**: the fix was already merged, so its "2-line draft" had nothing to fix |
| 2d, 2e | later | **no**: every candidate reproduced the merged fix, so each showed "+0 lines" |

The parallel-candidates feature itself works; it was being tested on a solved
issue. The app now refuses closed issues before spending anything. Future
benchmark issues must be open and unclaimed, or pinned to a commit.

## Run 4: th30d4y/ExecuTrace#37, first run with parallel candidates (2026-10-28)

User-entered storage paths get an extra `/workflows/` appended. Issue open,
no assignee, no comments, no PRs. Repo at `bc37635`, 9 existing tests, no
CHANGELOG.

Parallel candidates (3 drafts, each tested in its own sandbox):

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| 1 (the single-prompt baseline) | no | 6 | not run | +0 |
| **2 (chosen)** | **yes** | 1 | 15/15 | +180 |
| 3 | no | 3 | 9/9 | +109 |

- The single prompt produced nothing usable; candidate 2 already proved the
  fix, so CodePolish started from a working version (critic 91, one lint
  issue: an unused variable in the new test).
- DocPolish approved without creating a CHANGELOG; WritePolish approved.
- Status: not clean. Cost $0.722. CodePolish's lane crashed: Muse Spark
  returned a revision with the files but without `changesMade`,
  `addressedFindingIds` and `unresolvedIssues`; the format check rejected it
  twice and the lane stopped.

Problems found:
- Missing bookkeeping fields in a repair reply ended the whole lane.
- `debug_leftovers` flagged `print()` in `cli.py` and `utils/interactive.py`,
  an interactive CLI whose existing code already prints to talk to the user.
- Memory recalled a sentry-v2 lesson ("validate policy test event shape")
  into this unrelated repo.

## Run 4b: ExecuTrace#37 again, after the run-4 fixes (2026-10-28)

Same issue and repo commit as run 4 (issue still open, no competing PR),
with `1528982`.

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| **1 (single-prompt baseline, chosen)** | yes | 1 | 15/15 | +105 |
| 2 | no | 3 | 9/9 | +123 |
| 3 | yes | 1 | 16/16 | +180 |

Candidates 1 and 3 tied on proof and checks; the smaller diff won.

| Measure | First draft | After |
|---|---|---|
| Tests | 15/15 pass | 25/25 pass |
| New tests prove the fix | yes | yes |
| Lint issues | 2 | 0 |
| CodePolish checks / critic | 4/4, 88 | 4/4, 92 |
| UIPolish checks / critic | 1/1, 76 | 1/1, 87 |
| DocPolish checks / critic | 4/4, 100 | 4/4, 100 |
| WritePolish checks / critic | 4/6, 68 | 6/6, 93 |
| Files changed / lines added | 5 / 105 | 6 / 324 |

- Status: **clean** (all four agents approved). Cost $0.922. Wall time 8 min 13 s.
- CodePolish fixed the lint issues in one revision (all checks, critic 93),
  spent its one extra revision on a major reviewer finding (rejected: it broke
  two checks), adapted, and the next revision passed everything again.
- No CHANGELOG was created in this repo that has none.
- Worth watching: the patch grew from 105 to 324 added lines (a new
  `utils/paths.py` helper used by four modules, and 10 more tests). All of it
  is tested, but a maintainer might prefer the smaller version.

## Run 5: th30d4y/ExecuTrace#36, first run with SecurityPolish (2026-10-29)

`get_storage` silently falls back to JSON for unknown format strings instead
of raising `ValueError`. Issue open, no comments. Run with `669aa1a`
(SecurityPolish + bandit scan in the sandbox).

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| 1 (single-prompt baseline) | yes | 0 | 21/21 | +35 |
| **2 (chosen)** | yes | 0 | 19/19 | +31 |
| 3 | yes | 0 | 21/21 | +42 |

- Status: **clean** (all four agents approved, including SecurityPolish:
  security review 98/100, bandit found nothing new). Cost $0.124.
- An easy issue: every candidate was already correct and secure, so the
  smallest diff was chosen and no revisions were needed.
- SecurityPolish has not yet met a patch with a real security problem in a
  live run; the scan itself was verified separately by adding `shell=True`
  and `pickle.loads` to a real file (both reported, nothing else).

## New rule: tests must fail for the right reason (2026-10-29)

`fail_to_pass` used to accept any failure on the original code as proof. A
test that only imports a function or module the fix adds also "fails before
and passes after" without exercising the bug. The sandbox now classifies how
each new test failed on the original code; if every failure is an
`ImportError`/`ModuleNotFoundError`/`NameError`/missing attribute or a
collection error, the fix is not counted as proven (and candidates are
ranked accordingly). Verified live on ExecuTrace with two tests that both
fail-then-pass: one reproducing the bug (`get_storage("yaml")` doesn't raise)
was accepted; one importing a new constant was rejected with the exact
`ImportError` line. Earlier runs were scored under the old rule.

## Run 4c: ExecuTrace#37 under the "fails for the right reason" rule (2026-10-29)

Same issue and repo commit as runs 4 and 4b (still open; the one open PR in the
repo is an unrelated website change), with `2a4731d` + SecurityPolish.

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| 1 (single-prompt baseline) | yes | 1 | 14/14 | +179 |
| 2 | yes | 1 | 16/16 | +145 |
| **3 (chosen)** | yes | 1 | 14/14 | +111 |

All three candidates' tests reproduce the bug through existing code, so they
still count as proof under the stricter rule.

| Measure | First draft | After |
|---|---|---|
| Tests | 14/14 pass | 15/15 pass |
| New tests prove the fix | yes | yes |
| Lint issues | 1 | 0 |
| CodePolish checks / critic | 4/4, 88 | 4/4, 91 |
| SecurityPolish checks / critic | 1/1, 96 | 1/1, 92 |
| DocPolish checks / critic | 4/4, 95 | 4/4, 95 |
| WritePolish checks / critic | 3/6, 78 | 6/6, 97 |
| Files changed / lines added | 6 / 188 | 6 / 164 |

- Status: **clean**. Cost $0.872. Wall time 7 min 51 s.
- CodePolish: round 3 fixed the lint but the critic fell to 48 (kept: checks
  come first); round 4 won the score back but reintroduced the lint (rejected,
  adapted); round 5 had both (all checks, critic 91).
- Unlike run 4b (105 -> 324 lines), the patch got smaller (188 -> 164).

## Run 6: python-jsonschema/jsonschema#1589 (2026-10-29)

`ValidationError.json_path` renders a property name ending in a newline with
dot notation, because Python's `$` matches before a final newline. jsonschema
has ~5,000 stars. Issue open, no comments, no linked PR. Repo at `c497561`;
the full suite (8,530 tests, 703 skipped by design) runs in the sandbox.

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| **1 (single-prompt baseline, chosen)** | yes | 0 | 7827/8530 | +4 |
| 2 | yes | 0 | 7827/8530 | +4 |
| 3 | yes | 0 | 7827/8530 | +5 |

| Measure | First draft | After |
|---|---|---|
| Tests | 7827/8530 pass (703 skipped) | 7827/8530 pass |
| New tests prove the fix | yes | yes |
| CodePolish checks / critic | 4/4, 98 | 4/4, 98 |
| SecurityPolish checks / critic | 1/1, 100 | 1/1, 100 |
| DocPolish checks / critic | 3/4, 95 | 4/4, 96 |
| WritePolish checks / critic | 3/6, 78 | 6/6, 93 |

- Status: **clean**. Cost $0.596. Wall time 4 min 11 s.
- The fix is the one a maintainer would write: `.match(elem)` -> `.fullmatch(elem)`
  in `jsonschema/exceptions.py`, plus a test using the suite's existing
  `validate_json_path_rendering` helper and an entry in the existing
  `CHANGELOG.rst`.

## Run 7: Textualize/rich#4238 (2026-10-29)

`Traceback.extract` loops forever when `__cause__` and `__context__` form a
cycle. rich has ~57,700 stars. Issue open; two comments (one person said they
would take it), no linked PR. Repo at `9d8f9a3`; 8 of rich's own tests already
fail on the original code (Pygments render tests) and are reported as
pre-existing, not counted against the patch.

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| 1 (single-prompt baseline) | no | 5 | 0/2 (suite didn't run) | +2 |
| **2 (chosen)** | yes | 1 | 950/983 | +94 |
| 3 | yes | 1 | 952/985 | +115 |

| Measure | First draft (single prompt) | After |
|---|---|---|
| Tests | 0/2 (suite didn't run) | 957/990 (25 skipped, 8 pre-existing) |
| New tests prove the fix | no | yes |
| Lint issues | 30 | 0 |
| CodePolish checks / critic | 3/4, 80* | 4/4, 93 |
| SecurityPolish checks / critic | 1/1, 96* | 1/1, 96 |
| DocPolish checks / critic | 3/4, 72 | 4/4, 95 |
| WritePolish checks / critic | 3/6, 78 | 5/6, 68 |
| Files changed / lines added | 2 / 2 | 3 / 234 |

\* first review of the chosen candidate.

- Status: not clean. Cost $1.321. Wall time 15 min 3 s.
- The single prompt produced a 2-line patch the suite couldn't even run; the
  tests chose candidate 2, which proved the fix. CodePolish then passed every
  check in one revision (critic 80 -> 93); SecurityPolish approved (96).
- Only WritePolish blocked: across 12 rounds, each revision that listed the
  changed files was rejected for breaking another check, so the kept PR never
  named `rich/traceback.py` or `CHANGELOG.md` (same stall as run 2). Fixed
  after this run: missing file names are now appended from the diff.

## Run 8: python-humanize/humanize#459 (2026-10-29)

`naturalsize(1.5)` returns "1 Bytes": below 1 kB the value is truncated with
`int()`. humanize has ~770 stars. Issue open (the author's team said they're
working on it); no linked PR. Repo at `6b817b9`; 15 of humanize's own tests
already error on the original code (a pytest-codspeed / pytest 9 mismatch)
and are reported as pre-existing.

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| **1 (single-prompt baseline, chosen)** | yes | 1 | 741/890 | +17 |
| 2 | yes | 1 | 744/893 | +22 |
| 3 | yes | 1 | 742/891 | +18 |

| Measure | First draft | After |
|---|---|---|
| Tests | 741/890 | 742/891 |
| New tests prove the fix | yes | yes |
| CodePolish checks / critic | 3/4, 96 | 4/4, 92 |
| SecurityPolish checks / critic | 1/1, 100 | 1/1, 98 |
| DocPolish checks / critic | 4/4, 95 | 4/4, 95 |
| WritePolish checks / critic | 5/6, 78 | 6/6, 94 |

- Status: **clean**. Cost $0.390. Wall time 2 min 51 s.
- Fix: whole byte counts keep the old output; fractional ones are formatted
  (`if bytes_.is_integer(): ... else f"{format % bytes_} ..."`).
- First run with automatic file listing: WritePolish narrowed to the one
  missing item ("Fixes #459") and was approved in round 4.
- `tests_included` wrongly failed every candidate: humanize adds tests as new
  parametrized cases, and the check only counted new `def test_` functions.
  CodePolish worked around it by adding a function. Fixed after this run.

## Run 9: more-itertools/more-itertools#1336, large file (2026-10-29)

[more-itertools/more-itertools#1336](https://github.com/more-itertools/more-itertools/issues/1336):
`replace()` yields `None` for an empty iterable when `window_size > 1`.
Model: **muse-spark-1.3-contributor** (Meta's lower-cost tier; costs are not
comparable with the runs above, which used muse-spark-1.3).

The bug is in `more_itertools/more.py` (171 KB). Before large-file support the
agents never saw it (files over 40 KB were skipped), and the chosen draft wrote
a new `more_itertools/__init__.py` that monkey-patched `replace()`; as a PR it
would have replaced the real `__init__.py`. That run (status "verified", $0.008)
is not counted. With large-file support, `more.py` is shown as an excerpt around
`replace` and `windowed`, and changed through exact find/replace edits.

| Candidate | Proves the fix | Failing checks | Tests | Lines |
|---|---|---|---|---|
| **1 (single-prompt baseline, chosen)** | yes | 0 | 769/769 | +26 |
| 2 | yes | 0 | 769/769 | +27 |
| 3 | yes | 0 | 770/770 | +30 |

- Status: **clean**, all four agents approved. Cost $0.014.
- Fix: one line in `more.py`, `windowed(it, window_size, fillvalue=_marker)`,
  the same approach `locate()` already uses. New tests in
  `tests/test_replace_empty.py` (the existing `tests/test_more.py` is too large
  to load, so new tests go in a new file).
- Run directly through `runMaintainer` (not the web app). No PR opened: two
  earlier fix attempts upstream were closed by the maintainers.
