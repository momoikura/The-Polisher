/**
 * ArtifactVersion — a single immutable snapshot of generated or repaired content.
 *
 * Content is stored on the filesystem (referenced by contentPath).
 * The contentHash (SHA-256) enables deduplication and fast equality checks.
 */

/** The kind of content stored in an artifact. */
export type ContentType = "text/markdown" | "text/html" | "text/plain" | "application/javascript" | "text/css" | "application/json";

/** A versioned artifact snapshot. */
export interface ArtifactVersion {
  id: string;
  runId: string;
  versionNumber: number;
  /** SHA-256 hex digest of the content. */
  contentHash: string;
  /** Relative path within the artifact store (e.g., "runs/<runId>/v003.md"). */
  contentPath: string;
  /** MIME-like content type. */
  contentType: ContentType;
  /** Whether this version is the current best for the run. */
  isBest: boolean;
  /** How this version was produced. */
  source: ArtifactSource;
  createdAt: string;
}

/** How an artifact version came into existence. */
export type ArtifactSource = "generated" | "repaired" | "user_supplied";

/** Input needed to create a new artifact version. */
export interface CreateArtifactVersionInput {
  runId: string;
  versionNumber: number;
  content: string;
  contentType: ContentType;
  source: ArtifactSource;
}
