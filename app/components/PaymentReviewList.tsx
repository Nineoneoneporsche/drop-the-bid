"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { reviewResult, type ReviewItem, type ReviewResult } from "../lib/paymentReview";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

async function authHeader(): Promise<Record<string, string> | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : null;
}

// The signed-in user's payments whose outcome DTB could not settle
// (payment_attempts.status = reconciliation_required), each with a
// "결제 상태 확인" button. The button only asks the server to look the
// existing payment up with Toss (POST /api/payment/recheck with the order
// id; the server loads everything else itself) — it never opens a payment
// window and never starts a new payment.
export default function PaymentReviewList({ onPaid, className = "" }: { onPaid?: () => void; className?: string }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReviewResult>>({});

  const load = useCallback(async () => {
    const headers = await authHeader();
    if (!headers) return;
    try {
      const res = await fetch("/api/payment/recheck", { headers });
      const body = await res.json();
      if (body?.ok === true && Array.isArray(body.items)) setItems(body.items as ReviewItem[]);
    } catch {
      /* the list just stays as it was */
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function check(orderId: string) {
    if (busy) return;
    setBusy(orderId);
    let result: ReviewResult;
    try {
      const headers = await authHeader();
      const res = headers
        ? await fetch("/api/payment/recheck", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ orderId }),
        })
        : null;
      result = reviewResult(res ? await res.json() : null);
    } catch {
      result = reviewResult(null);
    }
    setResults((r) => ({ ...r, [orderId]: result }));
    setBusy(null);
    if (result.tone === "done") onPaid?.();
  }

  if (items.length === 0) return null;

  return (
    <div className={`bg-[#141414] border border-amber-400/30 rounded-2xl overflow-hidden ${className}`}>
      <div className="px-5 pt-4 pb-1">
        <p className="text-xs uppercase tracking-[0.12em] text-amber-300/80 font-medium">결제 상태 확인 필요</p>
      </div>
      {items.map((item, i) => {
        const result = results[item.orderId];
        return (
          <div key={item.orderId} className={`px-5 py-3.5 ${i < items.length - 1 ? "border-b border-white/8" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white/80 truncate">{item.productName ?? "구매 상품"}</p>
                <p className="text-xs text-white/50 mt-0.5">{fmt(item.amount)} · 결제 상태 확인 필요</p>
              </div>
              {!result?.settled && (
                <button
                  type="button"
                  onClick={() => void check(item.orderId)}
                  disabled={busy !== null}
                  className="flex-shrink-0 px-4 py-2.5 text-sm font-semibold text-white rounded-lg border border-amber-300/50 disabled:opacity-50"
                >
                  {busy === item.orderId ? "확인 중…" : "결제 상태 확인"}
                </button>
              )}
            </div>
            {result && (
              <p className={`text-xs mt-2 ${result.tone === "done" ? "text-emerald-300" : result.tone === "failed" ? "text-white/60" : "text-amber-200/80"}`} role="status">
                {result.text}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
