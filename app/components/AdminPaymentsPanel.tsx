"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  formatWon, paymentRowView, refundErrorMessage, refundFlow, REFUND_FLOW_IDLE, REFUND_MESSAGES, REFUND_REASON_MAX,
  type AdminPaymentItem, type CancellationStatus, type RefundFlow, type RefundFlowAction,
} from "../lib/adminRefund";

// "결제·환불" on the admin page (M4-B3): recent paid orders, a two-step
// "전액 환불" (사유 입력 -> 금액 확인 -> request), and "환불 상태 확인" for a
// refund whose outcome is unknown. The browser sends only the order id and
// the reason (refund) or the cancellation id (re-check); the server takes
// everything else from the DB.

export type RowResult = { tone: "done" | "failed" | "warn"; text: string };

function resultFor(status: unknown): RowResult {
  const s = status as CancellationStatus;
  if (s === "done") return { tone: "done", text: REFUND_MESSAGES.done };
  if (s === "failed") return { tone: "failed", text: REFUND_MESSAGES.failed };
  if (s === "pending") return { tone: "warn", text: REFUND_MESSAGES.pending };
  return { tone: "warn", text: REFUND_MESSAGES.reconciliation_required };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const TONE_CLASS: Record<string, string> = {
  ok: "text-gray-900", busy: "text-amber-600", warn: "text-red-500", done: "text-green-600", muted: "text-gray-400", failed: "text-red-500",
};

export type AdminPaymentsViewProps = {
  items: AdminPaymentItem[];
  loadError: boolean;
  flow: RefundFlow;
  busy: string | null; // the cancellation id being re-checked
  results: Record<string, RowResult>;
  dispatch: (a: RefundFlowAction) => void;
  onSubmit: () => void;
  onRecheck: (cancellationId: string, orderId: string) => void;
  onRefresh: () => void;
};

// Pure view (no hooks), so tests can render every state.
export function AdminPaymentsView(p: AdminPaymentsViewProps): ReactElement {
  const locked = p.flow.step === "submitting" || p.busy !== null;
  const idle = p.flow.step === "idle" && !locked;
  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm mb-8 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-xs uppercase tracking-wider font-medium">결제·환불</p>
        <button
          type="button"
          onClick={p.onRefresh}
          disabled={locked}
          className="text-gray-400 hover:text-orange-500 text-xs border border-gray-200 rounded-lg px-2 py-1 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>
      {p.loadError && <p className="text-red-500 text-xs">결제 목록을 불러오지 못했습니다. 새로고침을 눌러 다시 시도해주세요.</p>}
      {!p.loadError && p.items.length === 0 && <p className="text-gray-400 text-sm">결제 완료된 주문이 없습니다.</p>}
      {p.items.map((item) => {
        const v = paymentRowView(item);
        const f = p.flow.step !== "idle" && p.flow.orderId === item.orderId ? p.flow : null;
        const r = p.results[item.orderId];
        return (
          <div key={item.orderId} data-order={item.orderId} className="border-t border-gray-100 pt-3 space-y-1.5">
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-gray-900 text-sm font-semibold truncate">{item.productName ?? "—"}</span>
              <span className="text-gray-900 text-sm font-semibold flex-shrink-0">{formatWon(item.amount)}</span>
            </div>
            <div className="flex justify-between items-baseline gap-3">
              <span className="text-gray-400 text-xs font-mono truncate">{item.orderId}</span>
              <span className="text-gray-400 text-xs flex-shrink-0">결제 {fmtDate(item.paidAt)}</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span data-status="" className={`text-sm font-semibold ${TONE_CLASS[v.tone]}`}>{v.label}</span>
              <div className="flex gap-2">
                {v.canRefund && (
                  <button
                    type="button"
                    data-action="refund"
                    disabled={!idle}
                    onClick={() => p.dispatch({ type: "open", orderId: item.orderId })}
                    className="text-red-500 border border-red-200 hover:border-red-400 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                  >
                    전액 환불
                  </button>
                )}
                {v.canRecheck && item.cancellation && (
                  <button
                    type="button"
                    data-action="recheck"
                    disabled={locked || p.flow.step !== "idle"}
                    onClick={() => p.onRecheck(item.cancellation!.cancellationId, item.orderId)}
                    className="text-amber-600 border border-amber-200 hover:border-amber-400 rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                  >
                    {p.busy === item.cancellation.cancellationId ? "확인 중..." : "환불 상태 확인"}
                  </button>
                )}
              </div>
            </div>
            {item.refundedAt && <p className="text-gray-400 text-xs">환불일 {fmtDate(item.refundedAt)}</p>}
            {r && <p data-result={r.tone} className={`text-xs font-semibold ${TONE_CLASS[r.tone]}`}>{r.text}</p>}

            {f?.step === "reason" && (
              <div data-step="reason" className="bg-red-50 border border-red-200 rounded-2xl p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-900">{item.productName ?? "—"}</p>
                <p className="text-xs text-gray-500">주문번호 {item.orderId}</p>
                <p className="text-xs text-gray-500">환불금액 {formatWon(item.amount)}</p>
                <p className="text-xs font-semibold text-red-600">전액 환불만 가능합니다.</p>
                <label className="block text-xs font-semibold text-gray-700">
                  환불 사유 (필수, 1~{REFUND_REASON_MAX}자 · 관리자 기록으로 남습니다)
                  <textarea
                    value={f.reason}
                    maxLength={REFUND_REASON_MAX}
                    onChange={(e) => p.dispatch({ type: "edit", reason: e.target.value })}
                    rows={2}
                    className="mt-1 w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-normal"
                  />
                </label>
                {f.error && <p className="text-red-500 text-xs">{f.error}</p>}
                <div className="flex gap-2">
                  <button type="button" data-action="cancel" onClick={() => p.dispatch({ type: "cancel" })}
                    className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-500">취소</button>
                  <button type="button" data-action="next" onClick={() => p.dispatch({ type: "next" })}
                    className="flex-1 bg-red-500 text-white rounded-xl py-2 text-sm font-semibold">다음</button>
                </div>
              </div>
            )}
            {(f?.step === "confirm" || f?.step === "submitting") && (
              <div data-step={f.step} className="bg-red-50 border border-red-200 rounded-2xl p-3 space-y-2">
                <p className="text-sm font-semibold text-gray-900">정말 {formatWon(item.amount)}를 전액 환불하시겠습니까?</p>
                <p className="text-xs text-gray-500">사유: {f.reason}</p>
                <div className="flex gap-2">
                  <button type="button" data-action="back" disabled={f.step === "submitting"} onClick={() => p.dispatch({ type: "back" })}
                    className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-500 disabled:opacity-50">이전</button>
                  <button type="button" data-action="confirm" disabled={f.step === "submitting"} onClick={p.onSubmit}
                    className="flex-1 bg-red-600 text-white rounded-xl py-2 text-sm font-bold disabled:opacity-50">
                    {f.step === "submitting" ? "환불 요청 중..." : "전액 환불 확인"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AdminPaymentsPanel() {
  const [items, setItems] = useState<AdminPaymentItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [flow, setFlow] = useState<RefundFlow>(REFUND_FLOW_IDLE);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  // Set synchronously, so a double click can't start a second request
  // before React re-renders the disabled buttons.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payments");
      const body = await res.json();
      if (body?.ok === true && Array.isArray(body.items)) {
        setItems(body.items as AdminPaymentItem[]);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dispatch = useCallback((a: RefundFlowAction) => setFlow((s) => refundFlow(s, a)), []);

  async function submit() {
    if (flow.step !== "confirm" || inFlight.current) return; // one request per confirmation
    inFlight.current = true;
    const { orderId, reason } = flow;
    setFlow(refundFlow(flow, { type: "submit" }));
    let result: RowResult;
    try {
      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, reason }),
      });
      const body = await res.json();
      result = body?.ok === true ? resultFor(body.status) : { tone: "failed", text: refundErrorMessage(body?.error) };
    } catch {
      result = { tone: "warn", text: "응답을 받지 못했습니다. 목록을 새로고침해 환불 상태를 확인해주세요. 다시 요청하기 전에 상태를 먼저 확인해주세요." };
    }
    setResults((r) => ({ ...r, [orderId]: result }));
    setFlow(REFUND_FLOW_IDLE);
    inFlight.current = false;
    await load();
  }

  async function recheck(cancellationId: string, orderId: string) {
    if (busy || flow.step !== "idle" || inFlight.current) return;
    inFlight.current = true;
    setBusy(cancellationId);
    let result: RowResult;
    try {
      const res = await fetch("/api/admin/refund/recheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancellationId }),
      });
      const body = await res.json();
      result = body?.ok === true ? resultFor(body.status) : { tone: "warn", text: refundErrorMessage(body?.error) };
    } catch {
      result = { tone: "warn", text: refundErrorMessage(null) };
    }
    setResults((r) => ({ ...r, [orderId]: result }));
    setBusy(null);
    inFlight.current = false;
    await load();
  }

  return (
    <AdminPaymentsView
      items={items} loadError={loadError} flow={flow} busy={busy} results={results}
      dispatch={dispatch} onSubmit={() => void submit()} onRecheck={(c, o) => void recheck(c, o)} onRefresh={() => void load()}
    />
  );
}
