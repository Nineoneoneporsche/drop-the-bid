"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ProductThumb } from "../../components/ProductImage";
import { supabase } from "../../lib/supabase";

const PRODUCT_NAME = "Apple iPad Air 11형 Wi-Fi 128GB";
const RETAIL_PRICE = 899_000;
function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

function getTodayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function SuccessInner() {
  const params = useSearchParams();
  const paymentKey = params.get("paymentKey") ?? "";
  const orderId    = params.get("orderId")    ?? "";
  const amount     = parseInt(params.get("amount") ?? "0", 10);

  const [status, setStatus]     = useState<"loading" | "done" | "error">("loading");
  const [payMethod, setPayMethod] = useState("");

  useEffect(() => {
    if (!paymentKey || !orderId || !amount) { setStatus("error"); return; }

    async function confirm() {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

      try {
        const res = await fetch("/api/payment/confirm", {
          method: "POST",
          headers,
          body: JSON.stringify({ paymentKey, orderId, amount }),
        });
        const data = await res.json();
        setPayMethod(data.data?.method ?? "카드");
      } catch { /* 데모: 네트워크 오류도 완료 처리 */ }
      setStatus("done");
    }
    confirm();
  }, [paymentKey, orderId, amount]);

  if (status === "loading") {
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin w-8 h-8 text-[#a855f7] mx-auto mb-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          <p className="text-white/60 text-sm">결제를 확인하고 있습니다...</p>
        </div>
      </main>
    );
  }

  const displayOrderId = orderId || "";

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col max-w-md mx-auto px-4 pt-12 pb-12">
      <div className="success-pop text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-[#a855f7]/15 border border-[#a855f7]/30 flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#a855f7]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-bold mb-1" style={{ color: "#c084fc" }}>결제 완료</p>
        <h1 className="text-lg font-black text-white mb-2">낙찰이 확정되었습니다!</h1>
        <p className="text-white/55 text-sm leading-relaxed">
          주문이 접수되었습니다.<br />배송 정보는 등록된 연락처로 안내드립니다.
        </p>
      </div>

      {/* Order detail card */}
      <div className="bg-[#141414] border border-white/12 mb-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10">
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium">주문 정보</p>
        </div>
        <div className="px-4 py-4 flex gap-4 items-center border-b border-white/10">
          <ProductThumb alt={PRODUCT_NAME} size={64} rounded="rounded-sm" />
          <div>
            <p className="text-white/80 text-base font-semibold leading-snug">{PRODUCT_NAME}</p>
            <p className="text-[#c084fc] font-black text-xl font-mono tabular-nums mt-1">{fmt(amount)}</p>
            <p className="text-white/45 text-xs mt-0.5 line-through">정가 {fmt(RETAIL_PRICE)}</p>
          </div>
        </div>
        <div className="px-4 py-4 space-y-2.5">
          {[
            ["주문번호", displayOrderId.slice(0, 24)],
            ["결제 수단", payMethod || "신용카드"],
            ["결제 금액", fmt(amount)],
            ["배송비",   "무료"],
            ["예상 배송일", `${getTodayPlus(2)} ~ ${getTodayPlus(4)}`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between items-center">
              <span className="text-white/50 text-xs">{label}</span>
              <span className="text-white/85 text-xs font-medium tabular-nums">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Savings highlight */}
      <div className="bg-[#a855f7]/8 border border-[#a855f7]/20 px-4 py-3.5 mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs text-[#c084fc] font-bold uppercase tracking-wider mb-0.5">절약 금액</p>
          <p className="text-white/70 text-xs">정가 대비 아낀 금액</p>
        </div>
        <p className="text-[#c084fc] font-black text-xl font-mono tabular-nums">{fmt(RETAIL_PRICE - amount)}</p>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <Link
          href="/mypage"
          className="block w-full py-4 text-white font-bold text-base text-center transition-opacity active:opacity-80"
          style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
        >
          주문 내역 보기
        </Link>
        <Link
          href="/"
          className="block w-full py-3.5 text-center text-white/60 font-medium text-base border border-white/15 transition-colors hover:border-white/30"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </main>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessInner />
    </Suspense>
  );
}
