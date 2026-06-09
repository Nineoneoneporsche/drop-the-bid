"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, formatKRW, MOCK_PARTICIPANT_COUNT } from "./context/GameContext";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function MacMiniImage() {
  return (
    <div className="relative bg-[#0d0d0f] flex items-center justify-center py-12 overflow-hidden">
      {/* Ambient orange glow */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(249,115,22,0.18) 0%, transparent 70%)",
        }}
      />
      {/* Stage light from above */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-24 opacity-20"
        style={{
          background:
            "radial-gradient(ellipse 100% 100% at 50% 0%, rgba(255,200,100,0.5) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        {/* Mac mini body */}
        <div className="relative">
          <div
            className="w-40 h-11 rounded-[14px] shadow-[0_12px_40px_rgba(0,0,0,0.9)] relative overflow-hidden"
            style={{
              background:
                "linear-gradient(180deg,#dcdcdc 0%,#c8c8c8 45%,#b0b0b0 100%)",
            }}
          >
            {/* Top highlight edge */}
            <div className="absolute top-0 left-2 right-2 h-[2px] bg-white/60 rounded-full" />
            {/* Vent slots left */}
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex gap-[3px]">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="w-[2px] h-6 rounded-full"
                  style={{ background: "rgba(0,0,0,0.22)" }}
                />
              ))}
            </div>
            {/* Center subtle logo area */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-5 h-5 rounded-full opacity-15"
                style={{ background: "rgba(0,0,0,0.5)" }}
              />
            </div>
            {/* USB-C ports right */}
            <div className="absolute right-10 top-1/2 -translate-y-1/2 flex gap-1.5">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-sm"
                  style={{ background: "rgba(0,0,0,0.25)" }}
                />
              ))}
            </div>
            {/* Power LED */}
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
              style={{
                background: "#4ade80",
                boxShadow: "0 0 6px #4ade80, 0 0 12px rgba(74,222,128,0.6)",
              }}
            />
          </div>
          {/* Drop shadow on surface */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-36 h-3 rounded-full blur-lg opacity-70 bg-black" />
        </div>

        <p className="text-gray-500 text-[10px] tracking-[0.3em] uppercase">Mac mini M4</p>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { state } = useGame();
  const router = useRouter();
  const [countdown, setCountdown] = useState<{ h: number; m: number; s: number } | null>(null);

  useEffect(() => {
    if (!state.config.gameStartTime) { setCountdown(null); return; }
    const update = () => {
      const diff = new Date(state.config.gameStartTime!).getTime() - Date.now();
      if (diff <= 0) { setCountdown({ h: 0, m: 0, s: 0 }); return; }
      setCountdown({
        h: Math.floor(diff / 3_600_000),
        m: Math.floor((diff % 3_600_000) / 60_000),
        s: Math.floor((diff % 60_000) / 1_000),
      });
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [state.config.gameStartTime]);

  return (
    <main className="min-h-screen bg-[#080808] flex flex-col items-center pb-16">
      <div className="w-full max-w-md px-4 pt-10">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Drop The Bid</h1>
            <p className="text-gray-600 text-xs mt-0.5">가격이 떨어질 때 손을 들어라</p>
          </div>
          <a
            href="/admin"
            className="text-xs text-gray-600 border border-gray-800 rounded-lg px-3 py-1.5 hover:border-gray-600 hover:text-gray-400 transition-colors"
          >
            Admin ⚙
          </a>
        </div>

        {/* Product card */}
        <div className="rounded-2xl overflow-hidden border border-gray-800 mb-5"
          style={{ background: "#111113" }}>
          <MacMiniImage />

          <div className="p-5">
            {/* Participant counter — prominent */}
            <div className="flex items-center gap-2 mb-4">
              <span
                className="flex items-center gap-1.5 bg-red-950/60 border border-red-900/60 text-red-400 text-xs font-semibold px-3 py-1.5 rounded-full"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                {MOCK_PARTICIPANT_COUNT}명 대기 중
              </span>
            </div>

            <h2 className="text-lg font-bold text-white">{state.config.productName}</h2>
            <p className="text-gray-500 text-sm mb-4">Apple M4 칩 · 16GB 메모리 · 256GB SSD</p>

            <div className="flex items-baseline gap-2 mb-5">
              <span className="text-gray-500 text-xs uppercase tracking-wide">시작가</span>
              <span className="text-2xl font-bold text-orange-400 font-mono">
                {formatKRW(state.config.startPrice)}
              </span>
              <span className="text-gray-600 text-xs ml-auto">
                ↓ {formatKRW(state.config.dropAmount)}/초
              </span>
            </div>

            {/* Countdown or join-now */}
            {countdown ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5 text-center">
                <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">경매 시작까지</p>
                <div className="flex justify-center gap-5">
                  {[["시", countdown.h], ["분", countdown.m], ["초", countdown.s]].map(
                    ([label, val]) => (
                      <div key={String(label)} className="text-center">
                        <div className="text-4xl font-mono font-bold text-white tabular-nums">
                          {pad(Number(val))}
                        </div>
                        <div className="text-gray-700 text-xs mt-1">{label}</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-green-950/40 border border-green-900/50 rounded-xl p-3 mb-5 flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400 text-sm font-medium">지금 참여 가능</span>
              </div>
            )}

            <button
              onClick={() => router.push("/join")}
              className="w-full bg-orange-500 hover:bg-orange-400 active:bg-orange-600 active:scale-[0.98] text-white font-bold py-4 rounded-xl text-base transition-all duration-150"
              style={{ boxShadow: "0 0 24px rgba(249,115,22,0.3)" }}
            >
              경매 참여하기 →
            </button>
          </div>
        </div>

        {/* Psychological hook */}
        <div
          className="rounded-2xl p-5 mb-5 border border-orange-900/40"
          style={{
            background:
              "linear-gradient(135deg, rgba(120,20,0,0.35) 0%, rgba(20,5,0,0.8) 100%)",
          }}
        >
          <p className="text-orange-500 text-xs font-semibold uppercase tracking-widest mb-3">
            🎭 이번 라운드의 질문
          </p>
          <p className="text-white text-xl font-bold leading-snug mb-2">
            {MOCK_PARTICIPANT_COUNT}명 모두가
            <br />
            <span className="text-orange-400">700,000원까지</span> 버틸 수 있을까요?
          </p>
          <p className="text-gray-400 text-base">
            아니면 누군가 먼저{" "}
            <span className="text-red-400 font-semibold">배신</span>할까요?
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-600">
            <span>⚔️</span>
            <span>신뢰 vs 배신 — 집단 심리 역경매</span>
          </div>
        </div>

        {/* Previous game result */}
        <div
          className="rounded-2xl p-5 border border-gray-800"
          style={{ background: "#111113" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-gray-500 text-xs uppercase tracking-widest">이전 게임 결과</span>
            <span className="text-gray-700 text-xs ml-auto">3시간 전</span>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center text-lg flex-shrink-0">
              💻
            </div>
            <div>
              <p className="text-white font-semibold text-sm">MacBook Air M4</p>
              <p className="text-gray-500 text-xs">정가 ₩1,500,000</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { label: "낙찰가", value: "₩1,120,000", highlight: true },
              { label: "참여자", value: "231명" },
              { label: "낙찰자", value: "Samdori" },
            ].map(({ label, value, highlight }) => (
              <div key={label} className="bg-gray-900/80 rounded-xl p-2.5 text-center">
                <p className="text-gray-600 text-[10px] mb-1">{label}</p>
                <p
                  className={`text-sm font-bold tabular-nums ${
                    highlight ? "text-orange-400" : "text-white"
                  }`}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 bg-green-950/40 border border-green-900/40 rounded-lg px-3 py-2">
            <span className="text-green-400 text-xs">✓</span>
            <span className="text-green-400 text-xs font-medium">
              정가 대비 ₩380,000 절약 — 25% 할인
            </span>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-5 rounded-2xl p-5 border border-gray-800/60" style={{ background: "#0e0e10" }}>
          <p className="text-gray-600 text-xs uppercase tracking-widest mb-4">진행 방식</p>
          <div className="space-y-4">
            {[
              { emoji: "🤝", title: "협상 시간 3분", desc: "참여자들과 전략을 협의해요. 누가 먼저 손들 것인지..." },
              { emoji: "📉", title: "가격 하락 시작", desc: `초당 ${formatKRW(state.config.dropAmount)} 떨어져요` },
              { emoji: "✋", title: "배신 or 신뢰", desc: "원하는 가격에 손들기 — 하지만 남보다 높은 가격에?" },
              { emoji: "🏆", title: "낙찰 확정", desc: "가장 먼저 손을 든 참여자가 그 가격에 낙찰!" },
            ].map(({ emoji, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">{emoji}</span>
                <div>
                  <p className="text-white text-sm font-medium">{title}</p>
                  <p className="text-gray-600 text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
