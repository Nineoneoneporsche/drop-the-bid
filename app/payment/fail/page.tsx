"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import HomeButton from "../../components/HomeButton";
import { failScreenFor } from "../../lib/paymentFail";

function FailInner() {
  const params = useSearchParams();
  const screen = failScreenFor(params.get("code") ?? "");

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col max-w-md mx-auto px-4 pt-10 pb-12">
      <div className="mb-8"><HomeButton /></div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center mx-auto mb-5">
          <svg viewBox="0 0 24 24" className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {screen.cancel
              ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
            }
          </svg>
        </div>

        <p className="text-xs uppercase tracking-[0.18em] font-semibold text-red-400 mb-2">
          {screen.cancel ? "결제 취소" : "결제 실패"}
        </p>
        <h1 className="text-lg font-extrabold text-white mb-3">{screen.title}</h1>
        <p className="text-white/55 text-sm leading-relaxed mb-2">{screen.body}</p>
        {screen.shownCode && !screen.cancel && (
          <p className="text-white/30 text-xs">오류 코드: {screen.shownCode}</p>
        )}
      </div>

      <div className="space-y-3 mt-10">
        <Link
          href="/payment"
          className="block w-full py-4 text-center text-white font-semibold text-base transition-opacity active:opacity-80"
          style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
        >
          다시 시도하기
        </Link>
        <Link
          href="/"
          className="block w-full py-3.5 text-center text-white/60 font-medium text-base border border-white/15"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </main>
  );
}

export default function PaymentFailPage() {
  return (
    <Suspense fallback={null}>
      <FailInner />
    </Suspense>
  );
}
