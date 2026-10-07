// Decides whether /strategy plays the full winner reveal (blackout -> video
// -> LED price count-down) or opens straight on the final result screen.
//
// The rule is "did THIS page instance witness the auction live?": the
// sequence plays only when the page saw loaded game state in the strategy
// or game phase before a winner appeared. Mounting onto an auction that
// had already ended — refresh, direct URL, /winner or /game redirect,
// re-entry from home — never saw it live, so it skips the sequence. No
// time-based threshold is involved.

type Observed = { isLoaded: boolean; phase: string };

// Folded over every observed state; once true it stays true for the life
// of the page instance.
export function nextSawLiveAuction(sawLive: boolean, observed: Observed): boolean {
  return sawLive || (observed.isLoaded && (observed.phase === "strategy" || observed.phase === "game"));
}

export type WinnerRevealMode = "sequence" | "result";

export function winnerRevealMode(sawLiveAuction: boolean): WinnerRevealMode {
  return sawLiveAuction ? "sequence" : "result";
}
