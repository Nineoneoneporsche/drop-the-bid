import { describe, expect, it } from "vitest";
import { isPendingWin, paymentSecondsLeft, type PendingWinInput } from "../app/lib/pendingWinRule";
import { WINNER_PAYMENT_WINDOW_SECONDS } from "../app/lib/paymentWindow";

const CLAIMED = Date.parse("2026-10-06T12:00:00.000Z");
const at = (s: number) => CLAIMED + s * 1000;
const ME = "user-me";

const base: PendingWinInput = {
  userId: ME,
  phase: "ended",
  winner: { id: ME, claimedAt: CLAIMED },
  hasOrder: false,
  nowMs: at(60),
};

describe("isPendingWin", () => {
  it("shows for the signed-in, unpaid winner within the window", () => {
    expect(isPendingWin(base)).toBe(true);
  });

  it("uses the shared 30 minute window", () => {
    expect(WINNER_PAYMENT_WINDOW_SECONDS).toBe(1800);
    expect(paymentSecondsLeft(CLAIMED, at(60))).toBe(1740);
    expect(isPendingWin({ ...base, nowMs: at(1799) })).toBe(true);
  });

  it("disappears once the window has elapsed", () => {
    expect(isPendingWin({ ...base, nowMs: at(1800) })).toBe(false);
    expect(isPendingWin({ ...base, nowMs: at(1801) })).toBe(false);
    expect(paymentSecondsLeft(CLAIMED, at(5000))).toBe(0);
  });

  it("disappears once a paid order exists for the win", () => {
    expect(isPendingWin({ ...base, hasOrder: true })).toBe(false);
  });

  it("stays hidden until the orders lookup has finished", () => {
    expect(isPendingWin({ ...base, hasOrder: null })).toBe(false);
  });

  it("is never shown to another account", () => {
    expect(isPendingWin({ ...base, userId: "someone-else" })).toBe(false);
  });

  it("is not shown when signed out / anonymous", () => {
    expect(isPendingWin({ ...base, userId: null })).toBe(false);
  });

  it("requires phase ended", () => {
    expect(isPendingWin({ ...base, phase: "game" })).toBe(false);
    expect(isPendingWin({ ...base, phase: "home" })).toBe(false);
  });

  it("requires winner_claimed_at", () => {
    expect(isPendingWin({ ...base, winner: { id: ME, claimedAt: null } })).toBe(false);
  });

  it("requires a winner", () => {
    expect(isPendingWin({ ...base, winner: null })).toBe(false);
  });
});
