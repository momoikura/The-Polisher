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
