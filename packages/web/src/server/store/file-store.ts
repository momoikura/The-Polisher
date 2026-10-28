/** Run history on local disk, for development without AWS: one JSON file per run. */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { RunRecord, RunStore, SavedRun } from "./types.js";

const SAFE_ID = /^[A-Za-z0-9-]+$/;

export class FileRunStore implements RunStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error("Invalid run id.");
    return path.join(this.dir, `${id}.json`);
  }

  private async write(saved: SavedRun): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(saved.record.id), JSON.stringify(saved), "utf8");
  }

  async start(record: RunRecord): Promise<void> {
    await this.write({ record, events: [] });
  }

  async finish(record: RunRecord, events: readonly unknown[]): Promise<void> {
    await this.write({ record, events: [...events] });
  }

  async get(id: string): Promise<SavedRun | null> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), "utf8")) as SavedRun;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async list(limit: number): Promise<RunRecord[]> {
    let names: string[];
    try {
      names = (await fs.readdir(this.dir)).filter((n) => n.endsWith(".json"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const records = await Promise.all(
      names.map(async (n) => (JSON.parse(await fs.readFile(path.join(this.dir, n), "utf8")) as SavedRun).record)
    );
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }
}
