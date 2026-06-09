"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, formatKRW } from "../context/GameContext";

// Reaction messages that appear one-by-one after winner is shown
const BETRAYAL_REACTIONS = [
  { nickname: "kimchi_buyer", message: "왜 눌렀어요?! 우리 약속했잖아요 😤", delay: 900 },
  { nickname: "techie_seoul", message: "더 내려갈 수 있었는데... 아쉽다", delay: 1800 },
  { nickname: "bidder_pro", message: "배신자!!!! 🗡️", delay: 2600 },
  { nickname: "mac_lover99", message: "65만원까지 기다리면 됐었는데...", delay: 3400 },
  { nickname: "newbie_here", message: "아무도 못 믿겠네요 😔 다음엔 혼자 결정할게요", delay: 4300 },
];

const CONGRATS_REACTIONS = [
  { nickname: "kimchi_buyer", message: "와 대박... 그 타이밍 실화냐 👏", delay: 900 },
  { nickname: "techie_seoul", message: "완벽한 타이밍이었어요! 부럽다", delay: 1800 },
  { nickname: "mac_lover99", message: "역시 배신이 정답이었어 ㅋㅋㅋ", delay: 2600 },
];

// Fixed confetti config (avoids SSR issues with Math.random)
const CONFETTI = [
  { left: "5%", delay: "0s", dur: "1.6s", color: "#f97316", w: 8, h: 12, rot: 20 },
  { left: "12%", delay: "0.2s", dur: "1.9s", color: "#ef4444", w: 6, h: 10, rot: 70 },
  { left: "18%", delay: "0.05s", dur: "1.7s", color: "#eab308", w: 9, h: 7, rot: 140 },
  { left: "25%", delay: "0.35s", dur: "2.1s", color: "#ffffff", w: 7, h: 11, rot: 200 },
  { left: "33%", delay: "0.15s", dur: "1.5s", color: "#fb923c", w: 10, h: 8, rot: 45 },
  { left: "40%", delay: "0.45s", dur: "2.0s", color: "#f97316", w: 6, h: 13, rot: 90 },
  { left: "47%", delay: "0.08s", dur: "1.8s", color: "#ef4444", w: 8, h: 9, rot: 160 },
  { left: "53%", delay: "0.28s", dur: "1.65s", color: "#fbbf24", w: 11, h: 7, rot: 30 },
  { left: "60%", delay: "0.52s", dur: "2.2s", color: "#ffffff", w: 7, h: 10, rot: 110 },
  { left: "67%", delay: "0.12s", dur: "1.75s", color: "#f97316", w: 9, h: 8, rot: 250 },
  { left: "74%", delay: "0.38s", dur: "1.9s", color: "#ef4444", w: 6, h: 12, rot: 15 },
  { left: "80%", delay: "0.22s", dur: "2.0s", color: "#eab308", w: 8, h: 7, rot: 80 },
  { left: "87%", delay: "0.48s", dur: "1.6s", color: "#fb923c", w: 10, h: 9, rot: 195 },
  { left: "93%", delay: "0.06s", dur: "1.85s", color: "#ffffff", w: 7, h: 11, rot: 320 },
  { left: "8%", delay: "0.6s", dur: "2.1s", color: "#f97316", w: 9, h: 8, rot: 55 },
  { left: "22%", delay: "0.72s", dur: "1.7s", color: "#ef4444", w: 7, h: 10, rot: 135 },
  { left: "36%", delay: "0.58s", dur: "2.3s", color: "#fbbf24", w: 11, h: 7, rot: 280 },
  { left: "50%", delay: "0.68s", dur: "1.95s", color: "#fb923c", w: 8, h: 12, rot: 10 },
  { left: "64%", delay: "0.82s", dur: "1.6s", color: "#ffffff", w: 6, h: 9, rot: 175 },
  { left: "78%", delay: "0.75s", dur: "2.05s", color: "#f97316", w: 10, h: 7, rot: 60 },
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
  const [showStamp, setShowStamp] = useState(false);

  const isMe = state.winner?.nickname === state.currentUser?.nickname;

  useEffect(() => {
    if (!state.winner) { router.replace("/"); return; }

    // Stamp label delay
    const stampTimer = setTimeout(() => setShowStamp(true), 600);

    // Progressive reactions
    const reactions = isMe ? CONGRATS_REACTIONS : BETRAYAL_REACTIONS;
    const timers = reactions.map((r, i) =>
      setTimeout(() => setVisibleReactions(i + 1), r.delay)
    );

    return () => {
      clearTimeout(stampTimer);
      timers.forEach(clearTimeout);
    };
  }, [state.winner, isMe, router]);

  if (!state.winner) return null;

  const saved = state.config.startPrice - state.winner.price;
  const savedPct = Math.round((saved / state.config.startPrice) * 100);
  const reactions = isMe ? CONGRATS_REACTIONS : BETRAYAL_REACTIONS;

  function handlePlayAgain() {
    dispatch({ type: "RESET" });
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-[#080808] flex flex-col pb-12 max-w-md mx-auto relative overflow-hidden">
      {isMe && <ConfettiRain />}

      <div className="px-4 pt-12 z-20 relative">
        {/* Stamp label */}
        {showStamp && (
          <div className="flex justify-center mb-6 stamp-in">
            <div
              className="border-4 rounded-2xl px-6 py-2"
              style={{
                borderColor: isMe ? "#f97316" : "#ef4444",
                color: isMe ? "#f97316" : "#ef4444",
                transform: "rotate(-3deg)",
              }}
            >
              <p className="text-2xl font-black tracking-widest uppercase">
                {isMe ? "낙찰!" : "배신!"}
              </p>
            </div>
          </div>
        )}

        {/* Winner avatar + name */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black text-white mb-4 shadow-2xl"
            style={{
              background: isMe
                ? "linear-gradient(135deg,#f97316,#dc2626)"
                : "linear-gradient(135deg,#dc2626,#7f1d1d)",
              boxShadow: isMe
                ? "0 0 32px rgba(249,115,22,0.6)"
                : "0 0 32px rgba(220,38,38,0.4)",
            }}
          >
            {state.winner.nickname[0].toUpperCase()}
          </div>

          <h1
            className={`text-3xl font-black text-white mb-1 ${isMe ? "win-glow" : ""}`}
          >
            {state.winner.nickname}
          </h1>
          <p className="text-gray-500 text-sm">
            {isMe ? "낙찰자 · 당신이 먼저 손들었습니다" : "누군가 먼저 배신했습니다"}
          </p>
        </div>

        {/* Price card */}
        <div
          className="rounded-2xl p-5 mb-4 border"
          style={{
            background: "rgba(15,5,0,0.8)",
            borderColor: isMe ? "rgba(249,115,22,0.4)" : "rgba(220,38,38,0.3)",
          }}
        >
          <p className="text-gray-500 text-sm text-center mb-1">
            {state.config.productName}
          </p>
          <p
            className="text-5xl font-mono font-black text-center tabular-nums mb-3"
            style={{
              color: isMe ? "#f97316" : "#ef4444",
            }}
          >
            {formatKRW(state.winner.price)}
          </p>

          <div className="flex items-center justify-center gap-2">
            <span className="text-gray-700 text-xs">
              시작가 {formatKRW(state.config.startPrice)}
            </span>
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-full border"
              style={{
                background: "rgba(34,197,94,0.12)",
                borderColor: "rgba(34,197,94,0.3)",
                color: "#4ade80",
              }}
            >
              ₩{new Intl.NumberFormat("ko-KR").format(saved)} 절약 ({savedPct}% ↓)
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[
            { label: "절약 금액", value: formatKRW(saved), color: "#4ade80" },
            { label: "낙찰 비율", value: `시작가의 ${100 - savedPct}%`, color: "#fb923c" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-xl p-3 text-center border border-gray-800"
              style={{ background: "#0f0f11" }}
            >
              <p className="text-gray-600 text-xs mb-1">{label}</p>
              <p className="text-sm font-bold" style={{ color }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Reactions from other players */}
        <div className="mb-6">
          <p className="text-gray-600 text-xs uppercase tracking-widest mb-3 px-1">
            다른 참여자들의 반응
          </p>
          <div className="space-y-2.5">
            {reactions.slice(0, visibleReactions).map((r, i) => (
              <div
                key={i}
                className="flex items-start gap-3 reaction-in"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{
                    background: "linear-gradient(135deg,#7f1d1d,#991b1b)",
                  }}
                >
                  {r.nickname[0].toUpperCase()}
                </div>
                <div
                  className="flex-1 rounded-2xl rounded-tl-sm px-3 py-2 text-sm border"
                  style={{
                    background: "rgba(30,5,5,0.6)",
                    borderColor: "rgba(127,29,29,0.4)",
                    color: "#fca5a5",
                  }}
                >
                  <span className="text-gray-600 text-xs mr-2">{r.nickname}</span>
                  {r.message}
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handlePlayAgain}
          className="w-full font-bold py-4 rounded-xl text-base text-white transition-all active:scale-[0.98]"
          style={{
            background: "linear-gradient(135deg,#ea580c,#dc2626)",
            boxShadow: "0 0 20px rgba(220,38,38,0.3)",
          }}
        >
          다시 시작하기
        </button>

        {!isMe && (
          <p className="text-gray-700 text-sm mt-4 text-center">
            다음엔 더 좋은 타이밍을 노려보세요
          </p>
        )}
      </div>
    </main>
  );
}
