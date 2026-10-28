/**
 * TestExecution — objective quality checks on an artifact version.
 *
 * This is the AUTHORITATIVE quality signal. Unlike subjective Evaluator
 * scores, test results are deterministic and gate acceptance decisions.
 */

/** Categories of objective tests, by mode. */
export type TestType =
  // Writing mode
  | "readability"
  | "grammar"
  | "style_guide_adherence"
  | "structural_balance"
  | "consistency"
  | "required_content"
  | "length_limits"
  | "repetition"
  | "placeholder_text"
  // Slop + cross-file checks (studio)
  | "slop_phrases"
  | "slop_punctuation"
  | "emoji_icons"
  | "slop_visual"
  | "html_basics"
  | "copy_sync"
  | "syntax"
  | "debug_leftovers"
  | "dom_contract"
  | "required_sections"
  | "file_references"
  // Design rulebook checks
  | "type_basics"
  | "motion_hygiene"
  | "focus_states"
  | "spacing_scale"
  | "palette_discipline"
  | "template_tells"
  | "default_look"
  // Real-browser checks (render service)
  | "render_console"
  | "render_overflow"
  | "render_targets"
  | "render_a11y"
  // Auto-Maintainer
  | "py_compile"
  | "py_lint"
  | "py_tests"
  | "fail_to_pass"
  | "patch_scope"
  | "tests_included"
  | "tests_intact"
  | "ux_messages"
  | "security_scan"
  | "docs_accuracy"
  | "docs_updated"
  | "pr_structure"
  | "pr_links_issue"
  | "pr_files_listed"
  | "pr_honest_claims"
  // UI mode
  | "accessibility"
  | "html_validation"
  | "design_token_adherence"
  | "responsive_layout"
  | "visual_diff"
  // Code mode
  | "user_tests"
  | "generated_tests"
  | "regression"
  | "linting"
  | "type_checking"
  // Reports mode
  | "section_count"
  | "content_density"
  | "citation_presence"
  | "data_consistency"
  | "narrative_flow_check";

/** Whether a test result is objective (deterministic) or hybrid (includes LLM judgment). */
export type TestAuthority = "objective" | "hybrid";

/** A single test check result. */
export interface TestCheck {
  /** What kind of test this is. */
  testType: TestType;
  /** Whether this is an objective or hybrid check. */
  authority: TestAuthority;
  /** Hard pass/fail determination. */
  passed: boolean;
  /** Human-readable summary of the result. */
  message: string;
  /** Detailed results (e.g., list of lint errors, axe violations). */
  details?: unknown;
  /** Path to evidence file (screenshot, log, etc.) if applicable. */
  evidencePath?: string;
  /** Individual problems inside this check (e.g. 3 banned phrases). Defaults to 1 if failed, 0 if passed. */
  problemCount?: number;
}

/** A TestExecution record as stored in the database. */
export interface TestExecution {
  id: string;
  runId: string;
  artifactVersionId: string;
  /** The category of test performed. */
  testType: TestType;
  /** Whether this test result is authoritative (objective) or advisory (hybrid). */
  authority: TestAuthority;
  /** Did the test pass? */
  objectivePass: boolean;
  /** Structured results. */
  results: TestCheck;
  /** Path to evidence (screenshot, log file). */
  evidencePath: string | null;
  /** How long the test took. */
  durationMs: number;
  createdAt: string;
}

/** Aggregated test results for a single artifact version. */
export interface AggregatedTestResults {
  artifactVersionId: string;
  checks: TestCheck[];
  /** Total number of objective checks that passed. */
  objectivePassed: number;
  /** Total number of objective checks that failed. */
  objectiveFailed: number;
  /** Total number of hybrid checks that passed. */
  hybridPassed: number;
  /** Total number of hybrid checks that failed. */
  hybridFailed: number;
  /** True if ALL objective checks passed. */
  allObjectivesPassed: boolean;
  /** Names of tests that passed (used by regression gate). */
  passingTestTypes: TestType[];
  /** Total individual problems across failing objective checks. */
  objectiveProblems: number;
}

/** Convenience: build an AggregatedTestResults from a list of checks. */
export function aggregateTestResults(
  artifactVersionId: string,
  checks: TestCheck[]
): AggregatedTestResults {
  const objectiveChecks = checks.filter((c) => c.authority === "objective");
  const hybridChecks = checks.filter((c) => c.authority === "hybrid");

  return {
    artifactVersionId,
    checks,
    objectivePassed: objectiveChecks.filter((c) => c.passed).length,
    objectiveFailed: objectiveChecks.filter((c) => !c.passed).length,
    hybridPassed: hybridChecks.filter((c) => c.passed).length,
    hybridFailed: hybridChecks.filter((c) => !c.passed).length,
    allObjectivesPassed: objectiveChecks.every((c) => c.passed),
    passingTestTypes: objectiveChecks.filter((c) => c.passed).map((c) => c.testType),
    objectiveProblems: objectiveChecks.reduce((sum, c) => sum + (c.passed ? 0 : Math.max(c.problemCount ?? 1, 1)), 0),
  };
}
