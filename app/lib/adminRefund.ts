// Admin "결제·환불" (M4-B3): the shapes the admin payments / refund routes
// answer with, how a row is shown, and the two-step refund confirmation.
// Pure and browser-safe — no Supabase, no Toss, no secrets. The server
// builds the list with buildAdminPaymentItems(); the admin page renders it
// with paymentRowView() and drives the dialog with refundFlow().
//
// Nothing here ever carries a paymentKey, an Idempotency-Key, a Toss
// response, a user id or shipping data.

export type CancellationStatus = "pending" | "done" | "failed" | "reconciliation_required";

export type AdminPaymentItem = {
  orderId: string;
  productName: string | null;
  amount: number;
  paidAt: string | null;
  refundedAt: string | null;
  // false for a legacy order (no win_id): the refund RPC refuses those.
  refundable: boolean;
  cancellation: {
    cancellationId: string;
    cancellationStatus: CancellationStatus;
    reason: string;
    canceledAt: string | null;
    lastCheckedAt: string | null;
    // Decided by the server: reconciliation_required, or pending for at
    // least the stale window (a request that died mid-way). The browser
    // never judges time itself.
    canRecheck: boolean;
  } | null;
};

export const REFUND_REASON_MAX = 200;

export const REFUND_MESSAGES: Record<CancellationStatus, string> = {
  done: "전액 환불이 완료되었습니다.",
  failed: "환불 요청이 승인되지 않았습니다.",
  reconciliation_required: "환불 처리 결과 확인이 필요합니다.",
  pending: "환불 처리 중",
};

// Refusals of payment_cancel_reserve / the routes, as operator text.
export const REFUND_ERROR_MESSAGES: Record<string, string> = {
  "cancel_reserve:already_refunded": "이미 환불된 주문입니다.",
  "cancel_reserve:in_progress": "이 주문의 환불이 이미 진행 중입니다. 목록을 새로고침해 상태를 확인해주세요.",
  "cancel_reserve:not_paid": "결제 완료 상태가 아닌 주문은 환불할 수 없습니다.",
  "cancel_reserve:no_order": "주문을 찾을 수 없습니다.",
  "cancel_reserve:no_attempt": "주문의 결제 기록을 찾을 수 없습니다.",
  "cancel_reserve:legacy_order": "이전 형식의 주문이라 이 화면에서 환불할 수 없습니다.",
  "cancel_reserve:identity_mismatch": "주문과 결제 기록이 일치하지 않아 환불할 수 없습니다. 기록을 먼저 확인해주세요.",
  "cancel_reserve:invalid_reason": `환불 사유를 1~${REFUND_REASON_MAX}자로 입력해주세요.`,
  "cancel_reserve:invalid": "잘못된 요청입니다.",
  "cancel_reserve:no_session": "관리자 세션이 유효하지 않습니다. 다시 로그인해주세요.",
  "cancel_reserve:invalid_session": "관리자 세션이 유효하지 않습니다. 다시 로그인해주세요.",
  "cancel_reserve:unavailable": "환불 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
  "refund_recheck:in_flight": "환불 요청을 처리 중입니다. 5분 후 다시 확인해주세요.",
  "refund_recheck:not_found": "환불 기록을 찾을 수 없습니다.",
  "refund_recheck:unavailable": "환불 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
  "refund_recheck:not_rechecked": "확인할 수 없는 상태의 환불 기록입니다.",
  config: "결제 설정 문제로 환불을 진행할 수 없습니다. 관리자에게 문의해주세요.",
  invalid_request: "잘못된 요청입니다.",
  unauthorized: "관리자 로그인이 필요합니다.",
  forbidden: "허용되지 않은 요청입니다.",
};

export function refundErrorMessage(code: unknown): string {
  return (typeof code === "string" && REFUND_ERROR_MESSAGES[code]) || "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

// ── reason ──────────────────────────────────────────────────────────────────
export function normalizeRefundReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const r = v.trim();
  return r.length >= 1 && r.length <= REFUND_REASON_MAX ? r : null;
}

// ── list (server side) ──────────────────────────────────────────────────────
type AttemptRow = { order_id: string; amount: number; approved_at: string | null; created_at: string | null };
type OrderRow = { order_id: string; product_name: string | null; win_id: string | null; refunded_at: string | null; created_at: string | null };
type CancellationRow = {
  id: string; order_id: string; status: CancellationStatus; reason: string;
  canceled_at: string | null; last_checked_at: string | null; requested_at: string;
};

// One item per paid attempt that has its order. The cancellation shown is
// the order's active one (pending / reconciliation_required / done — at
// most one, DB-enforced), else its latest failed one.
export function buildAdminPaymentItems(
  attempts: AttemptRow[], orders: OrderRow[], cancellations: CancellationRow[], clock: { nowMs: number; stalePendingMs: number },
): AdminPaymentItem[] {
  const canRecheck = (c: CancellationRow) =>
    c.status === "reconciliation_required"
    || (c.status === "pending" && clock.nowMs - Date.parse(c.requested_at) >= clock.stalePendingMs);
  const byOrder = new Map(orders.map((o) => [o.order_id, o]));
  const cancelOf = new Map<string, CancellationRow>();
  for (const c of cancellations) {
    const cur = cancelOf.get(c.order_id);
    const active = (x: CancellationRow) => x.status !== "failed";
    if (!cur || (active(c) && !active(cur)) || (active(c) === active(cur) && c.requested_at > cur.requested_at)) cancelOf.set(c.order_id, c);
  }
  const items: AdminPaymentItem[] = [];
  for (const a of attempts) {
    const o = byOrder.get(a.order_id);
    if (!o) continue;
    const c = cancelOf.get(a.order_id);
    items.push({
      orderId: a.order_id,
      productName: o.product_name ?? null,
      amount: a.amount,
      paidAt: a.approved_at ?? o.created_at ?? a.created_at ?? null,
      refundedAt: o.refunded_at ?? null,
      refundable: !!o.win_id,
      cancellation: c
        ? {
          cancellationId: c.id, cancellationStatus: c.status, reason: c.reason, canceledAt: c.canceled_at, lastCheckedAt: c.last_checked_at,
          canRecheck: canRecheck(c),
        }
        : null,
    });
  }
  return items;
}

// ── how a row is shown ──────────────────────────────────────────────────────
export type PaymentRowView = {
  label: string;
  tone: "ok" | "busy" | "warn" | "done" | "muted";
  canRefund: boolean;   // "전액 환불"
  canRecheck: boolean;  // "환불 상태 확인" — the server's canRecheck (reconciliation_required / stale pending)
};

export function paymentRowView(item: AdminPaymentItem): PaymentRowView {
  const s = item.cancellation?.cancellationStatus ?? null;
  if (item.refundedAt || s === "done") return { label: "환불 완료", tone: "done", canRefund: false, canRecheck: false };
  const recheck = item.cancellation?.canRecheck === true;
  if (s === "pending") {
    return recheck
      ? { label: "환불 처리 상태 확인 필요", tone: "warn", canRefund: false, canRecheck: true }
      : { label: "환불 처리 중", tone: "busy", canRefund: false, canRecheck: false };
  }
  if (s === "reconciliation_required") return { label: "환불 상태 확인 필요", tone: "warn", canRefund: false, canRecheck: recheck };
  if (!item.refundable) return { label: "환불 불가 (이전 형식 주문)", tone: "muted", canRefund: false, canRecheck: false };
  if (s === "failed") return { label: "환불 미승인 · 다시 요청 가능", tone: "warn", canRefund: true, canRecheck: false };
  return { label: "환불 가능", tone: "ok", canRefund: true, canRecheck: false };
}

// ── the two-step confirmation ───────────────────────────────────────────────
// idle -> reason (사유 입력) -> confirm ("정말 ₩X를 …") -> submitting -> idle.
// While submitting every other action is ignored (no double request).
export type RefundFlow =
  | { step: "idle" }
  | { step: "reason"; orderId: string; reason: string; error: string | null }
  | { step: "confirm"; orderId: string; reason: string }
  | { step: "submitting"; orderId: string; reason: string };

export type RefundFlowAction =
  | { type: "open"; orderId: string }
  | { type: "edit"; reason: string }
  | { type: "next" }
  | { type: "back" }
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "finished" };

export const REFUND_FLOW_IDLE: RefundFlow = { step: "idle" };

export function refundFlow(s: RefundFlow, a: RefundFlowAction): RefundFlow {
  if (s.step === "submitting") return a.type === "finished" ? REFUND_FLOW_IDLE : s;
  switch (a.type) {
    case "open":
      return s.step === "idle" ? { step: "reason", orderId: a.orderId, reason: "", error: null } : s;
    case "edit":
      return s.step === "reason" ? { ...s, reason: a.reason.slice(0, REFUND_REASON_MAX + 50), error: null } : s;
    case "next": {
      if (s.step !== "reason") return s;
      const r = normalizeRefundReason(s.reason);
      return r ? { step: "confirm", orderId: s.orderId, reason: r } : { ...s, error: `환불 사유를 1~${REFUND_REASON_MAX}자로 입력해주세요.` };
    }
    case "back":
      return s.step === "confirm" ? { step: "reason", orderId: s.orderId, reason: s.reason, error: null } : s;
    case "cancel":
      return REFUND_FLOW_IDLE;
    case "submit":
      return s.step === "confirm" ? { step: "submitting", orderId: s.orderId, reason: s.reason } : s;
    case "finished":
      return s;
  }
}

export function formatWon(n: number): string {
  return "₩" + n.toLocaleString("ko-KR");
}
