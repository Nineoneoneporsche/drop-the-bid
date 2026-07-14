"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProductThumb } from "../components/ProductImage";
import HomeButton from "../components/HomeButton";

const PRICE = 550_000;
const PRODUCT_NAME = "Apple iPad Air 11형 Wi-Fi 128GB";

type PayMethod = {
  id: string;
  label: string;
  bg?: string;
  letter?: string;
  dark?: boolean;
};

const METHODS: PayMethod[] = [
  { id: "card",  label: "신용/체크카드" },
  { id: "kakao", label: "카카오페이",  bg: "#FEE500", letter: "K", dark: true  },
  { id: "naver", label: "네이버페이",  bg: "#03C75A", letter: "N", dark: false },
  { id: "toss",  label: "토스페이",    bg: "#0064FF", letter: "T", dark: false },
];

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }
function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function PaymentPage() {
  const [timeLeft, setTimeLeft] = useState(600);
  const [expired,  setExpired]  = useState(false);
  const [method,   setMethod]   = useState("card");
  const [agreed,   setAgreed]   = useState(false);
  const [paid,     setPaid]     = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) { clearInterval(t); setExpired(true); return 0; }
        return s - 1;
      });
    }, 1000);
    timerRef.current = t;
    return () => clearInterval(t);
  }, []);

  const canPay = agreed && !expired;

  function handlePay() {
    if (!canPay) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setPaid(true);
  }

  if (paid) {
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center success-pop">
          <div className="text-6xl mb-5">✅</div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/60 font-medium mb-2">결제 완료</p>
          <h1 className="text-3xl font-black text-white mb-2">낙찰이 확정되었습니다.</h1>
          <p className="text-white/65 text-sm mb-8 leading-relaxed">
            배송 정보는 등록된 연락처로 안내드립니다.
          </p>
          <div className="bg-[#141414] border border-white/15 p-5 mb-6 text-left">
            <div className="flex gap-4 items-center">
              <ProductThumb alt={PRODUCT_NAME} size={60} rounded="rounded-sm" />
              <div>
                <p className="text-white/70 text-sm font-semibold leading-snug">{PRODUCT_NAME}</p>
                <p className="text-[#c084fc] font-black text-xl font-mono tabular-nums mt-1">{fmt(PRICE)}</p>
                <p className="text-white/60 text-xs mt-0.5">배송 준비 중</p>
              </div>
            </div>
          </div>
          <Link
            href="/"
            className="block w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80"
            style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
          >
            홈으로 가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-[#141414] px-4 pt-10 pb-4 border-b border-white/15 flex-shrink-0">
        <div className="mb-3">
          <HomeButton />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/55 font-medium mb-1">Drop The Bid</p>
            <h1 className="text-xl font-black text-white">결제하기</h1>
            <p className="text-white/65 text-xs mt-0.5">낙찰 상품을 확인하고 결제를 완료하세요.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-white/60 mb-0.5">남은 시간</p>
            <p
              className={`font-black font-mono text-2xl tabular-nums leading-none ${
                expired ? "text-white/45" : timeLeft < 60 ? "text-red-500" : "text-[#a855f7]"
              }`}
            >
              {fmtTime(timeLeft)}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {expired && (
          <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/20">
            <p className="text-red-400 text-sm font-bold text-center">결제 시간이 만료되었습니다.</p>
          </div>
        )}

        {/* Product */}
        <div className="px-4 py-5 border-b border-white/15">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/60 font-medium mb-4">상품 정보</p>
          <div className="flex gap-4">
            <ProductThumb alt={PRODUCT_NAME} size={80} rounded="rounded-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-white/70 text-sm font-semibold leading-snug">{PRODUCT_NAME}</p>
              <p className="text-white/55 text-xs mt-1">정가 ₩899,000</p>
              <p className="text-[#c084fc] font-black text-2xl font-mono tabular-nums mt-1 leading-none">{fmt(PRICE)}</p>
            </div>
          </div>
          <div className="border-t border-white/15 mt-4 pt-4 space-y-2">
            {[["상품 금액", fmt(PRICE)], ["배송비", "무료"]].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-white/60 text-sm">{label}</span>
                <span className="text-white/80 text-sm font-medium">{value}</span>
              </div>
            ))}
            <div className="border-t border-white/15 pt-2 flex justify-between">
              <span className="text-white text-sm font-bold">합계</span>
              <span className="text-[#c084fc] font-black text-sm font-mono tabular-nums">{fmt(PRICE)}</span>
            </div>
          </div>
        </div>

        {/* Payment method */}
        <div className="px-4 py-5 border-b border-white/15">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/60 font-medium mb-4">결제 수단</p>
          <div className="space-y-2">
            {METHODS.map((m) => {
              const sel = method === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left border transition-colors ${
                    sel ? "border-[#a855f7] bg-[#a855f7]/10" : "border-white/15 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-sm flex items-center justify-center flex-shrink-0"
                    style={{ background: m.id === "card" ? "rgba(255,255,255,0.1)" : m.bg }}
                  >
                    {m.id === "card" ? (
                      <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/50" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="1" y="4" width="22" height="16" rx="2" />
                        <line x1="1" y1="10" x2="23" y2="10" />
                      </svg>
                    ) : (
                      <span className="text-xs font-black" style={{ color: m.dark ? "#000" : "#fff" }}>{m.letter}</span>
                    )}
                  </div>
                  <span className={`flex-1 text-sm font-semibold ${sel ? "text-white" : "text-white/70"}`}>{m.label}</span>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${sel ? "border-[#a855f7]" : "border-white/35"}`}>
                    {sel && <div className="w-2 h-2 rounded-full bg-[#a855f7]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Delivery */}
        <div className="px-4 py-5 border-b border-white/15">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/60 font-medium">배송지</p>
            <button disabled className="text-[11px] text-white/45 border border-white/20 px-2.5 py-1 cursor-not-allowed">
              배송지 변경
            </button>
          </div>
          <p className="text-white/70 text-sm font-bold">김샘플 · 010-0000-0000</p>
          <p className="text-white/70 text-sm mt-1">서울특별시 강남구 테헤란로 123</p>
          <p className="text-white/70 text-sm">역삼 ○○빌딩 12층</p>
          <span className="inline-block mt-2 bg-white/12 text-white/65 text-[11px] font-medium px-2 py-0.5">기본 배송지</span>
        </div>

        {/* Agreement */}
        <div className="px-4 py-5">
          <button onClick={() => setAgreed((a) => !a)} className="w-full flex items-start gap-3 text-left">
            <div className={`w-5 h-5 border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${agreed ? "bg-[#a855f7] border-[#a855f7]" : "border-white/20 bg-transparent"}`}>
              {agreed && (
                <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1,6 5,10 11,2" />
                </svg>
              )}
            </div>
            <p className="text-white/70 text-sm leading-relaxed">
              결제 정보 및 개인정보 수집·이용에 동의합니다.{" "}
              <span className="text-[#a855f7] font-semibold">(필수)</span>
            </p>
          </button>
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="flex-shrink-0 bg-[#141414] border-t border-white/15 px-4 pt-4 pb-8">
        <button
          onClick={handlePay}
          disabled={!canPay}
          className="w-full py-4 text-base font-bold transition-opacity active:opacity-80 disabled:cursor-not-allowed"
          style={canPay ? { background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)", color: "#fff" } : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.2)" }}
        >
          {fmt(PRICE)} 결제하기
        </button>
        {!agreed && !expired && (
          <p className="text-center text-white/55 text-xs mt-2">동의 후 결제 가능합니다.</p>
        )}
        {expired && (
          <p className="text-center text-red-400 text-xs mt-2">결제 가능 시간이 만료되었습니다.</p>
        )}
      </div>
    </main>
  );
}
