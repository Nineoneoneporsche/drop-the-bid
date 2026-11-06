// M4-B3 admin "결제·환불" UI: the row states, the two-step refund flow and the
// rendered view (AdminPaymentsView, a pure function of its props — rendered
// here as a React element tree, no DOM).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildAdminPaymentItems, paymentRowView, refundFlow, REFUND_FLOW_IDLE, type AdminPaymentItem, type RefundFlow,
} from "../app/lib/adminRefund";
import { AdminPaymentsView, type AdminPaymentsViewProps } from "../app/components/AdminPaymentsPanel";

const item = (extra: Partial<AdminPaymentItem> = {}): AdminPaymentItem => ({
  orderId: "DTB-UI-1", productName: "아이패드", amount: 412_000, paidAt: "2026-11-06T06:00:05Z", refundedAt: null, refundable: true,
  cancellation: null, ...extra,
});
const cancel = (status: "pending" | "done" | "failed" | "reconciliation_required", id = "c-1", canRecheck = status === "reconciliation_required") =>
  ({ cancellationId: id, cancellationStatus: status, reason: "고객 요청", canceledAt: null, lastCheckedAt: null, canRecheck });

type El = ReactElement<Record<string, unknown>>;
function all(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) all(n, out); return out; }
  if (!isValidElement(node)) return out;
  out.push(node as El);
  all((node.props as { children?: ReactNode }).children, out);
  return out;
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) return text((node.props as { children?: ReactNode }).children);
  return "";
}
function render(p: Partial<AdminPaymentsViewProps> & { items: AdminPaymentItem[] }) {
  const props: AdminPaymentsViewProps = {
    loadError: false, flow: REFUND_FLOW_IDLE, busy: null, results: {},
    dispatch: vi.fn(), onSubmit: vi.fn(), onRecheck: vi.fn(), onRefresh: vi.fn(), ...p,
  };
  const tree = AdminPaymentsView(props);
  const els = all(tree);
  const buttons = (action: string) => els.filter((e) => e.type === "button" && e.props["data-action"] === action);
  return { props, tree, els, buttons, body: text(tree) };
}

describe("paymentRowView", () => {
  it("each state: label and which buttons", () => {
    expect(paymentRowView(item())).toEqual({ label: "환불 가능", tone: "ok", canRefund: true, canRecheck: false });
    expect(paymentRowView(item({ cancellation: cancel("pending") }))).toMatchObject({ label: "환불 처리 중", canRefund: false, canRecheck: false });
    expect(paymentRowView(item({ cancellation: cancel("reconciliation_required") }))).toMatchObject({ label: "환불 상태 확인 필요", canRefund: false, canRecheck: true });
    expect(paymentRowView(item({ cancellation: cancel("done") }))).toMatchObject({ label: "환불 완료", canRefund: false, canRecheck: false });
    expect(paymentRowView(item({ refundedAt: "2026-11-06T07:00:00Z" }))).toMatchObject({ label: "환불 완료", canRefund: false, canRecheck: false });
    expect(paymentRowView(item({ cancellation: cancel("failed") }))).toMatchObject({ canRefund: true, canRecheck: false });
    expect(paymentRowView(item({ refundable: false }))).toMatchObject({ canRefund: false, canRecheck: false });
  });
});

describe("buildAdminPaymentItems", () => {
  it("active cancellation wins over a newer failed one; else the latest failed; orders without a row are skipped", () => {
    const attempts = [{ order_id: "A", amount: 1, approved_at: null, created_at: "t" }, { order_id: "B", amount: 2, approved_at: null, created_at: "t" }, { order_id: "Z", amount: 3, approved_at: null, created_at: "t" }];
    const orders = [{ order_id: "A", product_name: "p", win_id: "w", refunded_at: null, created_at: "o" }, { order_id: "B", product_name: "q", win_id: "w", refunded_at: null, created_at: "o" }];
    const c = (id: string, order_id: string, status: "failed" | "pending", requested_at: string) =>
      ({ id, order_id, status, reason: "r", canceled_at: null, last_checked_at: null, requested_at });
    const items = buildAdminPaymentItems(attempts, orders, [c("a1", "A", "pending", "1"), c("a2", "A", "failed", "2"), c("b1", "B", "failed", "1"), c("b2", "B", "failed", "3")],
      { nowMs: 0, stalePendingMs: 300_000 });
    expect(items.map((i) => [i.orderId, i.cancellation?.cancellationId])).toEqual([["A", "a1"], ["B", "b2"]]);
  });
  it("canRecheck is decided on the server: reconciliation_required, or pending for >= the stale window; never done / failed", () => {
    const NOW = Date.parse("2026-11-06T10:00:00Z");
    const STALE = 5 * 60_000;
    const one = (status: "pending" | "done" | "failed" | "reconciliation_required", ageMs: number) =>
      buildAdminPaymentItems(
        [{ order_id: "A", amount: 1, approved_at: null, created_at: "t" }],
        [{ order_id: "A", product_name: "p", win_id: "w", refunded_at: null, created_at: "o" }],
        [{ id: "c", order_id: "A", status, reason: "r", canceled_at: null, last_checked_at: null, requested_at: new Date(NOW - ageMs).toISOString() }],
        { nowMs: NOW, stalePendingMs: STALE },
      )[0].cancellation!.canRecheck;
    expect(one("pending", 0)).toBe(false);
    expect(one("pending", STALE - 1000)).toBe(false);
    expect(one("pending", STALE)).toBe(true);
    expect(one("pending", STALE + 60_000)).toBe(true);
    expect(one("reconciliation_required", 0)).toBe(true);
    for (const s of ["done", "failed"] as const) expect(one(s, STALE * 10), s).toBe(false);
  });
});

describe("refundFlow (two-step confirmation)", () => {
  it("open -> reason (required, 1..200 after trim) -> confirm -> submitting -> finished", () => {
    let s: RefundFlow = refundFlow(REFUND_FLOW_IDLE, { type: "open", orderId: "O" });
    expect(s).toEqual({ step: "reason", orderId: "O", reason: "", error: null });
    for (const r of ["", "   ", "가".repeat(201)]) {
      const e = refundFlow(refundFlow(s, { type: "edit", reason: r }), { type: "next" });
      expect(e.step, JSON.stringify(r)).toBe("reason");
      expect((e as { error: string }).error).toMatch(/환불 사유/);
    }
    s = refundFlow(refundFlow(s, { type: "edit", reason: "  고객 요청  " }), { type: "next" });
    expect(s).toEqual({ step: "confirm", orderId: "O", reason: "고객 요청" });
    expect(refundFlow(s, { type: "back" })).toMatchObject({ step: "reason", reason: "고객 요청" });
    s = refundFlow(s, { type: "submit" });
    expect(s.step).toBe("submitting");
    // While submitting, nothing else is accepted (no second request, no other order).
    for (const a of [{ type: "submit" }, { type: "open", orderId: "P" }, { type: "cancel" }, { type: "back" }, { type: "next" }] as const) {
      expect(refundFlow(s, a)).toBe(s);
    }
    expect(refundFlow(s, { type: "finished" })).toEqual(REFUND_FLOW_IDLE);
  });
  it("submit only from confirm; open only from idle", () => {
    const reason: RefundFlow = { step: "reason", orderId: "O", reason: "x", error: null };
    expect(refundFlow(reason, { type: "submit" })).toBe(reason);
    expect(refundFlow(REFUND_FLOW_IDLE, { type: "submit" })).toBe(REFUND_FLOW_IDLE);
    expect(refundFlow(reason, { type: "open", orderId: "P" })).toBe(reason);
  });
});

describe("AdminPaymentsView", () => {
  it("refundable row: product / order id / amount / paid date / status and an enabled '전액 환불' that only opens the dialog", () => {
    const v = render({ items: [item()] });
    expect(v.body).toContain("아이패드");
    expect(v.body).toContain("DTB-UI-1");
    expect(v.body).toContain("₩412,000");
    expect(v.body).toMatch(/결제 2026/);
    expect(v.body).toContain("환불 가능");
    const [b] = v.buttons("refund");
    expect(text(b)).toBe("전액 환불");
    expect(b.props.disabled).toBe(false);
    (b.props.onClick as () => void)();
    expect(v.props.dispatch).toHaveBeenCalledWith({ type: "open", orderId: "DTB-UI-1" });
    expect(v.props.onSubmit).not.toHaveBeenCalled();
    expect(v.buttons("recheck")).toHaveLength(0);
  });
  it("done / refunded / pending / legacy rows: no '전액 환불'; recheck only for reconciliation_required", () => {
    for (const [it_, label] of [
      [item({ cancellation: cancel("done") }), "환불 완료"],
      [item({ refundedAt: "2026-11-06T07:00:00Z" }), "환불 완료"],
      [item({ cancellation: cancel("pending") }), "환불 처리 중"],
      [item({ refundable: false }), "환불 불가"],
    ] as [AdminPaymentItem, string][]) {
      const v = render({ items: [it_] });
      expect(v.body).toContain(label);
      expect(v.buttons("refund")).toHaveLength(0);
      expect(v.buttons("recheck")).toHaveLength(0);
    }
    const r = render({ items: [item({ cancellation: cancel("reconciliation_required", "c-9") })] });
    expect(r.body).toContain("환불 상태 확인 필요");
    expect(r.buttons("refund")).toHaveLength(0);
    const [b] = r.buttons("recheck");
    expect(text(b)).toBe("환불 상태 확인");
    (b.props.onClick as () => void)();
    expect(r.props.onRecheck).toHaveBeenCalledWith("c-9", "DTB-UI-1");
  });
  it("step 1: product, order id, amount, '전액 환불만 가능합니다', required reason that is kept as an admin record", () => {
    const v = render({ items: [item()], flow: { step: "reason", orderId: "DTB-UI-1", reason: "", error: "환불 사유를 1~200자로 입력해주세요." } });
    const step = v.els.find((e) => e.props["data-step"] === "reason")!;
    const t = text(step);
    expect(t).toContain("아이패드");
    expect(t).toContain("주문번호 DTB-UI-1");
    expect(t).toContain("환불금액 ₩412,000");
    expect(t).toContain("전액 환불만 가능합니다.");
    expect(t).toContain("필수");
    expect(t).toContain("관리자 기록으로 남습니다");
    expect(t).toContain("환불 사유를 1~200자로 입력해주세요.");
    expect(v.els.find((e) => e.type === "textarea")!.props.maxLength).toBe(200);
    // Step 1 never calls the API: "다음" only advances the flow.
    (v.buttons("next")[0].props.onClick as () => void)();
    expect(v.props.dispatch).toHaveBeenCalledWith({ type: "next" });
    expect(v.props.onSubmit).not.toHaveBeenCalled();
    expect(v.buttons("refund")[0].props.disabled).toBe(true);
  });
  it("step 2: '정말 ₩412,000를 전액 환불하시겠습니까?' and only its confirm button sends the request", () => {
    const v = render({ items: [item()], flow: { step: "confirm", orderId: "DTB-UI-1", reason: "고객 요청" } });
    expect(v.body).toContain("정말 ₩412,000를 전액 환불하시겠습니까?");
    const [c] = v.buttons("confirm");
    expect(c.props.disabled).toBe(false);
    (c.props.onClick as () => void)();
    expect(v.props.onSubmit).toHaveBeenCalledTimes(1);
  });
  it("while submitting: confirm disabled ('환불 요청 중...'), every other action disabled", () => {
    const v = render({
      items: [item(), item({ orderId: "DTB-UI-2" }), item({ orderId: "DTB-UI-3", cancellation: cancel("reconciliation_required") })],
      flow: { step: "submitting", orderId: "DTB-UI-1", reason: "고객 요청" },
    });
    const [c] = v.buttons("confirm");
    expect(c.props.disabled).toBe(true);
    expect(text(c)).toBe("환불 요청 중...");
    expect(v.buttons("back")[0].props.disabled).toBe(true);
    for (const b of [...v.buttons("refund"), ...v.buttons("recheck")]) expect(b.props.disabled).toBe(true);
  });
  it("while a re-check runs: its button says '확인 중...' and all actions are disabled", () => {
    const v = render({ items: [item(), item({ orderId: "DTB-UI-3", cancellation: cancel("reconciliation_required", "c-3") })], busy: "c-3" });
    expect(text(v.buttons("recheck")[0])).toBe("확인 중...");
    for (const b of [...v.buttons("refund"), ...v.buttons("recheck")]) expect(b.props.disabled).toBe(true);
  });
  it("pending < 5 min: '환불 처리 중', no button; stale pending: '환불 처리 상태 확인 필요' + '환불 상태 확인' -> onRecheck", () => {
    const fresh = render({ items: [item({ cancellation: cancel("pending", "c-p", false) })] });
    expect(fresh.body).toContain("환불 처리 중");
    expect(fresh.body).not.toContain("환불 처리 상태 확인 필요");
    expect(fresh.buttons("recheck")).toHaveLength(0);
    expect(fresh.buttons("refund")).toHaveLength(0);
    const stale = render({ items: [item({ cancellation: cancel("pending", "c-s", true) })] });
    expect(stale.body).toContain("환불 처리 상태 확인 필요");
    expect(stale.buttons("refund")).toHaveLength(0);
    const [b] = stale.buttons("recheck");
    expect(text(b)).toBe("환불 상태 확인");
    expect(b.props.disabled).toBe(false);
    (b.props.onClick as () => void)();
    expect(stale.props.onRecheck).toHaveBeenCalledWith("c-s", "DTB-UI-1");
    expect(stale.props.onSubmit).not.toHaveBeenCalled();
  });
  it("done / failed never show '환불 상태 확인', even if canRecheck were set", () => {
    for (const s of ["done", "failed"] as const) {
      const v = render({ items: [item({ cancellation: cancel(s, "c-x", true) })] });
      expect(v.buttons("recheck"), s).toHaveLength(0);
    }
  });
  it("results: done / failed / reconciliation_required messages", () => {
    const v = render({
      items: [item({ orderId: "A1" }), item({ orderId: "A2" }), item({ orderId: "A3" })],
      results: {
        A1: { tone: "done", text: "전액 환불이 완료되었습니다." },
        A2: { tone: "failed", text: "환불 요청이 승인되지 않았습니다." },
        A3: { tone: "warn", text: "환불 처리 결과 확인이 필요합니다." },
      },
    });
    expect(v.body).toContain("전액 환불이 완료되었습니다.");
    expect(v.body).toContain("환불 요청이 승인되지 않았습니다.");
    expect(v.body).toContain("환불 처리 결과 확인이 필요합니다.");
  });
});

describe("wiring", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", "app", p), "utf8");
  it("the admin page shows the panel; the panel guards double requests synchronously and sends only ids + reason", () => {
    expect(src("admin/(protected)/page.tsx")).toMatch(/<AdminPaymentsPanel \/>/);
    const panel = src("components/AdminPaymentsPanel.tsx");
    expect(panel).toMatch(/if \(flow\.step !== "confirm" \|\| inFlight\.current\) return;/);
    expect(panel).toMatch(/JSON\.stringify\(\{ orderId, reason \}\)/);
    expect(panel).toMatch(/JSON\.stringify\(\{ cancellationId \}\)/);
    // "환불 상태 확인" (reconciliation_required and stale pending alike) uses the existing re-check route only.
    expect(panel).toMatch(/fetch\("\/api\/admin\/refund\/recheck", \{\s*method: "POST"/);
    expect(panel.match(/fetch\(/g)).toHaveLength(3); // list, refund, recheck — nothing else
    expect(panel).not.toMatch(/paymentKey|amount:/);
  });
});
