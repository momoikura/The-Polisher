/**
 * A repository's pull request template, which WritePolish fills in instead of its own
 * sections (Rich, for one, asks every PR to use its template). The template is repo
 * content: data to fill in, never instructions to follow.
 */

import type { GitHubClient } from "./github.js";

// Where GitHub looks for a single template. The PULL_REQUEST_TEMPLATE/ folder holds several to choose from by URL.
const TEMPLATE_PATH = /^(\.github\/|docs\/)?pull_request_template\.md$/i;
const MAX_TEMPLATE_CHARS = 4000;
const CHECKBOX = /^\s*[-*]\s+\[[ xX]\]\s+(.+)$/;
const ASKS_ABOUT_AI = /\b(AI|LLM|generated|Copilot|ChatGPT)\b/i;
const PLACEHOLDER = /^(please\s+)?(describe|explain|summari[sz]e|provide|list|include|add a description|write)\b.*\b(here|below|changes?|pr|pull request)\b/i;

export function findPrTemplate(tree: readonly string[]): string | null {
  // GitHub prefers .github/, then the root, then docs/.
  const rank = (p: string) => (p.toLowerCase().startsWith(".github/") ? 0 : p.includes("/") ? 2 : 1);
  return tree.filter((p) => TEMPLATE_PATH.test(p)).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

export async function loadPrTemplate(
  github: Pick<GitHubClient, "getFile">,
  owner: string,
  repo: string,
  sha: string,
  tree: readonly string[]
): Promise<string | undefined> {
  const path = findPrTemplate(tree);
  if (!path) return undefined;
  try {
    const text = (await github.getFile(owner, repo, path, sha)).trim();
    return text ? text.slice(0, MAX_TEMPLATE_CHARS) : undefined;
  } catch {
    return undefined; // a template that can't be read just means the default sections
  }
}

/** HTML comments in a template are instructions to the author, not part of the PR. */
export const withoutComments = (text: string): string => text.replace(/<!--[\s\S]*?-->/g, "");

export function templateHeadings(template: string): string[] {
  return [...withoutComments(template).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => m[1]);
}

/** The template's checkboxes that ask whether AI was used: always true for a ThePolisher PR. */
export function aiCheckboxes(template: string): string[] {
  return withoutComments(template)
    .split("\n")
    .flatMap((line) => {
      const label = line.match(CHECKBOX)?.[1].trim();
      return label && ASKS_ABOUT_AI.test(label) ? [label] : [];
    });
}

/** Prose lines that tell the author what to write ("Please describe your changes here."): to be replaced. */
export function templatePlaceholders(template: string): string[] {
  return withoutComments(template)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => PLACEHOLDER.test(l));
}
