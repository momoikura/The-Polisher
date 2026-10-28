/**
 * Hash utility — SHA-256 content hashing for artifact deduplication.
 */

import { createHash } from "node:crypto";

/**
 * Compute the SHA-256 hex digest of a string.
 * Used to detect duplicate content across artifact versions.
 */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
