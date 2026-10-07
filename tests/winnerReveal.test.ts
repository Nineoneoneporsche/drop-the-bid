import { describe, expect, it } from "vitest";
import { nextSawLiveAuction, winnerRevealMode } from "../app/lib/winnerReveal";

type Obs = { isLoaded: boolean; phase: string };

// Replays the sequence of GameContext states a /strategy page instance
// observes before the winner appears, the way the page's effect folds them.
function modeAfter(observed: Obs[]) {
  const sawLive = observed.reduce(nextSawLiveAuction, false);
  return winnerRevealMode(sawLive);
}

describe("winner reveal: live vs re-entry", () => {
  it("live auction -> winner: plays the sequence once", () => {
    expect(modeAfter([
      { isLoaded: false, phase: "home" },
      { isLoaded: true, phase: "game" },
      { isLoaded: true, phase: "ended" }, // winner arrives via Realtime
    ])).toBe("sequence");
  });

  it("strategy phase -> game -> winner: plays the sequence", () => {
    expect(modeAfter([
      { isLoaded: true, phase: "strategy" },
      { isLoaded: true, phase: "game" },
      { isLoaded: true, phase: "ended" },
    ])).toBe("sequence");
  });

  it("refresh of /strategy after the auction ended: result screen, no sequence", () => {
    // Fresh page load: context starts unloaded, the snapshot is already 'ended'.
    expect(modeAfter([
      { isLoaded: false, phase: "home" },
      { isLoaded: true, phase: "ended" },
    ])).toBe("result");
  });

  it("refresh where the winner lands before isLoaded flips: still result", () => {
    expect(modeAfter([
      { isLoaded: false, phase: "home" },
      { isLoaded: false, phase: "ended" },
    ])).toBe("result");
  });

  it("client-side re-entry (home -> /strategy, /winner, /game) with context already loaded as ended: result", () => {
    expect(modeAfter([{ isLoaded: true, phase: "ended" }])).toBe("result");
  });

  it("an unloaded default phase never counts as having seen the auction live", () => {
    expect(modeAfter([{ isLoaded: false, phase: "game" }, { isLoaded: true, phase: "ended" }])).toBe("result");
  });

  it("once seen live, it stays live for that page instance", () => {
    expect(nextSawLiveAuction(true, { isLoaded: true, phase: "ended" })).toBe(true);
    expect(nextSawLiveAuction(true, { isLoaded: false, phase: "home" })).toBe(true);
  });
});
