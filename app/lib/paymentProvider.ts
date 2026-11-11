// Which payment gateway the site takes payments through. Toss Payments
// declined the merchant application (2026-11: it only onboards fixed-product,
// fixed-price sales), so the default is "none": /payment shows "결제 준비 중"
// with no pay button, and /api/payment/confirm + /recheck approve and look up
// nothing. The Toss integration stays in the codebase, reachable only with
// NEXT_PUBLIC_PAYMENT_PROVIDER=toss (local rehearsal, or a future contract).
//
// NEXT_PUBLIC_* is inlined at build time on the client, so the literal
// process.env.NEXT_PUBLIC_PAYMENT_PROVIDER below must stay spelled out.
export type PaymentProvider = "toss" | "none";

export function resolvePaymentProvider(
  value: string | undefined = process.env.NEXT_PUBLIC_PAYMENT_PROVIDER,
): PaymentProvider {
  return value === "toss" ? "toss" : "none";
}
