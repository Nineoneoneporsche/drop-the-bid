"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  useGame,
  formatKRW,
  MOCK_PARTICIPANT_COUNT,
  MOCK_SPECTATOR_COUNT,
} from "./context/GameContext";
import { ProductImageFill, ProductThumb } from "./components/ProductImage";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export default function HomePage() {
  const { state } = useGame();
  const router = useRouter();
  const [countdown, setCountdown] = useState<{
    h: number;
    m: number;
    s: number;
  } | null>(null);

  useEffect(() => {
    if (!state.config.gameStartTime) {
      setCountdown(null);
      return;
    }
    const update = () => {
      const diff =
        new Date(state.config.gameStartTime!).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown({ h: 0, m: 0, s: 0 });
        return;
      }
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
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-16">
      <div className="w-full max-w-md px-4 pt-8">

        {/* Brand header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Image
              src="/rabbit-logo.png"
              alt="Rabbit"
              width={108}
              height={108}
              style={{ width: 108, height: "auto" }}
              priority
            />
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none">
                Rabbit
              </h1>
              <p className="text-gray-400 text-xs mt-1 leading-snug">
                기다릴수록 가격은 내려갑니다
              </p>
            </div>
          </div>
          <a
            href="/admin"
            className="text-xs text-gray-400 border border-gray-200 rounded-xl px-3 py-1.5 bg-white hover:border-orange-300 hover:text-orange-500 transition-colors shadow-sm flex-shrink-0"
          >
            Admin ⚙
          </a>
        </div>

        {/* LIVE badge row */}
        <div className="flex items-center gap-2 mb-4">
          <span className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            LIVE
          </span>
          <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
            오늘의 상품
          </span>
          <span className="ml-auto text-gray-400 text-xs">
            👁 {MOCK_SPECTATOR_COUNT.toLocaleString()}명 관전 중
          </span>
        </div>

        {/* Product card */}
        <div className="bg-white rounded-3xl shadow-sm border border-orange-50 overflow-hidden mb-4">
          {/* Product image */}
          <div className="relative w-full" style={{ height: 260 }}>
            <ProductImageFill alt={state.config.productName} priority />
            {/* Participant badge overlay */}
            <div className="absolute bottom-3 left-3 float-badge">
              <span className="bg-orange-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                ✋ {MOCK_PARTICIPANT_COUNT}명 대기 중
              </span>
            </div>
          </div>

          {/* Product info */}
          <div className="px-5 pt-4 pb-5">
            <h2 className="text-gray-900 font-bold text-base leading-snug mb-1">
              {state.config.productName}
            </h2>
            <p className="text-gray-400 text-sm mb-4">
              {state.config.description}
            </p>

            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-gray-400 text-xs">시작가</span>
              <span className="text-3xl font-black text-orange-500 font-mono tabular-nums">
                {formatKRW(state.config.startPrice)}
              </span>
            </div>
            <p className="text-gray-400 text-xs mb-5">
              ↓ {formatKRW(state.config.dropAmount)}/초 하락
            </p>

            {/* Stat chips */}
            <div className="flex gap-2 mb-5 flex-wrap">
              {[
                { icon: "✋", label: `${MOCK_PARTICIPANT_COUNT}명 참여 대기` },
                { icon: "👁", label: `${MOCK_SPECTATOR_COUNT.toLocaleString()}명 관전` },
              ].map(({ icon, label }) => (
                <span
                  key={label}
                  className="flex items-center gap-1.5 bg-orange-50 text-orange-600 text-xs font-medium px-3 py-1.5 rounded-full border border-orange-100"
                >
                  {icon} {label}
                </span>
              ))}
            </div>

            {/* Countdown or live now */}
            {countdown ? (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 mb-5 text-center">
                <p className="text-orange-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  경매 시작까지
                </p>
                <div className="flex justify-center gap-5">
                  {[
                    ["시", countdown.h],
                    ["분", countdown.m],
                    ["초", countdown.s],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="text-center">
                      <div className="text-4xl font-black text-orange-500 tabular-nums font-mono">
                        {pad(Number(val))}
                      </div>
                      <div className="text-orange-300 text-xs mt-1">{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-3 mb-5 flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-600 text-sm font-semibold">
                  지금 참여 가능
                </span>
              </div>
            )}

            <button
              onClick={() => router.push("/join")}
              className="w-full font-bold py-4 rounded-2xl text-base text-white transition-all active:scale-[0.98] shadow-md"
              style={{
                background: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)",
                boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
              }}
            >
              지금 참여하기 →
            </button>
          </div>
        </div>

        {/* Hook copy */}
        <div className="bg-white rounded-3xl shadow-sm border border-amber-100 p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">🤔</span>
            <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider">
              오늘의 챌린지
            </span>
          </div>
          <p className="text-gray-900 font-bold text-lg leading-snug mb-1">
            217명이 대기하고 있습니다!
          </p>
          <p className="text-gray-500 text-sm leading-relaxed">
            과연 누가, 얼마나 낮은 가격에 낙찰을 받을 수 있을까요?
          </p>
        </div>

        {/* Previous result */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 mb-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-medium mb-4">
            직전 게임 결과
          </p>
          <div className="flex items-center gap-3 mb-4">
            <ProductThumb alt="NUVY 유모차 자전거" size={40} rounded="rounded-xl" />
            <div>
              <p className="text-gray-900 font-semibold text-sm">
                NUVY 누비 유모차 자전거
              </p>
              <p className="text-gray-400 text-xs">정가 ₩250,000</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "낙찰가", value: "₩187,000", accent: true },
              { label: "참여자", value: "231명" },
              { label: "낙찰자", value: "Samdori" },
            ].map(({ label, value, accent }) => (
              <div
                key={label}
                className="bg-gray-50 rounded-xl p-2.5 text-center"
              >
                <p className="text-gray-400 text-[10px] mb-1">{label}</p>
                <p
                  className={`text-sm font-bold ${
                    accent ? "text-orange-500" : "text-gray-800"
                  }`}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-medium mb-4">
            진행 방식
          </p>
          <div className="space-y-4">
            {[
              {
                emoji: "💬",
                title: "전략 회의 시간 1분",
                desc: "참여자들과 채팅으로 이야기해요",
              },
              {
                emoji: "📉",
                title: "가격 하락 시작",
                desc: `초당 ${formatKRW(state.config.dropAmount)} 씩 내려가요`,
              },
              {
                emoji: "✋",
                title: "손들기",
                desc: "원하는 가격에 도달하면 손을 들어요",
              },
              {
                emoji: "🏆",
                title: "낙찰 확정",
                desc: "가장 먼저 손든 참여자가 낙찰!",
              },
            ].map(({ emoji, title, desc }) => (
              <div key={title} className="flex items-start gap-3">
                <span className="text-xl leading-none mt-0.5">{emoji}</span>
                <div>
                  <p className="text-gray-800 text-sm font-semibold">{title}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
