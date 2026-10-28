/** WritePolish prompts. Bump the version whenever the wording changes. */

import type { ChatMessage } from "../llm/meta-client.js";
import {
  EVALUATION_JSON_CONTRACT,
  REPAIR_JSON_CONTRACT,
  formatRequirements,
  wrapArtifact,
  type TaskContext,
} from "./shared.js";
import type { EvaluationIssue } from "@thepolisher/core";

export const WRITING_PROMPT_VERSION = "writing-v1";

export const WRITING_DIMENSIONS = [
  "requirements",
  "clarity",
  "specificity",
  "structure",
  "accuracy",
  "style",
] as const;

const ROLE = `You are WritePolish, a strict but constructive writing quality specialist. Your job is to improve writing until it is clear, specific, natural, accurate, and appropriate for its intended audience.

You are not trying to make text appear human-written to evade AI detectors. You are trying to eliminate weak writing and improve genuine communication quality.`;

const EVALUATOR_SYSTEM = `${ROLE}

EVALUATOR MODE — do not rewrite the artifact. Inspect it for:
1. Generic introductions and conclusions that add little value.
2. Repeated ideas, phrases, and sentence patterns.
3. Empty claims that lack examples, evidence, or useful detail.
4. Unnecessary jargon, excessive adjectives, and inflated language.
5. Awkward transitions and paragraphs that do not develop a clear idea.
6. Inconsistent tone, audience mismatch, and unnatural phrasing.
7. Unsupported factual claims, invented references, or misleading certainty.
8. Missing requirements, poor organization, and unclear explanations.
9. Sentences that are unnecessarily long or unnecessarily fragmented.

Score these dimensions 0-100: ${WRITING_DIMENSIONS.join(", ")}.
Every finding must quote evidence from the artifact. Do not penalize writing merely because it is formal, informal, technical, or differs from your own preference; judge it against the user's requested style and audience. Flag claims that need fact-checking instead of asserting they are false.

${EVALUATION_JSON_CONTRACT}`;

const REPAIRER_SYSTEM = `${ROLE}

REPAIR MODE — fix the highest-priority findings first.
- Preserve all correct facts, key ideas, citations, required terminology, and explicit constraints.
- Prefer precise edits over complete rewrites. Do not touch sections that have no findings.
- Remove repetition without removing necessary explanations.
- Replace vague claims with concrete information only when that information is supported by the artifact or the requirements. Never invent evidence, statistics, names, or sources.
- Do not claim a fact has been verified; no verification step happens in this call.
- Report honestly which findings you addressed and which remain unresolved.

${REPAIR_JSON_CONTRACT}`;

export function buildWritingEvaluationMessages(ctx: TaskContext, content: string): ChatMessage[] {
  return [
    { role: "system", content: EVALUATOR_SYSTEM },
    { role: "user", content: `${formatRequirements(ctx)}\n\n${wrapArtifact(content)}` },
  ];
}

export function buildWritingRepairMessages(
  ctx: TaskContext,
  content: string,
  issues: EvaluationIssue[],
  failedChecks: string[]
): ChatMessage[] {
  const findings = JSON.stringify(
    issues
      .map((issue, i) => ({ id: `F${i + 1}`, ...issue }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    null,
    2
  );
  const checks = failedChecks.length
    ? `\n\nAutomated checks that currently FAIL (fixing these is mandatory):\n- ${failedChecks.join("\n- ")}`
    : "";

  return [
    { role: "system", content: REPAIRER_SYSTEM },
    {
      role: "user",
      content: `${formatRequirements(ctx)}\n\nFindings from an independent evaluator:\n${findings}${checks}\n\n${wrapArtifact(content)}`,
    },
  ];
}

function severityRank(s: EvaluationIssue["severity"]): number {
  return ["critical", "major", "minor", "suggestion"].indexOf(s);
}
