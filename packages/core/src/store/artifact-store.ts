/**
 * ArtifactStore — filesystem-backed storage for artifact content.
 *
 * SECURITY: All paths are validated to prevent directory traversal.
 * Content is stored under a dedicated root directory, never outside it.
 *
 * Layout:
 *   <storeRoot>/
 *     runs/
 *       <runId>/
 *         v000.md
 *         v001.md
 *         ...
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, relative, normalize } from "node:path";
import { ulid } from "ulid";
import { sha256 } from "../utils/hash.js";
import type { ArtifactVersion, ContentType, ArtifactSource } from "../types/artifact.js";

/** Maps content type to file extension. */
const EXTENSION_MAP: Record<string, string> = {
  "text/markdown": ".md",
  "text/html": ".html",
  "text/plain": ".txt",
  "application/javascript": ".js",
  "text/css": ".css",
  "application/json": ".json",
};

export class FileArtifactStore {
  private readonly root: string;

  /**
   * @param storeRoot - Absolute path to the artifact storage directory.
   */
  constructor(storeRoot: string) {
    this.root = resolve(storeRoot);
    mkdirSync(this.root, { recursive: true });
  }

  /**
   * Save a new artifact version to the filesystem.
   *
   * @throws if the path would escape the store root (directory traversal).
   */
  saveVersion(
    runId: string,
    versionNumber: number,
    content: string,
    contentType: string,
    source: string
  ): ArtifactVersion {
    // Validate inputs
    this.validateSegment(runId, "runId");

    const ext = EXTENSION_MAP[contentType] ?? ".txt";
    const filename = `v${String(versionNumber).padStart(3, "0")}${ext}`;
    const relPath = join("runs", runId, filename);

    // Security: ensure the resolved path is within the store root
    const absPath = this.resolveAndValidate(relPath);

    // Ensure the directory exists
    const dir = join(this.root, "runs", runId);
    mkdirSync(dir, { recursive: true });

    // Write the content
    writeFileSync(absPath, content, "utf-8");

    const version: ArtifactVersion = {
      id: ulid(),
      runId,
      versionNumber,
      contentHash: sha256(content),
      contentPath: relPath,
      contentType: contentType as ContentType,
      isBest: false,
      source: source as ArtifactSource,
      createdAt: new Date().toISOString(),
    };

    return version;
  }

  /**
   * Read the content of an artifact version from the filesystem.
   *
   * @throws if the file doesn't exist or the path is invalid.
   */
  getContent(artifact: ArtifactVersion): string {
    const absPath = this.resolveAndValidate(artifact.contentPath);

    if (!existsSync(absPath)) {
      throw new Error(
        `Artifact content not found: ${artifact.contentPath} (resolved to ${absPath})`
      );
    }

    return readFileSync(absPath, "utf-8");
  }

  /**
   * Mark a version as the best for its run.
   * This is a metadata-only operation — the filesystem doesn't change.
   * The caller (controller) should also update the database.
   */
  markAsBest(_runId: string, _versionId: string): void {
    // Filesystem is stateless for "best" — this is tracked in the DB.
    // This method exists to satisfy the ArtifactStore interface from the controller.
    // In a more complex implementation, we might create a symlink.
  }

  /**
   * Check if content with the given hash already exists for a run.
   * Enables deduplication — if a repair produces identical content, skip it.
   */
  contentExists(runId: string, contentHash: string): boolean {
    const dir = join(this.root, "runs", runId);
    if (!existsSync(dir)) return false;

    // Scan existing files in the run directory
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(dir);

    for (const file of files) {
      const filePath = join(dir, file);
      const content = readFileSync(filePath, "utf-8");
      if (sha256(content) === contentHash) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the absolute path to the store root.
   */
  getRoot(): string {
    return this.root;
  }

  // ── Security ─────────────────────────────────────────────────────────────

  /**
   * Resolve a relative path against the store root and validate
   * that it doesn't escape the root directory.
   *
   * @throws if the path contains traversal patterns or escapes the root.
   */
  private resolveAndValidate(relPath: string): string {
    // Reject obvious traversal attempts
    const normalized = normalize(relPath);
    if (normalized.includes("..")) {
      throw new Error(
        `Path traversal detected: "${relPath}" normalizes to "${normalized}"`
      );
    }

    const absPath = resolve(this.root, relPath);
    const rel = relative(this.root, absPath);

    // On Windows, relative() returns a path starting with ".." if outside root
    if (rel.startsWith("..") || resolve(absPath) !== absPath.replace(/[/\\]+$/, "")) {
      throw new Error(
        `Path escapes artifact store root: "${relPath}" resolves to "${absPath}" (root: "${this.root}")`
      );
    }

    return absPath;
  }

  /**
   * Validate that a path segment (runId, filename) doesn't contain
   * dangerous characters.
   */
  private validateSegment(segment: string, name: string): void {
    if (!segment || segment.length === 0) {
      throw new Error(`${name} must not be empty`);
    }
    if (/[/\\:*?"<>|]/.test(segment)) {
      throw new Error(
        `${name} contains invalid characters: "${segment}"`
      );
    }
    if (segment === "." || segment === "..") {
      throw new Error(`${name} must not be "." or ".."`);
    }
  }
}
