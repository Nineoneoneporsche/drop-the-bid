"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  useGame,
  formatKRW,
  MOCK_PARTICIPANT_COUNT,
  MOCK_SPECTATOR_COUNT,
} from "./context/GameContext";
import BottomNav from "./components/BottomNav";

export default function HomePage() {
  const { state } = useGame();
  const router = useRouter();

  const floor = state.config.floorPrice;
  const start = state.config.startPrice;
  const maxSavings = start - floor;
  const maxDiscountPct = start > 0 ? Math.round((maxSavings / start) * 100) : 0;

  return (
    <main className="h-screen bg-[#0a0a0a] flex flex-col max-w-md mx-auto overflow-hidden relative">

      {/* ── HERO — 65vh ── */}
      <div className="relative flex-shrink-0" style={{ height: "65vh" }}>

        {/* Character / stage image — kept bright */}
        <Image
          src="/dtb-hero.png"
          alt="Drop The Bid"
          fill
          priority
          style={{ objectFit: "cover", objectPosition: "center top" }}
        />

        {/* Top-to-bottom gradient — dark header + dark bottom, bright middle */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.0) 20%, rgba(0,0,0,0.0) 44%, rgba(0,0,0,0.70) 68%, rgba(0,0,0,0.97) 100%)",
          }}
        />
        {/* Radial vignette — darkens left/right edges, keeps centre bright */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 45%, transparent 30%, rgba(0,0,0,0.52) 100%)",
          }}
        />

        {/* ── Top bar ── */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-10">
          <Image
            src="/dtblogo.png"
            alt="DTB"
            width={48}
            height={24}
            style={{ width: 48, height: "auto" }}
            priority
          />
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 bg-red-600 text-white text-[9px] font-black px-2 py-1 uppercase tracking-[0.18em]">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              LIVE
            </span>
            <span
              className="text-white text-xs tabular-nums font-medium"
              style={{ textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
            >
              👥 {MOCK_PARTICIPANT_COUNT} · 👁 {MOCK_SPECTATOR_COUNT.toLocaleString()}
            </span>
          </div>
        </div>

        {/* ── Headline — center of hero ── */}
        <div
          className="absolute left-0 right-0 px-5"
          style={{ top: "28%" }}
        >
          {/* Brand badge row */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 leading-none"
              style={{
                background: "linear-gradient(90deg, #f97316, #fbbf24)",
                color: "#0a0a0a",
                borderRadius: "3px",
              }}
            >
              DROP THE BID
            </span>
            <span
              className="text-white/55 text-[10px] font-bold uppercase tracking-wider"
              style={{ textShadow: "0 1px 8px rgba(0,0,0,1)" }}
            >
              WHO WILL WIN?
            </span>
          </div>

          {/* Main headline */}
          <h1
            className="font-black leading-[1.08] mb-3"
            style={{
              fontSize: "2.1rem",
              letterSpacing: "-0.025em",
              textShadow: "0 2px 24px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,1)",
            }}
          >
            <span className="text-white">과연 누가,</span>
            <br />
            <span style={{ color: "#fbbf24" }}>가장 낮은 가격에</span>
            <br />
            <span className="text-white">가져갈까요?</span>
          </h1>

          {/* Subtext */}
          <p
            className="text-[13px] font-medium flex items-center gap-1.5"
            style={{
              color: "rgba(255,255,255,0.72)",
              textShadow: "0 1px 10px rgba(0,0,0,1)",
            }}
          >
            👥{" "}
            <span className="text-orange-400 font-bold tabular-nums">
              {MOCK_PARTICIPANT_COUNT}명
            </span>
            이 기다리고 있습니다.
          </p>
        </div>

        {/* ── Event status panel — bottom of hero ── */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
          <div
            className="px-4 py-3.5"
            style={{
              background: "rgba(6,6,6,0.84)",
              backdropFilter: "blur(28px)",
              borderRadius: "12px",
              border: "1px solid rgba(139,92,246,0.55)",
              boxShadow:
                "0 0 16px rgba(139,92,246,0.28), 0 0 48px rgba(139,92,246,0.12), 0 8px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(167,139,250,0.12)",
            }}
          >
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">

              {/* 시작 가격 */}
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/75 font-medium mb-0.5">
                  시작 가격
                </p>
                <p
                  className="text-white font-black tabular-nums font-mono leading-none"
                  style={{ fontSize: "1.55rem" }}
                >
                  {formatKRW(start)}
                </p>
              </div>

              {/* 하락 속도 */}
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/75 font-medium mb-0.5">
                  하락 속도
                </p>
                <p className="text-white font-bold tabular-nums font-mono text-[1.1rem] leading-none">
                  ₩{state.config.dropAmount.toLocaleString()}/초
                </p>
                <p className="text-white/55 text-[9px] mt-0.5">실시간 자동 하락</p>
              </div>

              {/* 전체 참가자 */}
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/75 font-medium mb-0.5">
                  전체 참가자
                </p>
                <p className="text-white font-bold text-[1.1rem] leading-none">
                  <span className="tabular-nums">{MOCK_PARTICIPANT_COUNT}</span>
                  <span className="text-sm ml-0.5">명</span>
                </p>
                <p className="text-white/55 text-[9px] mt-0.5">경쟁 중</p>
              </div>

              {/* 목표 최저가 */}
              <div>
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/75 font-medium mb-0.5">
                  목표 최저가
                </p>
                <p
                  className="font-black tabular-nums font-mono text-[1.1rem] leading-none"
                  style={{ color: "#f97316" }}
                >
                  {formatKRW(floor)}
                </p>
                <p className="text-orange-500/50 text-[9px] mt-0.5">최대 {maxDiscountPct}% 할인</p>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Below hero ── */}
      <div className="flex-1 flex flex-col px-4 pt-3.5 pb-24 min-h-0">

        {/* Event product card */}
        <div
          className="flex-shrink-0 px-4 py-3 mb-3"
          style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <p className="text-[9px] uppercase tracking-[0.22em] text-orange-400 font-bold mb-1.5">
            오늘의 경매
          </p>
          <p className="text-white font-bold text-[13.5px] leading-snug mb-1.5">
            {state.config.productName}
          </p>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-white/35 tabular-nums font-mono">
              정가 {formatKRW(start)}
            </span>
            <span className="text-white/18">·</span>
            <span className="text-orange-400/80 font-medium">
              최대{" "}
              <span className="font-bold text-orange-400">{formatKRW(maxSavings)}</span>{" "}
              절약 가능
            </span>
          </div>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col gap-2 mt-auto flex-shrink-0">
          <button
            onClick={() => router.push("/join")}
            className="w-full font-black text-base text-white tracking-wide transition-all active:scale-[0.98] active:opacity-90 flex flex-col items-center py-3.5 gap-0.5"
            style={{
              background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
              borderRadius: "10px",
              boxShadow: "0 4px 24px rgba(139,92,246,0.50), 0 0 0 1px rgba(167,139,250,0.25)",
            }}
          >
            <span>🔥 참가자로 입장</span>
            <span className="text-[10px] font-medium text-white/62 tracking-normal">
              경매에 참여하고 낙찰 기회를 잡으세요!
            </span>
          </button>
          <button
            onClick={() => router.push("/join")}
            className="w-full font-bold text-sm text-white/60 transition-all active:opacity-70 flex flex-col items-center py-3 gap-0.5"
            style={{
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <span>👁 관전하기</span>
            <span className="text-[10px] font-medium text-white/32 tracking-normal">
              실시간 경매를 구경해보세요!
            </span>
          </button>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
