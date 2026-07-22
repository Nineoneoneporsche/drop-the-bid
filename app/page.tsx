"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useGame, formatKRW } from "./context/GameContext";
import { ProductThumb } from "./components/ProductImage";
import BottomNav from "./components/BottomNav";

function fmtCountdown(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function HomePage() {
  const { state } = useGame();
  const router = useRouter();

  const { participantCount, spectatorCount, phase, strategyStartedAt } = state;
  const gameStartTime = state.config.gameStartTime;
  const auctionLive = phase === "game";
  const strategizing = phase === "strategy";
  const [countdown, setCountdown] = useState<number | null>(null);
  const [strategyLeft, setStrategyLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!gameStartTime) {
      setCountdown(null);
      return;
    }
    const target = new Date(gameStartTime).getTime();
    const update = () => setCountdown(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [gameStartTime]);

  useEffect(() => {
    if (!strategizing || !strategyStartedAt) { setStrategyLeft(null); return; }
    const dur = state.config.strategyDuration;
    const update = () => setStrategyLeft(Math.max(0, dur - Math.floor((Date.now() - strategyStartedAt) / 1000)));
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [strategizing, strategyStartedAt, state.config.strategyDuration]);

  const start = state.config.startPrice;

  return (
    <main className="bg-[#0a0a0a] flex flex-col max-w-md mx-auto">

      {/* ── HERO ── */}
      <div className="relative flex-shrink-0" style={{ height: "52vh" }}>

        <Image
          src="/newmainimage.png"
          alt="Drop The Bid"
          fill
          priority
          style={{ objectFit: "cover", objectPosition: "center top" }}
        />

        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.38) 18%, rgba(0,0,0,0.0) 36%, rgba(0,0,0,0.0) 62%, rgba(0,0,0,0.55) 82%, rgba(0,0,0,0.94) 100%)",
          }}
        />

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-10">
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 bg-red-600 text-white text-[9px] font-black px-2 py-1 uppercase tracking-[0.18em]">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              LIVE
            </span>
            <span
              className="text-white text-xs tabular-nums font-medium"
              style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
            >
              <span className="material-symbols-outlined" style={{fontSize:"12px",verticalAlign:"-1px"}}>group</span> {participantCount} · <span className="material-symbols-outlined" style={{fontSize:"12px",verticalAlign:"-1px"}}>visibility</span> {spectatorCount.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Headline */}
        <div className="absolute left-0 right-0 pl-10 pr-5" style={{ top: "27%" }}>
          <h1
            className="font-black leading-[1.08] mb-3"
            style={{
              fontSize: "2.1rem",
              letterSpacing: "-0.025em",
            }}
          >
            <span className="text-white">과연 누가,</span>
            <br />
            <span className="gold-shimmer-text">가장 낮은 가격에</span>
            <br />
            <span className="text-white">가져갈까요?</span>
          </h1>

          <p
            className="text-[15px] font-medium flex items-center gap-1.5"
            style={{
              color: "rgba(255,255,255,0.70)",
              textShadow: "0 2px 8px rgba(0,0,0,1), 0 4px 24px rgba(0,0,0,1)",
            }}
          >
            <span className="material-symbols-outlined" style={{fontSize:"15px",verticalAlign:"-3px"}}>group</span>{" "}
            <span className="text-orange-400 font-bold tabular-nums">
              {participantCount}명
            </span>
            이 기다리고 있습니다.
          </p>
        </div>
      </div>

      {/* ── BELOW HERO ── */}
      <div className="px-4 pt-3.5 pb-28">

        {/* Stats card */}
        <div
          className="mb-3"
          style={{
            background: "rgba(6,6,6,0.90)",
            borderRadius: "12px",
            border: "1px solid rgba(139,92,246,0.55)",
            boxShadow:
              "0 0 16px rgba(139,92,246,0.22), 0 0 40px rgba(139,92,246,0.10), inset 0 1px 0 rgba(167,139,250,0.10)",
          }}
        >
          <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.06]">

            {/* 시작 가격 */}
            <div className="px-4 py-3.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/60 font-medium mb-1">
                시작 가격
              </p>
              <p
                className="text-white font-black tabular-nums font-mono leading-none"
                style={{ fontSize: "1.65rem" }}
              >
                {formatKRW(start)}
              </p>
            </div>

            {/* 하락 속도 */}
            <div className="px-4 py-3.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/60 font-medium mb-1">
                하락 속도
              </p>
              <p className="text-white font-bold tabular-nums font-mono text-[1.35rem] leading-none">
                ₩{state.config.dropAmount.toLocaleString()}/초
              </p>
              <p className="text-white/45 text-[10px] mt-1">실시간 자동 하락</p>
            </div>

            {/* 참가자 수 */}
            <div className="px-4 py-3.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/60 font-medium mb-1">
                참가자 수
              </p>
              <p className="text-white font-bold text-[1.35rem] leading-none">
                <span className="tabular-nums">{participantCount}</span>
                <span className="text-sm ml-0.5">명</span>
              </p>
              <p className="text-white/45 text-[10px] mt-1">현재 경쟁 중</p>
            </div>

            {/* DTB까지 남은시간 */}
            <div className="px-4 py-3.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/60 font-medium mb-1">
                경매 상태
              </p>
              <p
                className="font-black tabular-nums font-mono leading-none"
                style={{
                  fontSize: auctionLive || strategizing ? "1.1rem" : countdown === null ? "1.1rem" : "1.65rem",
                  color: auctionLive ? "#ff2d2d" : strategizing ? "#e8ff00" : "#f5f3ff",
                  textShadow: auctionLive || strategizing
                    ? "none"
                    : "0 0 6px rgba(255,255,255,0.7), 0 0 14px #c084fc, 0 0 28px #a855f7",
                }}
              >
                {auctionLive
                  ? "경매 진행 중"
                  : strategizing
                  ? strategyLeft !== null ? `${strategyLeft}초 후 시작` : "곧 시작"
                  : countdown === null
                  ? "지금 참여가능"
                  : countdown === 0
                  ? "참여 마감"
                  : fmtCountdown(countdown)}
              </p>
              <p className="text-[10px] mt-1" style={{ color: auctionLive ? "#ff2d2d" : strategizing ? "#e8ff00" : "#a855f7" }}>
                {auctionLive
                  ? "관전만 가능합니다"
                  : strategizing
                  ? "전략 시간 진행 중"
                  : countdown === null
                  ? "바로 시작하세요!"
                  : countdown === 0
                  ? "관전만 가능합니다"
                  : "곧 시작됩니다"}
              </p>
            </div>

          </div>
        </div>

        {/* Product card */}
        <div
          className="flex items-center gap-4 px-4 py-3.5 mb-3"
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <ProductThumb alt={state.config.productName} size={64} rounded="rounded-sm" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-orange-400 font-bold mb-1">
              오늘의 경매
            </p>
            <p className="text-white font-bold text-[15px] leading-snug">
              {state.config.productName}
            </p>
            <p className="text-white text-[12px] tabular-nums font-mono mt-1">
              정가 {formatKRW(start)}
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col gap-2">
          {auctionLive ? (
            <button
              onClick={() => router.push("/join")}
              className="w-full font-black text-lg text-white tracking-wide transition-all active:scale-[0.98] active:opacity-90 flex flex-col items-center py-4 gap-1"
              style={{
                background: "linear-gradient(135deg, #374151 0%, #1f2937 100%)",
                borderRadius: "10px",
                border: "1px solid rgba(248,113,113,0.35)",
                boxShadow: "0 4px 24px rgba(239,68,68,0.15)",
              }}
            >
              <span className="flex items-center gap-2"><span className="material-symbols-outlined" style={{fontSize:"20px"}}>visibility</span>관전하기</span>
              <span className="text-[11px] font-medium text-white/50 tracking-normal">
                경매가 진행 중입니다 · 관전만 가능합니다
              </span>
            </button>
          ) : (
            <button
              onClick={() => router.push("/join")}
              className="w-full font-black text-lg text-white tracking-wide transition-all active:scale-[0.98] active:opacity-90 flex flex-col items-center py-4 gap-1"
              style={{
                background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
                borderRadius: "10px",
                boxShadow: "0 4px 24px rgba(139,92,246,0.50), 0 0 0 1px rgba(167,139,250,0.20)",
              }}
            >
              <span className="flex items-center gap-2"><span className="material-symbols-outlined" style={{fontSize:"20px"}}>local_fire_department</span>경매 참여하기</span>
              <span className="text-[11px] font-medium text-white/60 tracking-normal">
                경매에 참여하고 낙찰 기회를 잡으세요!
              </span>
            </button>
          )}
        </div>

      </div>

      <BottomNav />
    </main>
  );
}
