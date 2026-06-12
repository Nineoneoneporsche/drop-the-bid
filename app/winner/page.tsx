"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, formatKRW } from "../context/GameContext";
import { ProductThumb } from "../components/ProductImage";

const REACTIONS = [
  { nickname: "shopping_star", message: "와 대박! 정말 좋은 가격이에요! 🎉", delay: 900 },
  { nickname: "minivelo_fan",  message: "타이밍이 완벽하네요! 부럽다 ㅠ", delay: 1800 },
  { nickname: "kid_gear_mom",  message: "저 제품 좋던데 잘 쓰세요! 👏", delay: 2700 },
  { nickname: "smart_buyer",   message: "저도 저 가격에 사고 싶었는데... 다음엔 제가! 😊", delay: 3600 },
  { nickname: "minivelo_fan",  message: "축하드려요!! 완전 이득이네요 🎊", delay: 4400 },
];

// Cheerful confetti — bright varied palette
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

  const isMe = state.winner?.nickname === state.currentUser?.nickname;

  useEffect(() => {
    if (!state.winner) {
      router.replace("/");
      return;
    }

    const cardTimer = setTimeout(() => setShowCard(true), 400);
    const timers = REACTIONS.map((r, i) =>
      setTimeout(() => setVisibleReactions(i + 1), r.delay)
    );

    return () => {
      clearTimeout(cardTimer);
      timers.forEach(clearTimeout);
    };
  }, [state.winner, router]);

  if (!state.winner) return null;

  const saved = state.config.startPrice - state.winner.price;
  const savedPct = Math.round((saved / state.config.startPrice) * 100);

  function handlePlayAgain() {
    dispatch({ type: "RESET" });
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col pb-12 max-w-md mx-auto relative overflow-hidden">
      <ConfettiRain />

      <div className="px-4 pt-12 z-20 relative">
        {/* Celebration title */}
        <div className="text-center mb-6 winner-pop">
          <div className="text-6xl mb-3">🎉</div>
          <h1 className="text-3xl font-black text-gray-900 mb-1">성공!</h1>
          <p className="text-gray-500 text-base">
            축하합니다!{" "}
            <span className="text-orange-500 font-bold">
              {state.winner.nickname}
            </span>
            님이 낙찰받았습니다!
          </p>
        </div>

        {/* Winner card */}
        {showCard && (
          <div className="bg-white rounded-3xl shadow-md border border-orange-100 p-5 mb-4 winner-pop">
            {/* Avatar */}
            <div className="flex flex-col items-center mb-5">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black text-white mb-3 shadow-lg"
                style={{
                  background:
                    "linear-gradient(135deg,#fb923c 0%,#f97316 100%)",
                  boxShadow: "0 4px 20px rgba(249,115,22,0.4)",
                }}
              >
                {state.winner.nickname[0].toUpperCase()}
              </div>
              <p className="text-xl font-black text-gray-900">
                {state.winner.nickname}
              </p>
              <p className="text-gray-400 text-sm">낙찰 성공!</p>
            </div>

            {/* Price */}
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-center mb-4">
              <div className="flex items-center justify-center mb-2">
                <ProductThumb alt={state.config.productName} size={72} rounded="rounded-2xl" />
              </div>
              <p className="text-gray-400 text-sm mb-1">
                {state.config.productName}
              </p>
              <p
                className="font-black text-orange-500 font-mono tabular-nums"
                style={{ fontSize: "2.8rem", lineHeight: 1.1 }}
              >
                {formatKRW(state.winner.price)}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                <span className="text-gray-400 text-xs">
                  정가 {formatKRW(state.config.startPrice)}
                </span>
                <span className="bg-green-100 border border-green-200 text-green-600 text-xs font-bold px-2.5 py-1 rounded-full">
                  {formatKRW(saved)} 절약 ({savedPct}% ↓)
                </span>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "절약 금액", value: formatKRW(saved), color: "#16a34a" },
                { label: "낙찰 비율", value: `정가의 ${100 - savedPct}%`, color: "#f97316" },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-gray-50 rounded-2xl p-3 text-center border border-gray-100"
                >
                  <p className="text-gray-400 text-xs mb-1">{label}</p>
                  <p className="text-sm font-bold" style={{ color }}>
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reactions */}
        <div className="mb-6">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-medium mb-3 px-1">
            다른 참여자들의 반응
          </p>
          <div className="space-y-2.5">
            {REACTIONS.slice(0, visibleReactions).map((r, i) => (
              <div key={i} className="flex items-start gap-3 reaction-in">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-300 to-amber-400 flex items-center justify-center text-xs font-black text-white flex-shrink-0 shadow-sm">
                  {r.nickname[0].toUpperCase()}
                </div>
                <div className="flex-1 bg-white rounded-2xl rounded-tl-sm px-3 py-2.5 text-sm border border-gray-100 shadow-sm">
                  <span className="text-gray-400 text-xs mr-2">
                    {r.nickname}
                  </span>
                  <span className="text-gray-800">{r.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handlePlayAgain}
          className="w-full font-bold py-4 rounded-2xl text-base text-white transition-all active:scale-[0.98] shadow-md"
          style={{
            background: "linear-gradient(135deg,#fb923c 0%,#f97316 100%)",
            boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
          }}
        >
          다시 시작하기
        </button>
      </div>
    </main>
  );
}
