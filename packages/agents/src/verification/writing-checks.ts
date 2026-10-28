/**
 * Deterministic writing checks. These are objective: same input, same result,
 * no model involved. Checks whose requirement was not configured are omitted
 * (never reported as passing).
 */

import type { RunConfig, TestCheck } from "@thepolisher/core";

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bTODO\b/,
  /\bTBD\b/,
  /\blorem ipsum\b/i,
  /\[(?:insert|add|your|placeholder)[^\]]*\]/i,
  /\{\{[^}]*\}\}/,
  /\bas an ai (?:language )?model\b/i,
];

/** Repeated word sequences of this length are flagged when they occur this often. */
const NGRAM_SIZE = 6;
const NGRAM_MAX_OCCURRENCES = 2;
const MIN_DUPLICATE_SENTENCE_WORDS = 5;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function findRepetition(text: string): string[] {
  const problems: string[] = [];

  const seen = new Map<string, number>();
  for (const sentence of splitSentences(text)) {
    const words = normalizeWords(sentence);
    if (words.length < MIN_DUPLICATE_SENTENCE_WORDS) continue;
    const key = words.join(" ");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [sentence, count] of seen) {
    if (count > 1) problems.push(`Sentence repeated ${count}x: "${sentence}"`);
  }

  const words = normalizeWords(text);
  const ngrams = new Map<string, number>();
  for (let i = 0; i + NGRAM_SIZE <= words.length; i++) {
    const key = words.slice(i, i + NGRAM_SIZE).join(" ");
    ngrams.set(key, (ngrams.get(key) ?? 0) + 1);
  }
  for (const [phrase, count] of ngrams) {
    if (count > NGRAM_MAX_OCCURRENCES) problems.push(`Phrase repeated ${count}x: "${phrase}"`);
  }

  return problems;
}

export function runWritingChecks(content: string, config: RunConfig): TestCheck[] {
  const checks: TestCheck[] = [];

  if (config.requiredPhrases?.length) {
    const lower = content.toLowerCase();
    const missing = config.requiredPhrases.filter((p) => !lower.includes(p.toLowerCase()));
    checks.push({
      testType: "required_content",
      authority: "objective",
      passed: missing.length === 0,
      message: missing.length
        ? `Missing required phrase(s): ${missing.map((p) => `"${p}"`).join(", ")}`
        : `All ${config.requiredPhrases.length} required phrase(s) present.`,
      details: { missing },
    });
  }

  if (config.minWords !== undefined || config.maxWords !== undefined) {
    const words = countWords(content);
    const tooShort = config.minWords !== undefined && words < config.minWords;
    const tooLong = config.maxWords !== undefined && words > config.maxWords;
    checks.push({
      testType: "length_limits",
      authority: "objective",
      passed: !tooShort && !tooLong,
      message: `${words} words (allowed: ${config.minWords ?? 0}-${config.maxWords ?? "∞"}).`,
      details: { words },
    });
  }

  const repetition = findRepetition(content);
  checks.push({
    testType: "repetition",
    authority: "objective",
    passed: repetition.length === 0,
    message: repetition.length ? `${repetition.length} repetition problem(s).` : "No repeated sentences or phrases.",
    details: { problems: repetition.slice(0, 10) },
  });

  const placeholders = PLACEHOLDER_PATTERNS.flatMap((re) => {
    const match = content.match(re);
    return match ? [match[0]] : [];
  });
  checks.push({
    testType: "placeholder_text",
    authority: "objective",
    passed: placeholders.length === 0,
    message: placeholders.length
      ? `Placeholder or boilerplate text found: ${placeholders.join(", ")}`
      : "No placeholder text.",
    details: { found: placeholders },
  });

  return checks;
}
