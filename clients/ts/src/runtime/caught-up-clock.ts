/** Outward-edge wall clock used only when a caller does not inject one. */
export const systemCaughtUpNow = (): number => Date.now();
