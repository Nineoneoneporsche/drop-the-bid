"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

const PRODUCT_NAME = "NUVY 누비 유모차 자전거 타보-고급형 미니스트라이크";
const START_PRICE = 250_000;
const FLOOR_PRICE = 150_000;

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

const SEQUENCE = [
  {
    price: 250_000,
    chats: [
      { nick: "shopping_star", msg: "오늘 어디까지 갈까요?" },
      { nick: "minivelo_fan",  msg: "다들 버티는 분위기네요" },
    ],
  },
  {
    price: 220_000,
    chats: [
      { nick: "구경꾼99",  msg: "와 벌써 22만원" },
      { nick: "라이브팬", msg: "아직 아무도 안 누르네?" },
    ],
  },
  {
    price: 180_000,
    chats: [
      { nick: "실속파",   msg: "이걸 버틴다고??" },
      { nick: "쇼핑고수", msg: "슬슬 누를 사람 나올 듯" },
    ],
  },
  {
    price: 150_000,
    chats: [
      { nick: "라이브킹", msg: "레전드네 ㄷㄷ" },
      { nick: "채팅구경", msg: "단합력 무엇 ㅋㅋ" },
    ],
  },
];

type ChatMsg = { nick: string; msg: string; id: number };

type Evt =
  | { at: number; action: "price"; stepIdx: number }
  | { at: number; action: "chat"; stepIdx: number; chatIdx: number }
  | { at: number; action: "press" }
  | { at: number; action: "success" }
  | { at: number; action: "hint" };

const EVENTS: Evt[] = [
  { at: 400,   action: "price",   stepIdx: 0 },
  { at: 900,   action: "chat",    stepIdx: 0, chatIdx: 0 },
  { at: 1700,  action: "chat",    stepIdx: 0, chatIdx: 1 },
  { at: 2900,  action: "price",   stepIdx: 1 },
  { at: 3400,  action: "chat",    stepIdx: 1, chatIdx: 0 },
  { at: 4200,  action: "chat",    stepIdx: 1, chatIdx: 1 },
  { at: 5300,  action: "price",   stepIdx: 2 },
  { at: 5800,  action: "chat",    stepIdx: 2, chatIdx: 0 },
  { at: 6600,  action: "chat",    stepIdx: 2, chatIdx: 1 },
  { at: 7700,  action: "price",   stepIdx: 3 },
  { at: 8200,  action: "chat",    stepIdx: 3, chatIdx: 0 },
  { at: 9000,  action: "chat",    stepIdx: 3, chatIdx: 1 },
  { at: 9800,  action: "press" },
  { at: 10400, action: "success" },
  { at: 11900, action: "hint" },
];

const LOOP_MS = 14500;

const CARDS = [
  {
    num: "1",
    title: "가격은 계속 내려갑니다",
    desc: "시간이 지날수록 상품 가격이 내려갑니다.",
  },
  {
    num: "2",
    title: "원하는 순간에 누르세요",
    desc: "더 기다릴수록 싸지지만, 누군가 먼저 낙찰받을 수 있습니다.",
  },
  {
    num: "3",
    title: "가장 빠른 1명이 승리",
    desc: "서버 기준으로 가장 먼저 누른 사람이 낙찰됩니다.",
  },
];

export default function GuidePage() {
  const [stepIdx, setStepIdx] = useState<number>(0);
  const [chats, setChats] = useState<ChatMsg[]>([]);
  const [buttonPressed, setButtonPressed] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgIdRef = useRef(0);

  useEffect(() => {
    function schedule() {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];

      setStepIdx(0);
      setChats([]);
      setButtonPressed(false);
      setShowSuccess(false);
      setShowHint(false);

      for (const evt of EVENTS) {
        const t = setTimeout(() => {
          if (evt.action === "price") {
            setStepIdx(evt.stepIdx);
          } else if (evt.action === "chat") {
            const msg = SEQUENCE[evt.stepIdx].chats[evt.chatIdx];
            setChats((c) => [...c, { ...msg, id: ++msgIdRef.current }]);
          } else if (evt.action === "press") {
            setButtonPressed(true);
          } else if (evt.action === "success") {
            setShowSuccess(true);
          } else if (evt.action === "hint") {
            setShowHint(true);
          }
        }, evt.at);
        timersRef.current.push(t);
      }

      timersRef.current.push(setTimeout(schedule, LOOP_MS));
    }

    schedule();
    return () => { timersRef.current.forEach(clearTimeout); };
  }, []);

  const currentPrice = SEQUENCE[stepIdx].price;
  const barPct = ((START_PRICE - currentPrice) / (START_PRICE - FLOOR_PRICE)) * 100;
  const isLow = currentPrice <= 180_000;
  const visibleChats = chats.slice(-3);

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-4">
          <HomeButton />
        </div>

        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-2xl font-black text-gray-900 mb-1">게임방법</h1>
          <p className="text-orange-500 font-semibold text-sm leading-snug">
            가격이 내려가는 순간, 먼저 누른 사람이 임자!
          </p>
          <p className="text-gray-400 text-sm mt-1">실제 게임은 이렇게 진행됩니다.</p>
        </div>

        {/* ── Animated preview card ── */}
        <div className="bg-white rounded-3xl shadow-md border border-orange-100 overflow-hidden mb-2 relative">

          {/* Game header */}
          <div className="bg-white px-4 pt-4 pb-3 border-b border-gray-100">
            {/* Status row */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className="flex items-center gap-1 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse inline-block" />
                LIVE
              </span>
              <span className="text-gray-500 text-xs">✋ <b>186명</b></span>
              <span className="text-gray-500 text-xs">👁 <b>3,412명</b></span>
            </div>

            {/* Product row */}
            <div className="flex items-center gap-2 mb-2">
              <div className="relative w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-orange-50">
                <Image
                  src="/product.png"
                  alt="product"
                  fill
                  sizes="32px"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <p className="text-gray-400 text-xs truncate flex-1">{PRODUCT_NAME}</p>
            </div>

            {/* Price — transitions smoothly on change */}
            <div
              className={`font-black tabular-nums font-mono transition-colors duration-700 ${
                isLow ? "text-red-500" : "text-orange-500"
              }`}
              style={{ fontSize: "2.4rem", lineHeight: 1.1 }}
            >
              {fmt(currentPrice)}
            </div>
            <p className="text-gray-400 text-xs mt-0.5 mb-2">↓ ₩1,000/초 하락</p>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>{fmt(START_PRICE)}</span>
                <span className="text-orange-500 font-semibold">목표가 {fmt(FLOOR_PRICE)}</span>
              </div>
              <div className="w-full bg-orange-50 rounded-full h-2.5 overflow-hidden border border-orange-100">
                <div
                  className="h-2.5 rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, Math.max(0, barPct))}%`,
                    background: isLow
                      ? "linear-gradient(90deg,#f97316,#ef4444)"
                      : "linear-gradient(90deg,#fb923c,#f59e0b)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Chat area — fixed height so card doesn't jump */}
          <div className="px-4 py-3 h-[88px] flex flex-col justify-end gap-1.5 overflow-hidden">
            {visibleChats.map((c) => (
              <div key={c.id} className="flex items-start gap-1.5 chat-in">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center text-[9px] font-black text-white flex-shrink-0">
                  {c.nick[0].toUpperCase()}
                </div>
                <div className="bg-gray-50 rounded-2xl rounded-tl-sm px-2.5 py-1.5 text-xs text-gray-700 border border-gray-100 min-w-0">
                  <span className="text-gray-400 text-[10px] mr-1">{c.nick}</span>
                  {c.msg}
                </div>
              </div>
            ))}
          </div>

          {/* CTA button */}
          <div className="px-4 pb-4">
            <div
              className="w-full py-4 rounded-2xl text-white font-bold text-base text-center select-none transition-all duration-300"
              style={{
                background: buttonPressed
                  ? "linear-gradient(135deg,#16a34a,#22c55e)"
                  : "linear-gradient(135deg,#fb923c,#f97316)",
                boxShadow: buttonPressed
                  ? "0 4px 24px rgba(34,197,94,0.45)"
                  : "0 4px 24px rgba(249,115,22,0.4)",
                transform: buttonPressed ? "scale(0.97)" : "scale(1)",
              }}
            >
              {buttonPressed ? "✅ 낙찰 완료!" : "🔥 낙찰받기"}
            </div>
          </div>

          {/* Success overlay */}
          {showSuccess && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/96 z-10 px-6 success-pop">
              <div className="text-5xl mb-3">🎉</div>
              <h2 className="text-2xl font-black text-gray-900 mb-1.5">성공!</h2>
              <p className="text-gray-600 text-sm text-center mb-4">
                <span className="text-orange-500 font-bold">샘플유저</span>님이{" "}
                <span className="font-bold text-gray-900">{fmt(FLOOR_PRICE)}</span>에 낙찰받았습니다!
              </p>
              {showHint && (
                <p className="text-gray-400 text-xs text-center leading-relaxed px-4">
                  실제 게임에서는 가장 먼저 누른<br />1명만 낙찰받을 수 있습니다.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-gray-400 text-[11px] text-center mb-6">
          ↺ 시뮬레이션이 자동으로 반복됩니다
        </p>

        {/* Explanation cards */}
        <div className="space-y-3 mb-6">
          {CARDS.map(({ num, title, desc }) => (
            <div
              key={num}
              className="bg-white rounded-2xl px-5 py-4 border border-gray-100 shadow-sm flex gap-4 items-start"
            >
              <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-500 font-black text-sm flex items-center justify-center flex-shrink-0">
                {num}
              </div>
              <div>
                <p className="text-gray-900 font-bold text-sm mb-0.5">{title}</p>
                <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col gap-3">
          <Link
            href="/practice"
            className="w-full py-4 rounded-2xl text-white font-bold text-base text-center active:scale-[0.98] transition-transform shadow-md"
            style={{
              background: "linear-gradient(135deg,#fb923c,#f97316)",
              boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
            }}
          >
            모의훈련 해보기
          </Link>
          <Link
            href="/"
            className="w-full py-4 rounded-2xl font-bold text-base text-center border-2 border-orange-200 text-orange-500 bg-white active:scale-[0.98] transition-transform"
          >
            오늘의 DTB 보기
          </Link>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
