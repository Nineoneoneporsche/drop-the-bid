"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProductThumb } from "../components/ProductImage";
import HomeButton from "../components/HomeButton";

const PRICE = 150_000;
const PRODUCT_NAME = "NUVY 누비 유모차 자전거";

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

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

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
        if (s <= 1) {
          clearInterval(t);
          setExpired(true);
          return 0;
        }
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

  // ── Success state ──
  if (paid) {
    return (
      <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md text-center success-pop">
          <div className="text-6xl mb-4">✅</div>
          <h1 className="text-3xl font-black text-gray-900 mb-2">결제 완료</h1>
          <p className="text-gray-500 text-base mb-1">낙찰이 확정되었습니다.</p>
          <p className="text-gray-400 text-sm mb-8 leading-relaxed">
            배송 정보는 등록된 연락처로<br />안내드립니다.
          </p>
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 mb-6 text-left">
            <div className="flex gap-4 items-center">
              <ProductThumb alt={PRODUCT_NAME} size={64} rounded="rounded-2xl" />
              <div>
                <p className="text-gray-800 text-sm font-semibold leading-snug">{PRODUCT_NAME}</p>
                <p className="text-orange-500 font-black text-lg font-mono tabular-nums mt-1">{fmt(PRICE)}</p>
                <p className="text-gray-400 text-xs mt-0.5">배송 준비 중</p>
              </div>
            </div>
          </div>
          <Link
            href="/"
            className="block w-full py-4 rounded-2xl text-white font-bold text-base text-center active:scale-[0.98] transition-transform shadow-md"
            style={{
              background: "linear-gradient(135deg,#fb923c,#f97316)",
              boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
            }}
          >
            홈으로 가기
          </Link>
        </div>
      </main>
    );
  }

  // ── Main payment page ──
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-white px-4 pt-10 pb-4 border-b border-gray-100 shadow-sm flex-shrink-0">
        <div className="flex mb-3">
          <HomeButton />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-xl font-black text-gray-900">결제하기</h1>
            <p className="text-gray-400 text-xs mt-0.5">낙찰 상품을 확인하고 결제를 완료하세요.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 mb-0.5">남은 시간</p>
            <p
              className={`font-black font-mono text-2xl tabular-nums leading-none ${
                expired ? "text-gray-300" : timeLeft < 60 ? "text-red-500" : "text-orange-500"
              }`}
            >
              {fmtTime(timeLeft)}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {expired && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 text-center">
            <p className="text-red-600 text-sm font-bold">결제 시간이 만료되었습니다.</p>
            <p className="text-red-400 text-xs mt-0.5">홈으로 돌아가 다시 시작해주세요.</p>
          </div>
        )}

        {/* Product summary */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
          <p className="text-gray-400 text-[11px] uppercase tracking-wider font-medium mb-4">상품 정보</p>
          <div className="flex gap-4">
            <ProductThumb alt={PRODUCT_NAME} size={80} rounded="rounded-2xl" />
            <div className="flex-1 min-w-0">
              <p className="text-gray-800 text-sm font-semibold leading-snug">{PRODUCT_NAME}</p>
              <p className="text-gray-400 text-xs mt-1">정가 ₩250,000</p>
              <p className="text-orange-500 font-black text-xl font-mono tabular-nums mt-1">{fmt(PRICE)}</p>
            </div>
          </div>
          <div className="border-t border-gray-100 mt-4 pt-4 space-y-2.5">
            {[
              ["상품 금액", fmt(PRICE)],
              ["배송비",   "무료"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-gray-400 text-sm">{label}</span>
                <span className="text-gray-700 text-sm font-medium">{value}</span>
              </div>
            ))}
            <div className="border-t border-gray-100 pt-2.5 flex justify-between">
              <span className="text-gray-800 text-sm font-bold">합계</span>
              <span className="text-orange-500 font-black text-sm font-mono tabular-nums">{fmt(PRICE)}</span>
            </div>
          </div>
        </div>

        {/* Payment method */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
          <p className="text-gray-400 text-[11px] uppercase tracking-wider font-medium mb-4">결제 수단</p>
          <div className="space-y-2">
            {METHODS.map((m) => {
              const sel = method === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all ${
                    sel
                      ? "border-orange-400 bg-orange-50"
                      : "border-gray-100 bg-gray-50 hover:border-orange-200"
                  }`}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: m.id === "card" ? "#f3f4f6" : m.bg }}
                  >
                    {m.id === "card" ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="w-5 h-5 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="1" y="4" width="22" height="16" rx="2" />
                        <line x1="1" y1="10" x2="23" y2="10" />
                      </svg>
                    ) : (
                      <span
                        className="text-sm font-black"
                        style={{ color: m.dark ? "#000" : "#fff" }}
                      >
                        {m.letter}
                      </span>
                    )}
                  </div>
                  <span className={`flex-1 text-sm font-semibold ${sel ? "text-gray-900" : "text-gray-600"}`}>
                    {m.label}
                  </span>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      sel ? "border-orange-400 bg-orange-400" : "border-gray-300"
                    }`}
                  >
                    {sel && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Delivery */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-400 text-[11px] uppercase tracking-wider font-medium">배송지</p>
            <button
              disabled
              className="text-xs text-gray-300 border border-gray-200 rounded-lg px-2.5 py-1 cursor-not-allowed"
            >
              배송지 변경
            </button>
          </div>
          <p className="text-gray-800 text-sm font-bold">김샘플 · 010-0000-0000</p>
          <p className="text-gray-500 text-sm mt-1">서울특별시 강남구 테헤란로 123</p>
          <p className="text-gray-500 text-sm">역삼 ○○빌딩 12층</p>
          <span className="inline-block mt-2.5 bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">
            기본 배송지
          </span>
        </div>

        {/* Agreement */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
          <button
            onClick={() => setAgreed((a) => !a)}
            className="w-full flex items-start gap-3 text-left"
          >
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                agreed ? "bg-orange-500 border-orange-500" : "border-gray-300 bg-white"
              }`}
            >
              {agreed && (
                <svg
                  viewBox="0 0 12 12"
                  className="w-3 h-3"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1,6 5,10 11,2" />
                </svg>
              )}
            </div>
            <p className="text-gray-600 text-sm leading-relaxed">
              결제 정보 및 개인정보 수집·이용에 동의합니다.{" "}
              <span className="text-orange-500 font-semibold">(필수)</span>
            </p>
          </button>
        </div>
      </div>

      {/* Sticky footer CTA */}
      <div className="flex-shrink-0 bg-white border-t border-gray-100 px-4 pt-4 pb-10">
        <button
          onClick={handlePay}
          disabled={!canPay}
          className="w-full py-4 rounded-2xl text-base font-bold transition-all active:scale-[0.98]"
          style={
            canPay
              ? {
                  background: "linear-gradient(135deg,#fb923c,#f97316)",
                  color: "#fff",
                  boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
                }
              : { background: "#e5e7eb", color: "#9ca3af" }
          }
        >
          {fmt(PRICE)} 결제하기
        </button>
        {!agreed && !expired && (
          <p className="text-center text-gray-400 text-xs mt-2">
            동의 후 결제 가능합니다.
          </p>
        )}
        {expired && (
          <p className="text-center text-red-400 text-xs mt-2">
            결제 가능 시간이 만료되었습니다.
          </p>
        )}
      </div>
    </main>
  );
}
