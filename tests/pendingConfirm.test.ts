import { describe, expect, it } from "vitest";
import {
  PENDING_CONFIRM_KEY, RESUME_TTL_MS, clearPendingConfirm, readPendingConfirm, resumeConfirmUrl, savePendingConfirm,
} from "../app/lib/pendingConfirm";
import { WINNER_PAYMENT_WINDOW_SECONDS } from "../app/lib/paymentWindow";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    raw: m,
  };
}

const NOW = Date.parse("2026-10-14T01:20:00Z");
const BODY = { paymentKey: "tgen_20261014abcDEF-123", orderId: "DTB-1791267637417-WXJQ2", amount: 874000 };

describe("pendingConfirm", () => {
  it("TTL is the payment window (a UX cap, not a Toss guarantee)", () => {
    expect(RESUME_TTL_MS).toBe(WINNER_PAYMENT_WINDOW_SECONDS * 1000);
  });

  it("saves and reads back the same three values", () => {
    const s = memoryStorage();
    expect(savePendingConfirm(BODY, NOW, s)).toBe(true);
    expect(readPendingConfirm(NOW + 60_000, s)).toEqual({ ...BODY, savedAt: NOW });
  });

  it("expired entries are ignored and removed", () => {
    const s = memoryStorage();
    savePendingConfirm(BODY, NOW, s);
    expect(readPendingConfirm(NOW + RESUME_TTL_MS + 1, s)).toBeNull();
    expect(s.raw.has(PENDING_CONFIRM_KEY)).toBe(false);
  });

  it("entries from the future (clock games) are ignored and removed", () => {
    const s = memoryStorage();
    s.setItem(PENDING_CONFIRM_KEY, JSON.stringify({ ...BODY, savedAt: NOW + 60_000 }));
    expect(readPendingConfirm(NOW, s)).toBeNull();
    expect(s.raw.has(PENDING_CONFIRM_KEY)).toBe(false);
  });

  const malformed: [string, string][] = [
    ["not JSON", "{oops"],
    ["missing amount", JSON.stringify({ paymentKey: "pk", orderId: "DTB-1", savedAt: NOW })],
    ["string amount", JSON.stringify({ ...BODY, amount: "874000", savedAt: NOW })],
    ["fractional amount", JSON.stringify({ ...BODY, amount: 1.5, savedAt: NOW })],
    ["zero amount", JSON.stringify({ ...BODY, amount: 0, savedAt: NOW })],
    ["paymentKey with URL chars", JSON.stringify({ ...BODY, paymentKey: "pk&redirect=https://evil", savedAt: NOW })],
    ["orderId with a slash", JSON.stringify({ ...BODY, orderId: "../admin", savedAt: NOW })],
    ["extra url field is not used", JSON.stringify({ ...BODY, savedAt: NOW, url: "https://evil.example" })],
  ];
  for (const [name, raw] of malformed) {
    it(`malformed (${name}) -> ignored${name.startsWith("extra") ? " field" : " and removed"}`, () => {
      const s = memoryStorage();
      s.setItem(PENDING_CONFIRM_KEY, raw);
      const r = readPendingConfirm(NOW, s);
      if (name.startsWith("extra")) {
        // Valid core fields still resume — but only to the fixed path.
        expect(resumeConfirmUrl(r!)).not.toContain("evil");
      } else {
        expect(r).toBeNull();
        expect(s.raw.has(PENDING_CONFIRM_KEY)).toBe(false);
      }
    });
  }

  it("refuses to save invalid values", () => {
    const s = memoryStorage();
    expect(savePendingConfirm({ ...BODY, amount: -1 }, NOW, s)).toBe(false);
    expect(s.raw.size).toBe(0);
  });

  it("clear removes the entry (used-once)", () => {
    const s = memoryStorage();
    savePendingConfirm(BODY, NOW, s);
    clearPendingConfirm(s);
    expect(readPendingConfirm(NOW, s)).toBeNull();
  });

  it("resume URL is always the fixed /payment/success path with the three values", () => {
    const url = resumeConfirmUrl(BODY);
    expect(url.startsWith("/payment/success?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({ paymentKey: BODY.paymentKey, orderId: BODY.orderId, amount: "874000" });
  });

  it("no storage available -> no-op", () => {
    expect(savePendingConfirm(BODY, NOW, null)).toBe(false);
    expect(readPendingConfirm(NOW, null)).toBeNull();
  });
});
