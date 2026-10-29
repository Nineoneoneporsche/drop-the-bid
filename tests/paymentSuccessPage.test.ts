// /payment/success parses the URL Toss redirects to: our successUrl
// (`/payment/success?winId=<uuid>`) with Toss's paymentKey / orderId /
// amount (and paymentType) appended. Runs the real page component with
// React's hooks reduced to "render once, run effects immediately", so the
// exact body the page hands to confirmWithAuthRecovery() can be captured.
// No DOM, no network.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  search: "",
  bodies: [] as Record<string, unknown>[],
  effects: [] as (() => unknown)[],
}));

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(init: T | (() => T)) => [typeof init === "function" ? (init as () => T)() : init, () => {}],
    useCallback: <T,>(fn: T) => fn,
    useEffect: (fn: () => unknown) => { h.effects.push(fn); },
  };
});
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(h.search) }));
vi.mock("../app/lib/supabase", () => ({ supabase: {} }));
vi.mock("../app/lib/confirmWithAuthRecovery", () => ({
  confirmWithAuthRecovery: async (body: Record<string, unknown>) => {
    h.bodies.push(body);
    return { kind: "response", status: 200, json: { ok: true, data: { method: "카드" } }, requests: 1 };
  },
}));

const { default: PaymentSuccessPage } = await import("../app/payment/success/page");

const WIN_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

// Render the page for `search` and run its mount effect; resolves with the
// confirm bodies the page sent.
async function visit(search: string) {
  h.search = search;
  h.bodies = [];
  h.effects = [];
  const page = PaymentSuccessPage() as { props: { children: { type: () => unknown } } };
  page.props.children.type(); // SuccessInner, inside <Suspense>
  for (const fx of h.effects) await fx();
  await new Promise((r) => setTimeout(r, 0));
  return h.bodies;
}

beforeEach(() => { h.bodies = []; });

describe("/payment/success URL parsing", () => {
  it("Toss's redirect form: winId kept, paymentKey/orderId/amount extracted, same winId in the confirm body", async () => {
    const bodies = await visit(`?winId=${WIN_ID}&paymentKey=test_payment_key&orderId=test_order_123&amount=854000`);
    expect(bodies).toEqual([{ paymentKey: "test_payment_key", orderId: "test_order_123", amount: 854000, winId: WIN_ID }]);
  });

  it("extra Toss params (paymentType) are ignored", async () => {
    const bodies = await visit(`?winId=${WIN_ID}&paymentType=NORMAL&orderId=test_order_123&paymentKey=test_payment_key&amount=854000`);
    expect(bodies).toEqual([{ paymentKey: "test_payment_key", orderId: "test_order_123", amount: 854000, winId: WIN_ID }]);
  });

  it("malformed winId: nothing is sent", async () => {
    for (const bad of ["not-a-uuid", WIN_ID.replace(/-/g, ""), `${WIN_ID}x`, "", "%27%20or%201%3D1"]) {
      expect(await visit(`?winId=${bad}&paymentKey=test_payment_key&orderId=test_order_123&amount=854000`)).toEqual([]);
    }
  });

  it("duplicate winId: only the first is used — a malformed first one blocks the send, a valid first one is sent alone", async () => {
    expect(await visit(`?winId=bad&winId=${WIN_ID}&paymentKey=test_payment_key&orderId=test_order_123&amount=854000`)).toEqual([]);
    const bodies = await visit(`?winId=${WIN_ID}&winId=${OTHER}&paymentKey=test_payment_key&orderId=test_order_123&amount=854000`);
    expect(bodies).toEqual([{ paymentKey: "test_payment_key", orderId: "test_order_123", amount: 854000, winId: WIN_ID }]);
  });

  it("duplicate paymentKey/orderId/amount: one value each (the first), never a list", async () => {
    const bodies = await visit(`?winId=${WIN_ID}&paymentKey=first_key&paymentKey=second_key&orderId=o1&orderId=o2&amount=854000&amount=1`);
    expect(bodies).toEqual([{ paymentKey: "first_key", orderId: "o1", amount: 854000, winId: WIN_ID }]);
  });

  it("missing paymentKey / orderId / amount, or a non-numeric amount: nothing is sent", async () => {
    for (const q of [
      `?winId=${WIN_ID}&orderId=test_order_123&amount=854000`,
      `?winId=${WIN_ID}&paymentKey=test_payment_key&amount=854000`,
      `?winId=${WIN_ID}&paymentKey=test_payment_key&orderId=test_order_123`,
      `?winId=${WIN_ID}&paymentKey=test_payment_key&orderId=test_order_123&amount=abc`,
      `?winId=${WIN_ID}&paymentKey=test_payment_key&orderId=test_order_123&amount=0`,
    ]) expect(await visit(q)).toEqual([]);
  });

  it("a pre-M1 success URL without winId sends no winId (server only allows that for a legacy replay)", async () => {
    const bodies = await visit(`?paymentKey=test_payment_key&orderId=test_order_123&amount=854000`);
    expect(bodies).toEqual([{ paymentKey: "test_payment_key", orderId: "test_order_123", amount: 854000 }]);
  });
});
