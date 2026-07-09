"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useGame, formatKRW } from "../context/GameContext";
import { ProductThumb } from "../components/ProductImage";
import BottomNav from "../components/BottomNav";

const REACTIONS = [
  { nickname: "shopping_star", message: "와 대박! 정말 좋은 가격이에요! 🎉", delay: 900 },
  { nickname: "minivelo_fan",  message: "타이밍이 완벽하네요! 부럽다 ㅠ",     delay: 1800 },
  { nickname: "kid_gear_mom",  message: "저 제품 좋던데 잘 쓰세요! 👏",       delay: 2700 },
  { nickname: "smart_buyer",   message: "저도 저 가격에 사고 싶었는데... 다음엔 제가! 😊", delay: 3600 },
  { nickname: "minivelo_fan",  message: "축하드려요!! 완전 이득이네요 🎊",     delay: 4400 },
];

const CONFETTI = [
  { left: "5%",  delay: "0s",    dur: "1.6s", color: "#f97316", w: 8,  h: 12, rot: 20 },
  { left: "12%", delay: "0.2s",  dur: "1.9s", color: "#a855f7", w: 6,  h: 10, rot: 70 },
  { left: "18%", delay: "0.05s", dur: "1.7s", color: "#eab308", w: 9,  h: 7,  rot: 140 },
  { left: "25%", delay: "0.35s", dur: "2.1s", color: "#ec4899", w: 7,  h: 11, rot: 200 },
  { left: "33%", delay: "0.15s", dur: "1.5s", color: "#fb923c", w: 10, h: 8,  rot: 45 },
  { left: "40%", delay: "0.45s", dur: "2.0s", color: "#3b82f6", w: 6,  h: 13, rot: 90 },
  { left: "47%", delay: "0.08s", dur: "1.8s", color: "#22c55e", w: 8,  h: 9,  rot: 160 },
  { left: "53%", delay: "0.28s", dur: "1.65s",color: "#fbbf24", w: 11, h: 7,  rot: 30 },
  { left: "60%", delay: "0.52s", dur: "2.2s", color: "#f43f5e", w: 7,  h: 10, rot: 110 },
  { left: "67%", delay: "0.12s", dur: "1.75s",color: "#f97316", w: 9,  h: 8,  rot: 250 },
  { left: "74%", delay: "0.38s", dur: "1.9s", color: "#a78bfa", w: 6,  h: 12, rot: 15 },
  { left: "80%", delay: "0.22s", dur: "2.0s", color: "#eab308", w: 8,  h: 7,  rot: 80 },
  { left: "87%", delay: "0.48s", dur: "1.6s", color: "#fb923c", w: 10, h: 9,  rot: 195 },
  { left: "93%", delay: "0.06s", dur: "1.85s",color: "#34d399", w: 7,  h: 11, rot: 320 },
  { left: "8%",  delay: "0.6s",  dur: "2.1s", color: "#f97316", w: 9,  h: 8,  rot: 55 },
  { left: "22%", delay: "0.72s", dur: "1.7s", color: "#ec4899", w: 7,  h: 10, rot: 135 },
  { left: "36%", delay: "0.58s", dur: "2.3s", color: "#fbbf24", w: 11, h: 7,  rot: 280 },
  { left: "50%", delay: "0.68s", dur: "1.95s",color: "#fb923c", w: 8,  h: 12, rot: 10 },
  { left: "64%", delay: "0.82s", dur: "1.6s", color: "#a855f7", w: 6,  h: 9,  rot: 175 },
  { left: "78%", delay: "0.75s", dur: "2.05s",color: "#f97316", w: 10, h: 7,  rot: 60 },
];

function ConfettiRain() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-10">
      {CONFETTI.map((p, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: p.left,
            width: p.w,
            height: p.h,
            backgroundColor: p.color,
            animationDelay: p.delay,
            animationDuration: p.dur,
            transform: `rotateZ(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export default function WinnerPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();
  const [visibleReactions, setVisibleReactions] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [payTime, setPayTime] = useState(600);

  useEffect(() => {
    if (!state.winner) { router.replace("/"); return; }
    const cardTimer = setTimeout(() => setShowCard(true), 400);
    const timers = REACTIONS.map((r, i) =>
      setTimeout(() => setVisibleReactions(i + 1), r.delay)
    );
    return () => {
      clearTimeout(cardTimer);
      timers.forEach(clearTimeout);
    };
  }, [state.winner, router]);

  useEffect(() => {
    if (!state.winner) return;
    const t = setInterval(() => {
      setPayTime((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [state.winner]);

  function formatPayTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  if (!state.winner) return null;

  const saved = state.config.startPrice - state.winner.price;
  const savedPct = Math.round((saved / state.config.startPrice) * 100);

  function handlePlayAgain() {
    dispatch({ type: "RESET" });
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col pb-20 max-w-md mx-auto relative overflow-hidden">
      <ConfettiRain />

      {/* Hero section — dark */}
      <div className="px-4 pt-12 z-20 relative">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-medium text-white/65 hover:text-white/90 transition-colors mb-8"
        >
          ← 메인화면
        </Link>

        <div className="text-center mb-8 winner-pop">
          <div className="text-5xl mb-4">🎉</div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/65 font-medium mb-2">낙찰 성공</p>
          <h1 className="text-4xl font-black text-white mb-2">성공!</h1>
          <p className="text-white/60 text-sm">
            <span className="text-orange-400 font-bold">{state.winner.nickname}</span>님이 낙찰받았습니다!
          </p>
        </div>

        {/* Price — the hero */}
        {showCard && (
          <div className="winner-pop mb-6">
            <div className="text-center mb-2">
              <div className="flex items-center justify-center gap-3 mb-2">
                <ProductThumb alt={state.config.productName} size={32} rounded="rounded-sm" />
                <p className="text-white/75 text-xs font-medium">{state.config.productName}</p>
              </div>
              <p
                className="font-black tabular-nums font-mono text-orange-400 leading-none"
                style={{ fontSize: "4.5rem" }}
              >
                {formatKRW(state.winner.price)}
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <span className="text-white/55 text-xs line-through">{formatKRW(state.config.startPrice)}</span>
                <span className="bg-green-500 text-white text-xs font-bold px-2.5 py-0.5">
                  -{savedPct}% · {formatKRW(saved)} 절약
                </span>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-px mt-5 border border-white/18">
              {[
                { label: "절약 금액", value: formatKRW(saved), accent: true },
                { label: "낙찰 비율", value: `정가의 ${100 - savedPct}%`, accent: false },
              ].map(({ label, value, accent }) => (
                <div key={label} className="bg-white/5 px-4 py-3 text-center">
                  <p className="text-white/60 text-[10px] uppercase tracking-wider mb-1">{label}</p>
                  <p className={`text-sm font-bold ${accent ? "text-green-400" : "text-white/85"}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reactions */}
        <div className="mb-6">
          <p className="text-[10px] uppercase tracking-wider text-white/60 font-medium mb-3">다른 참여자 반응</p>
          <div className="space-y-2">
            {REACTIONS.slice(0, visibleReactions).map((r, i) => (
              <div key={i} className="reaction-in flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-sm bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center text-[10px] font-black text-white flex-shrink-0">
                  {r.nickname[0].toUpperCase()}
                </div>
                <div className="flex-1 bg-white/8 border border-white/18 px-3 py-2 text-sm">
                  <span className="text-white/65 text-[10px] mr-2">{r.nickname}</span>
                  <span className="text-white/90">{r.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment section */}
        <div className="border border-white/18 p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-white/60 font-medium">결제 제한 시간</p>
            <p className="font-black font-mono tabular-nums text-orange-400 text-2xl">{formatPayTime(payTime)}</p>
          </div>

          <Link
            href="/payment"
            className="block w-full py-4 font-bold text-base text-white text-center transition-opacity active:opacity-80 mb-2"
            style={{ background: "#f97316" }}
          >
            결제하기
          </Link>
          <p className="text-white/65 text-[11px] text-center">
            제한 시간 안에 결제를 완료해야 낙찰이 확정됩니다.
          </p>
        </div>

        <button
          onClick={handlePlayAgain}
          className="w-full py-3.5 font-bold text-sm border border-white/25 text-white/65 hover:text-white/85 transition-colors"
        >
          다시 시작하기
        </button>
      </div>
      <BottomNav />
    </main>
  );
}
