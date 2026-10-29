"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ProductThumb } from "../../components/ProductImage";
import { supabase } from "../../lib/supabase";
import { PAYMENT_WINDOW_EXPIRED, WINNER_PAYMENT_WINDOW_MINUTES } from "../../lib/paymentWindow";
import { ALREADY_PAID, PAYMENT_IN_PROGRESS, PAYMENT_NEEDS_REVIEW } from "../../lib/paymentCodes";
import { confirmWithAuthRecovery, type AuthRecoveryDeps, type SessionCheck } from "../../lib/confirmWithAuthRecovery";
import { savePendingConfirm } from "../../lib/pendingConfirm";
import { isWinId } from "../../lib/auctionWin";

// Supabase-backed implementations for confirmWithAuthRecovery(). Only
// non-anonymous sessions count: GameProvider can silently create an
// anonymous session once a real one is gone, and that can never pay.
const authDeps: AuthRecoveryDeps = {
  getAccessToken: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session && !session.user?.is_anonymous ? session.access_token : null;
  },
  verifySession: async (): Promise<SessionCheck> => {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) return data.user.is_anonymous ? "invalid" : "ok";
    // Couldn't reach Auth: don't conclude the session is dead.
    if (error?.name === "AuthRetryableFetchError") return "unknown";
    return "invalid";
  },
  refreshSession: async () => {
    const { data, error } = await supabase.auth.refreshSession();
    return !error && data.session && !data.session.user?.is_anonymous ? data.session.access_token : null;
  },
  postConfirm: async (body, accessToken) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    const res = await fetch("/api/payment/confirm", { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  },
};

// Terminal refusals because this win already has an active payment: the
// server refused BEFORE contacting Toss for this payment, so it was not
// approved. Re-sending can only be refused again — no retry button.
const ACTIVE_PAYMENT_SCREENS: Record<string, { label: string; title: string; body: string; href: string; cta: string }> = {
  [ALREADY_PAID]: {
    label: "결제 완료된 낙찰",
    title: "이미 결제가 완료된 낙찰입니다",
    body: "이번 결제는 승인되지 않았으며 청구되지 않습니다.\n주문 내역은 마이페이지에서 확인할 수 있습니다.",
    href: "/mypage",
    cta: "주문 내역 보기",
  },
  [PAYMENT_IN_PROGRESS]: {
    label: "결제 처리 중",
    title: "이 낙찰의 결제가 처리 중입니다",
    body: "중복 결제를 막기 위해 이번 요청은 승인하지 않았습니다.\n잠시 후 마이페이지에서 주문 내역을 확인해주세요.",
    href: "/mypage",
    cta: "주문 내역 보기",
  },
  [PAYMENT_NEEDS_REVIEW]: {
    label: "결제 확인 필요",
    title: "결제 결과 확인이 필요합니다",
    body: "결제 처리 결과를 확인하고 있습니다. 다시 결제하지 마시고\n고객센터로 문의해주세요.",
    href: "/mypage",
    cta: "마이페이지로 이동",
  },
};

// Display fallback only — the order's product_name is written server-side
// from auction_wins; Toss's response echoes it back as orderName.
const PRODUCT_NAME = "Apple iPad Air 11형 Wi-Fi 128GB";
const RETAIL_PRICE = 899_000;
function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

function getTodayPlus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// The confirm API's `error` is either one of our own plain-string messages
// (auth/winner/amount checks) or Toss's error object (has a `message`
// field) — pull a displayable string out of either shape.
function extractErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return null;
}

function SuccessInner() {
  const params = useSearchParams();
  const paymentKey = params.get("paymentKey") ?? "";
  const orderId    = params.get("orderId")    ?? "";
  const amount     = parseInt(params.get("amount") ?? "0", 10);
  // auction_wins.id, put on successUrl by /payment (and by a resumed
  // pending confirmation). Absent only on a pre-M1 success URL; present but
  // malformed is refused outright. The server re-verifies the win anyway.
  const rawWinId   = params.get("winId");
  const winId      = rawWinId != null && isWinId(rawWinId) ? rawWinId : undefined;
  const winIdBad   = rawWinId != null && winId === undefined;

  const [status, setStatus]     = useState<"loading" | "done" | "error" | "relogin">("loading");
  const [payMethod, setPayMethod] = useState("");
  const [productName, setProductName] = useState(PRODUCT_NAME);
  const [errorMessage, setErrorMessage] = useState("");
  // Machine-readable `code` from the confirm API (e.g. PAYMENT_WINDOW_EXPIRED)
  // — terminal refusals hide the retry button, since re-sending the same
  // request can only be refused again.
  const [errorCode, setErrorCode] = useState("");

  const confirm = useCallback(async () => {
    if (!paymentKey || !orderId || !amount || winIdBad) {
      setErrorMessage("잘못된 결제 접근입니다.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setErrorCode("");
    // Same values on every send (see confirmWithAuthRecovery: one
    // session-refresh retry for AUTH_SESSION_INVALID only, nothing else).
    const body = { paymentKey, orderId, amount, ...(winId ? { winId } : {}) } as const;
    const outcome = await confirmWithAuthRecovery(body, authDeps);
    if (outcome.kind === "relogin") {
      setStatus("relogin");
      return;
    }
    if (outcome.kind === "network_error") {
      setErrorMessage("네트워크 오류로 결제 확인에 실패했습니다.");
      setStatus("error");
      return;
    }
    // A non-2xx or a body that isn't { ok: true } is a real failure — never
    // show the completion screen for either.
    const json = outcome.json as { ok?: unknown; code?: unknown; data?: { method?: string; orderName?: unknown } } | null;
    if (outcome.status < 200 || outcome.status >= 300 || json?.ok !== true) {
      setErrorMessage(extractErrorMessage(json) ?? "결제 확인에 실패했습니다.");
      setErrorCode(typeof json?.code === "string" ? json.code : "");
      setStatus("error");
      return;
    }
    setPayMethod(json.data?.method ?? "카드");
    if (typeof json.data?.orderName === "string" && json.data.orderName) setProductName(json.data.orderName);
    setStatus("done");
  }, [paymentKey, orderId, amount, winId, winIdBad]);

  useEffect(() => {
    confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentKey, orderId, amount, winId]);

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

  if (status === "relogin") {
    // The session can't be recovered here. Keep this exact confirmation
    // (same paymentKey/orderId/amount/winId) so it can be resumed by hand from
    // My Page after signing in again; drop the dead local session first so
    // My Page shows the login form instead of the stale "logged-in" view.
    const goRelogin = async () => {
      savePendingConfirm({ paymentKey, orderId, amount, ...(winId ? { winId } : {}) });
      try { await supabase.auth.signOut({ scope: "local" }); } catch { /* already gone */ }
      window.location.href = "/mypage";
    };
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-[#a855f7]/15 border border-[#a855f7]/30 flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#a855f7]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-semibold mb-1 text-[#c084fc]">로그인 필요</p>
        <h1 className="text-lg font-extrabold text-white mb-2">로그인이 만료되었습니다</h1>
        <p className="text-white/55 text-sm leading-relaxed mb-8">
          다시 로그인 후 결제를 계속해주세요.<br />
          아직 결제가 승인되지 않았으며 청구되지 않았습니다.
        </p>
        <div className="w-full max-w-xs">
          <button
            onClick={goRelogin}
            className="block w-full py-3.5 text-white font-semibold text-base text-center transition-opacity active:opacity-80"
            style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
          >
            다시 로그인
          </button>
        </div>
      </main>
    );
  }

  if (status === "error" && ACTIVE_PAYMENT_SCREENS[errorCode]) {
    const screen = ACTIVE_PAYMENT_SCREENS[errorCode];
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-[#a855f7]/15 border border-[#a855f7]/30 flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-[#a855f7]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-semibold mb-1 text-[#c084fc]">{screen.label}</p>
        <h1 className="text-lg font-extrabold text-white mb-2">{screen.title}</h1>
        <p className="text-white/55 text-sm leading-relaxed mb-8 whitespace-pre-line">{screen.body}</p>
        <div className="w-full max-w-xs">
          <Link
            href={screen.href}
            className="block w-full py-3.5 text-center text-white/60 font-medium text-base border border-white/15 transition-colors hover:border-white/30"
          >
            {screen.cta}
          </Link>
        </div>
      </main>
    );
  }

  if (status === "error" && errorCode === PAYMENT_WINDOW_EXPIRED) {
    // The server refused BEFORE contacting Toss, so this payment was never
    // approved (no charge is captured) — and no retry can succeed, so no
    // retry button here.
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/12 border border-red-500/25 flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
          </svg>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-semibold mb-1 text-red-400">결제 시간 만료</p>
        <h1 className="text-lg font-extrabold text-white mb-2">결제 가능 시간이 지났습니다</h1>
        <p className="text-white/55 text-sm leading-relaxed mb-8">
          낙찰 후 {WINNER_PAYMENT_WINDOW_MINUTES}분 안에 결제가 완료되지 않아 결제가 승인되지 않았습니다.<br />
          이 결제는 청구되지 않으며, 더 이상 결제할 수 없습니다.
        </p>
        <div className="w-full max-w-xs">
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

  if (status === "error") {
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/12 border border-red-500/25 flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] font-semibold mb-1 text-red-400">결제 확인 실패</p>
        <h1 className="text-lg font-extrabold text-white mb-2">결제를 완료하지 못했습니다</h1>
        <p className="text-white/55 text-sm leading-relaxed mb-8">{errorMessage || "결제 확인 중 문제가 발생했습니다."}</p>
        <div className="w-full max-w-xs space-y-3">
          <button
            onClick={() => confirm()}
            className="block w-full py-3.5 text-white font-semibold text-base text-center transition-opacity active:opacity-80"
            style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
          >
            다시 시도
          </button>
          <Link
            href="/payment"
            className="block w-full py-3.5 text-center text-white/60 font-medium text-base border border-white/15 transition-colors hover:border-white/30"
          >
            결제 페이지로 돌아가기
          </Link>
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
        <p className="text-xs uppercase tracking-[0.18em] font-semibold mb-1" style={{ color: "#c084fc" }}>결제 완료</p>
        <h1 className="text-lg font-extrabold text-white mb-2">낙찰이 확정되었습니다!</h1>
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
          <ProductThumb alt={productName} size={64} rounded="rounded-sm" />
          <div>
            <p className="text-white/80 text-base font-semibold leading-snug">{productName}</p>
            <p className="text-[#c084fc] font-extrabold text-xl tabular-nums mt-1">{fmt(amount)}</p>
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
          <p className="text-xs text-[#c084fc] font-semibold uppercase tracking-wider mb-0.5">절약 금액</p>
          <p className="text-white/70 text-xs">정가 대비 아낀 금액</p>
        </div>
        <p className="text-[#c084fc] font-extrabold text-xl tabular-nums">{fmt(RETAIL_PRICE - amount)}</p>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <Link
          href="/mypage"
          className="block w-full py-4 text-white font-semibold text-base text-center transition-opacity active:opacity-80"
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
