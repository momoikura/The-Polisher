import { describe, expect, it } from "vitest";
import { settleWithGrace } from "../src/maintainer/settle.js";

const after = <T>(ms: number, value: T, fail = false) =>
  new Promise<T>((resolve, reject) => setTimeout(() => (fail ? reject(new Error(String(value))) : resolve(value)), ms));

describe("settleWithGrace", () => {
  it("returns once the grace period after the first success is over, leaving slow ones pending", async () => {
    const started = Date.now();

    const results = await settleWithGrace([after(10, "a"), after(40, "b"), after(2_000, "c")], 80);

    expect(Date.now() - started).toBeLessThan(500);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "pending"]);
  });

  it("returns as soon as everything settles, without waiting out the grace period", async () => {
    const started = Date.now();

    const results = await settleWithGrace([after(10, "a"), after(20, "b", true)], 5_000);

    expect(Date.now() - started).toBeLessThan(500);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("keeps waiting while everything so far has failed: the grace period starts at the first success", async () => {
    const results = await settleWithGrace([after(10, "x", true), after(60, "b")], 20);

    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
  });
});
