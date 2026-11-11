// Production builds get NEXT_PUBLIC_PAYMENT_PROVIDER unset → "none": no
// checkout, and the payment routes refuse before touching Toss or the DB.
// (vitest.config.ts sets "toss" for the payment suites; this file flips it.)
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resolvePaymentProvider } from "../app/lib/paymentProvider";
import { PAYMENT_NOT_AVAILABLE } from "../app/lib/paymentCodes";

describe("resolvePaymentProvider", () => {
  it("is 'none' unless explicitly 'toss'", () => {
    for (const v of ["", "none", "TOSS", "kakaopay"]) expect(resolvePaymentProvider(v)).toBe("none");
    expect(resolvePaymentProvider("toss")).toBe("toss");
  });
});

describe("payment routes with no gateway", () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env.NEXT_PUBLIC_PAYMENT_PROVIDER; delete process.env.NEXT_PUBLIC_PAYMENT_PROVIDER; });
  afterEach(() => { process.env.NEXT_PUBLIC_PAYMENT_PROVIDER = saved; });

  const post = (url: string) => new NextRequest(url, { method: "POST", body: JSON.stringify({}) });

  it("/api/payment/confirm refuses with PAYMENT_NOT_AVAILABLE", async () => {
    const { POST } = await import("../app/api/payment/confirm/route");
    const res = await POST(post("http://localhost/api/payment/confirm"));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe(PAYMENT_NOT_AVAILABLE);
  });
  it("/api/payment/recheck refuses with PAYMENT_NOT_AVAILABLE", async () => {
    const { POST } = await import("../app/api/payment/recheck/route");
    const res = await POST(post("http://localhost/api/payment/recheck"));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe(PAYMENT_NOT_AVAILABLE);
  });
});

describe("checkout page", () => {
  it("gates the pay button and Toss SDK on the provider and names no gateway", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "app", "payment", "page.tsx"), "utf8");
    expect(src).toContain("const canPay = PAYMENTS_OPEN &&");
    expect(src).toContain("결제 수단 준비 중");
    expect(src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")).not.toMatch(/토스페이먼츠/);
  });
});
