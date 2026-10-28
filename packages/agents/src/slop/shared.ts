/** Deterministic AI-slop signals shared by every lane. */

import type { TestCheck, TestType } from "@thepolisher/core";

/** Phrases that mark text as generic AI filler. Matched case-insensitively on word boundaries. */
export const SLOP_PHRASES: string[] = [
  "in today's fast-paced",
  "in today's fast paced",
  "in today's digital",
  "in the ever-evolving",
  "ever-evolving landscape",
  "look no further",
  "unlock the power",
  "unlock your",
  "unleash",
  "harness the power",
  "elevate your",
  "take it to the next level",
  "game-changer",
  "game changer",
  "revolutionize",
  "revolutionary",
  "cutting-edge",
  "state-of-the-art",
  "seamless",
  "seamlessly",
  "effortlessly",
  "delve",
  "dive into",
  "deep dive",
  "tapestry",
  "testament to",
  "navigate the complexities",
  "embark on",
  "journey",
  "empower",
  "supercharge",
  "whether you're a",
  "it's important to note",
  "it is important to note",
  "in conclusion",
  "at the end of the day",
  "boasts",
  "robust solution",
  "world-class",
  "best-in-class",
  "blazing fast",
  "blazing-fast",
  "lightning-fast",
  "enterprise-grade",
  "production-ready",
  "next-generation",
  "next-gen",
  "one-stop shop",
  "synergy",
  "leverage",
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function findSlopPhrases(text: string): string[] {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'");
  return SLOP_PHRASES.filter((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(lower);
  });
}

export function findEmoji(text: string): string[] {
  return [...new Set(text.match(EMOJI_RE) ?? [])];
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Visible text of an HTML document (scripts, styles and tags removed). */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function check(testType: TestType, problems: string[], okMessage: string): TestCheck {
  return {
    testType,
    authority: "objective",
    passed: problems.length === 0,
    problemCount: problems.length,
    message: problems.length ? problems.slice(0, 6).join("; ") : okMessage,
    details: { problems },
  };
}

export function slopPhraseCheck(text: string): TestCheck {
  const found = findSlopPhrases(text);
  return check(
    "slop_phrases",
    found.map((p) => `generic phrase "${p}"`),
    "No generic AI phrases."
  );
}

export function emojiCheck(text: string, where: string): TestCheck {
  const found = findEmoji(text);
  return check(
    "emoji_icons",
    found.length ? [`emoji in ${where}: ${found.join(" ")}`] : [],
    `No emoji in ${where}.`
  );
}
