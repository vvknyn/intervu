/** How long a synchronous per-item loop may run before it lets the event loop breathe. */
export const YIELD_BUDGET_MS = 25;

/**
 * `fn` over `items`, in order, one at a time, awaiting `setImmediate` whenever more than `budgetMs` has passed
 * since the last yield. The budget is time, not a count, so slow items cannot stretch a slice. Every long
 * synchronous per-item loop on the web server goes through here, so one build never holds a worker's event
 * loop (requests, health checks) for the length of the whole loop.
 */
export async function mapYielding<T, R>(items: readonly T[], fn: (item: T, index: number) => R, budgetMs: number = YIELD_BUDGET_MS): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let sliceStart = performance.now();
  for (let i = 0; i < items.length; i++) {
    results[i] = fn(items[i]!, i);
    if (performance.now() - sliceStart > budgetMs) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      sliceStart = performance.now();
    }
  }
  return results;
}
