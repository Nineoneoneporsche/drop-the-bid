"use client";

import Link from "next/link";
import { usePendingWin } from "../lib/pendingWin";

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Recovery CTA for a won-but-unpaid auction — renders nothing unless
// usePendingWin() says the signed-in user can still pay. Links straight to
// /payment (no home/join/winner-animation detour); /payment and the confirm
// API do their own winner checks.
export default function PendingWinBanner({ className = "" }: { className?: string }) {
  const { pending, remainingSeconds } = usePendingWin();
  if (!pending) return null;

  return (
    <div
      className={`w-full px-4 py-3.5 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/10 ${className}`}
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white text-sm font-bold">결제 대기 중인 낙찰이 있습니다</p>
          <p className="text-white/60 text-xs mt-0.5">
            남은 시간 <span className={`font-bold tabular-nums ${remainingSeconds < 60 ? "text-red-400" : "text-[#c084fc]"}`}>{fmtTime(remainingSeconds)}</span>
          </p>
        </div>
        <Link
          href="/payment"
          className="flex-shrink-0 px-4 py-2.5 text-sm font-semibold text-white rounded-lg bid-btn-purple"
        >
          결제 계속하기
        </Link>
      </div>
    </div>
  );
}
