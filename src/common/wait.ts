/**
 * Sleep for `ms`. Anything that decides *how long* to wait belongs elsewhere.
 *
 * NOTE: a wrapper rather than `node:timers/promises`.setTimeout on purpose — the promise API
 * does not go through the global `setTimeout` the pacing specs watch, so swapping it in would
 * force those tests to mock a Node builtin instead.
 */
export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
