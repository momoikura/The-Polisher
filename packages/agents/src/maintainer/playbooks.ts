/**
 * Each agent's playbook: widely taught engineering principles, written in our own
 * words, that its critic reviews against and its revisions follow. Sources, by
 * agent (credited, not quoted):
 *   CodePolish     Working Effectively with Legacy Code (Feathers), Clean Code and
 *                  Clean Architecture (Martin), Code Complete (McConnell), Good Code,
 *                  Bad Code (Long), The Pragmatic Programmer (Hunt, Thomas),
 *                  Software Engineering at Google (Winters, Manshreck, Wright)
 *   SecurityPolish Writing Secure Code (Howard, LeBlanc)
 *   DocPolish      Software Engineering at Google; The Pragmatic Programmer
 *   WritePolish    Software Engineering at Google (code review and change descriptions)
 */

import type { MaintainerLane } from "./prompts.js";

export const PLAYBOOKS: Record<MaintainerLane, string[]> = {
  code: [
    "Pin the bug first: a test that shows the wrong behaviour through existing code, then the smallest change that makes it pass.",
    "Fix the cause where it happens, not the symptom where it shows; no special case that hides the real fault.",
    "Test behaviour through the public API, not internals: one behaviour per test, a name that states the scenario and the expected result, no sleeps, network or shared state.",
    "Fail fast and loudly on invalid input: a specific exception whose message says what was wrong and how to fix it, never a silent default.",
    "Cover the edges the issue implies: empty input, None, boundaries, off-by-one, unicode.",
    "Stay in scope: don't refactor or rename unrelated code in a bug fix; match the names and style around you; name any new constant instead of a magic number.",
  ],
  security: [
    "All input is untrusted until checked: validate type, size, range and format where it enters, and prefer allow-lists to deny-lists.",
    "Normalise before checking (resolve a path, then confirm it is inside the allowed root; normalise case and unicode), and use the checked value, not the original.",
    "Fail closed: on an error, refuse or raise; never fall through to the permissive path.",
    "Never build shell commands, SQL or file paths by joining strings with input; pass arguments separately or use parameters.",
    "No unsafe deserialisation of untrusted data (pickle, yaml.load, eval, exec); use the safe loaders.",
    "Errors and logs must not reveal secrets, tokens or internals; no hard-coded credentials.",
    "Bound what input can cost: no regex with nested quantifiers on untrusted text, and limits on size and repetition.",
  ],
  doc: [
    "Write for the reader who uses the change: what changed for them and what, if anything, they must do.",
    "Docs change in the same pull request as the code they describe; remove anything the change made untrue.",
    "One fact in one place: link to it instead of repeating it.",
    "Every example must run exactly as written.",
  ],
  write: [
    "The first line stands on its own in a list of commits: a short, specific, imperative summary.",
    "The body says why the change is needed, what was done and why this approach, and what a reviewer should look at closely.",
    "Testing lists exactly what ran and its real result, and how to reproduce the bug.",
    "Call out anything risky or user-visible; keep everything else short.",
  ],
};

export const playbookFor = (lane: MaintainerLane): string => `Playbook:\n- ${PLAYBOOKS[lane].join("\n- ")}`;
