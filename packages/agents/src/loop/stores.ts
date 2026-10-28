/** In-memory stores for one LoopController run, with hooks the orchestrators listen to. */

import {
  RunLifecycleManager,
  type ArtifactStore,
  type ArtifactVersion,
  type CreateRunInput,
  type Run,
  type RunStore,
} from "@thepolisher/core";

export class LaneRunStore implements RunStore {
  private readonly lifecycle = new RunLifecycleManager();
  private readonly runs = new Map<string, Run>();
  constructor(private readonly onUpdate: (run: Run) => void) {}
  createRun(input: CreateRunInput): Run {
    const run = this.lifecycle.createRun(input);
    this.runs.set(run.id, run);
    return run;
  }
  updateRun(id: string, updates: Partial<Run>): Run {
    const next = { ...this.runs.get(id)!, ...updates };
    this.runs.set(id, next);
    this.onUpdate(next);
    return next;
  }
  getRun(id: string): Run | null {
    return this.runs.get(id) ?? null;
  }
}

export class LaneArtifactStore implements ArtifactStore {
  private readonly versions = new Map<string, { version: ArtifactVersion; content: string }>();
  constructor(private readonly onBest: (content: string) => void) {}
  saveVersion(runId: string, versionNumber: number, content: string, contentType: string, source: string) {
    const version = {
      id: `${runId}-v${this.versions.size}`,
      runId,
      versionNumber,
      contentHash: "",
      contentPath: "",
      contentType,
      isBest: false,
      source,
      createdAt: new Date().toISOString(),
    } as ArtifactVersion;
    this.versions.set(version.id, { version, content });
    return version;
  }
  getContent(artifact: ArtifactVersion): string {
    return this.versions.get(artifact.id)!.content;
  }
  markAsBest(_runId: string, versionId: string): void {
    this.onBest(this.versions.get(versionId)!.content);
  }
}
