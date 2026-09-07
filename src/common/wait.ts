/** Sleep for `ms`. A plain utility — anything that decides *how long* to wait belongs elsewhere. */
export const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
