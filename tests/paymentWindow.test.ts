import { describe, expect, it } from "vitest";
import { checkPaymentWindow, WINNER_PAYMENT_WINDOW_SECONDS } from "../app/lib/paymentWindow";

const CLAIMED = "2026-10-06T12:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(CLAIMED) + seconds * 1000).toISOString();

describe("checkPaymentWindow", () => {
  it("is a 30 minute window", () => {
    expect(WINNER_PAYMENT_WINDOW_SECONDS).toBe(1800);
  });

  it("allows 29:59 after the claim", () => {
    expect(checkPaymentWindow(CLAIMED, at(1799))).toEqual({ ok: true, elapsedMs: 1_799_000 });
  });

  it("allows 29:59.999 after the claim", () => {
    expect(checkPaymentWindow(CLAIMED, at(1799.999)).ok).toBe(true);
  });

  it("refuses at exactly 30:00 (matches the payment page countdown hitting 0)", () => {
    expect(checkPaymentWindow(CLAIMED, at(1800))).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses after 30 minutes", () => {
    expect(checkPaymentWindow(CLAIMED, at(1801))).toMatchObject({ ok: false, reason: "expired" });
  });

  it("refuses when winner_claimed_at is null", () => {
    expect(checkPaymentWindow(null, at(10))).toEqual({ ok: false, reason: "missing_claimed_at" });
  });

  it("refuses when the server time is missing or unparseable", () => {
    expect(checkPaymentWindow(CLAIMED, null)).toEqual({ ok: false, reason: "invalid_time" });
    expect(checkPaymentWindow(CLAIMED, "not-a-date")).toEqual({ ok: false, reason: "invalid_time" });
    expect(checkPaymentWindow("not-a-date", at(10))).toEqual({ ok: false, reason: "invalid_time" });
  });
});
