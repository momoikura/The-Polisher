/** A promise's outcome when we stopped waiting; "pending" ones may still finish later. */
export type GraceResult<T> = PromiseSettledResult<T> | { status: "pending" };

/**
 * Waits for every promise to settle, but stops `graceMs` after the first one
 * succeeds: one slow call shouldn't hold up work that already has a usable result.
 * While nothing has succeeded it keeps waiting, so the first success is never cut off.
 */
export function settleWithGrace<T>(promises: readonly Promise<T>[], graceMs: number): Promise<GraceResult<T>[]> {
  const results: GraceResult<T>[] = promises.map(() => ({ status: "pending" }));
  return new Promise((resolve) => {
    let open = promises.length;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer) clearTimeout(timer);
      resolve([...results]);
    };
    if (open === 0) return finish();
    promises.forEach((p, i) => {
      p.then(
        (value) => {
          results[i] = { status: "fulfilled", value };
          timer ??= setTimeout(finish, graceMs);
        },
        (reason: unknown) => {
          results[i] = { status: "rejected", reason };
        }
      ).finally(() => {
        open--;
        if (open === 0) finish();
      });
    });
  });
}
