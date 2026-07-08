"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

/* ── Constants ── */
const START = 10_000;
const FLOOR =  3_000;
const DROP  =    200;
const TICK  =    500; // ms — price drops every 0.5s

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

/* ── Types ── */
type Phase = "start" | "playing" | "won" | "lost";
type Chat  = { id: number; nick: string; msg: string };

/* ── Chat events triggered by price threshold ── */
const CHAT_EVENTS = [
  { threshold: 9000, nick: "라이브팬",  msg: "이번엔 어디까지 갈까요?" },
  { threshold: 8000, nick: "쇼핑고수",  msg: "7천원 밑으로 가면 누를까..." },
  { threshold: 7000, nick: "구경꾼99",  msg: "와 아직 아무도 안 누르네" },
  { threshold: 6200, nick: "실속파",    msg: "이걸 버틴다고??" },
  { threshold: 5200, nick: "채팅구경",  msg: "슬슬 누를 사람 나올 듯" },
  { threshold: 4400, nick: "득템요정",  msg: "와 이 가격이면 고민된다" },
  { threshold: 3600, nick: "알뜰파",    msg: "진짜 레전드네 ㄷㄷ" },
];

export default function PracticePage() {
  const [phase,  setPhase]  = useState<Phase>("start");
  const [price,  setPrice]  = useState(START);
  const [chats,  setChats]  = useState<Chat[]>([]);
  const [winPrice, setWinPrice] = useState(0);

  /* Refs to avoid stale closures inside the interval callback */
  const phaseRef      = useRef<Phase>("start");
  const priceRef      = useRef(START);
  const compPriceRef  = useRef(0);
  const tickRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatIdRef     = useRef(0);
  const firedChatsRef = useRef(new Set<number>());

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const startGame = useCallback(() => {
    stopTick();

    /* Random competitor price between ₩3,800 and ₩5,800 */
    compPriceRef.current = 3_800 + Math.floor(Math.random() * 2_000);

    priceRef.current      = START;
    phaseRef.current      = "playing";
    chatIdRef.current     = 0;
    firedChatsRef.current = new Set();

    setPrice(START);
    setChats([]);
    setWinPrice(0);
    setPhase("playing");
  }, [stopTick]);

  /* Price tick — only active while phase === "playing" */
  useEffect(() => {
    if (phase !== "playing") return;

    tickRef.current = setInterval(() => {
      const next = Math.max(FLOOR, priceRef.current - DROP);
      priceRef.current = next;
      setPrice(next);

      /* Competitor wins */
      if (next <= compPriceRef.current && phaseRef.current === "playing") {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        phaseRef.current = "lost";
        setPhase("lost");
        return;
      }

      /* Reached floor — stop ticking */
      if (next <= FLOOR) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      }
    }, TICK);

    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [phase]);

  /* Chat events — fire once per threshold as price falls */
  useEffect(() => {
    if (phase !== "playing") return;
    for (const evt of CHAT_EVENTS) {
      if (price <= evt.threshold && !firedChatsRef.current.has(evt.threshold)) {
        firedChatsRef.current.add(evt.threshold);
        setChats((c) => [
          ...c,
          { id: ++chatIdRef.current, nick: evt.nick, msg: evt.msg },
        ]);
      }
    }
  }, [price, phase]);

  const handlePress = useCallback(() => {
    if (phase !== "playing") return;
    stopTick();
    phaseRef.current = "won";
    setWinPrice(priceRef.current);
    setPhase("won");
  }, [phase, stopTick]);

  /* Derived display values */
  const barPct     = Math.min(100, Math.max(0, ((START - price) / (START - FLOOR)) * 100));
  const isTense    = price < 5_000;
  const visibleChats = chats.slice(-4);

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-4">
          <HomeButton />
        </div>

        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-2xl font-black text-gray-900 mb-1">모의훈련</h1>
          <p className="text-gray-400 text-sm">실제 게임 전에 감각을 익혀보세요.</p>
        </div>

        {/* ═══ START SCREEN ═══ */}
        {phase === "start" && (
          <div className="bg-white rounded-3xl shadow-sm border border-orange-100 overflow-hidden">
            {/* Product image placeholder */}
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center py-10">
              <span style={{ fontSize: 72 }}>🎫</span>
            </div>

            <div className="px-5 pt-4 pb-6">
              <p className="text-gray-400 text-xs mb-1">연습 상품</p>
              <h2 className="text-gray-900 font-bold text-lg mb-4">
                배민 10,000원 상품권
              </h2>

              <div className="flex gap-6 mb-5">
                <div>
                  <p className="text-gray-400 text-xs mb-0.5">시작가</p>
                  <p className="text-2xl font-black text-orange-500 font-mono tabular-nums">{fmt(START)}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-0.5">목표가</p>
                  <p className="text-2xl font-black text-gray-600 font-mono tabular-nums">{fmt(FLOOR)}</p>
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 mb-5">
                <p className="text-orange-600 text-xs leading-relaxed">
                  💡 <strong>연습 모드입니다.</strong> 실제 결제나 낙찰은 이루어지지 않습니다.
                </p>
              </div>

              <button
                onClick={startGame}
                className="w-full py-4 rounded-2xl text-white font-bold text-base active:scale-[0.98] transition-transform shadow-md"
                style={{
                  background: "linear-gradient(135deg,#fb923c,#f97316)",
                  boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
                }}
              >
                훈련 시작
              </button>
            </div>
          </div>
        )}

        {/* ═══ PLAYING SCREEN ═══ */}
        {phase === "playing" && (
          <div className="bg-white rounded-3xl shadow-sm border border-orange-100 overflow-hidden">

            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-100">
              {/* Status row */}
              <div className="flex items-center gap-2 mb-3">
                <span className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse inline-block" />
                  LIVE
                </span>
                <span className="text-gray-500 text-xs">✋ <b>38명</b></span>
                <span className="text-gray-500 text-xs">👁 <b>124명</b></span>
                <span className="ml-auto bg-orange-100 text-orange-500 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  연습 모드
                </span>
              </div>

              {/* Product row */}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-base flex-shrink-0">
                  🎫
                </div>
                <p className="text-gray-400 text-xs truncate">배민 10,000원 상품권</p>
              </div>

              {/* Tension warning */}
              {isTense && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse inline-block flex-shrink-0" />
                  <span className="text-red-500 text-xs font-bold">위험 구간 진입</span>
                </div>
              )}

              {/* Price */}
              <div
                className={`font-black tabular-nums font-mono ${isTense ? "text-red-500" : "text-orange-500"}`}
                style={{
                  fontSize: isTense ? "3rem" : "2.6rem",
                  lineHeight: 1.1,
                  transition: "font-size 0.3s ease, color 0.3s ease",
                }}
              >
                {fmt(price)}
              </div>
              <p className="text-gray-400 text-xs mt-1 mb-3">↓ {fmt(DROP)} / 0.5초 하락</p>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>{fmt(START)}</span>
                  <span className="text-orange-500 font-semibold">목표가 {fmt(FLOOR)}</span>
                </div>
                <div className="w-full bg-orange-50 rounded-full h-3 overflow-hidden border border-orange-100">
                  <div
                    className="h-3 rounded-full transition-all duration-500"
                    style={{
                      width: `${barPct}%`,
                      background: isTense
                        ? "linear-gradient(90deg,#f97316,#ef4444)"
                        : "linear-gradient(90deg,#fb923c,#f59e0b)",
                    }}
                  />
                </div>
                <p className="text-right text-xs text-gray-400 mt-1">
                  {Math.round(barPct)}% 내려왔어요
                </p>
              </div>
            </div>

            {/* Chat feed — fixed height */}
            <div className="px-4 py-3 h-[90px] flex flex-col justify-end gap-1.5 overflow-hidden">
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

            {/* Action button */}
            <div className="px-4 pb-4">
              <button
                onClick={handlePress}
                className="w-full py-5 rounded-2xl text-xl font-bold text-white active:scale-[0.97] transition-transform"
                style={{
                  background: isTense
                    ? "linear-gradient(135deg,#ef4444,#dc2626)"
                    : "linear-gradient(135deg,#fb923c,#f97316)",
                  boxShadow: isTense
                    ? "0 4px 24px rgba(239,68,68,0.5)"
                    : "0 4px 24px rgba(249,115,22,0.4)",
                }}
              >
                🔥 낙찰받기
              </button>
              <p className="text-gray-400 text-xs text-center mt-2">
                지금 누르면{" "}
                <span className="text-orange-500 font-semibold">{fmt(price)}</span>에 낙찰
              </p>
            </div>
          </div>
        )}

        {/* ═══ SUCCESS SCREEN ═══ */}
        {phase === "won" && (
          <div className="success-pop">
            <div className="bg-white rounded-3xl shadow-md border border-green-100 px-6 py-8 text-center">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">성공!</h2>
              <p className="text-gray-500 text-sm mb-1">
                <span className="text-orange-500 font-bold text-lg">{fmt(winPrice)}</span>에 모의 낙찰 성공
              </p>
              <p className="text-gray-400 text-xs mb-1">
                정가 대비{" "}
                <span className="text-green-600 font-semibold">
                  {fmt(START - winPrice)} 절약 ({Math.round(((START - winPrice) / START) * 100)}% ↓)
                </span>
              </p>

              <div className="bg-green-50 border border-green-100 rounded-2xl px-4 py-3 mt-5 mb-6">
                <p className="text-green-700 text-xs leading-relaxed">
                  실제 게임에서는 가장 먼저 누른<br />1명만 낙찰받을 수 있습니다.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={startGame}
                  className="w-full py-4 rounded-2xl text-white font-bold text-base active:scale-[0.98] transition-transform shadow-md"
                  style={{
                    background: "linear-gradient(135deg,#fb923c,#f97316)",
                    boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
                  }}
                >
                  다시 훈련하기
                </button>
                <Link
                  href="/"
                  className="w-full py-4 rounded-2xl font-bold text-base text-center border-2 border-orange-200 text-orange-500 bg-white active:scale-[0.98] transition-transform"
                >
                  오늘의 DTB 보기
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* ═══ FAILURE SCREEN ═══ */}
        {phase === "lost" && (
          <div className="success-pop">
            <div className="bg-white rounded-3xl shadow-md border border-red-100 px-6 py-8 text-center">
              <div className="text-5xl mb-4">😔</div>
              <h2 className="text-2xl font-black text-gray-900 mb-2">실패!</h2>
              <p className="text-gray-600 text-sm mb-1">다른 참가자가 먼저 낙찰받았습니다.</p>
              <p className="text-gray-400 text-sm mb-6">조금만 더 빨리 눌렀어야 해요.</p>

              <div className="bg-orange-50 border border-orange-100 rounded-2xl px-4 py-3 mb-6">
                <p className="text-orange-600 text-xs leading-relaxed">
                  💡 타이밍이 핵심입니다.<br />너무 늦으면 다른 사람이 먼저 낙찰받아요.
                </p>
              </div>

              <button
                onClick={startGame}
                className="w-full py-4 rounded-2xl text-white font-bold text-base active:scale-[0.98] transition-transform shadow-md"
                style={{
                  background: "linear-gradient(135deg,#fb923c,#f97316)",
                  boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
                }}
              >
                다시 훈련하기
              </button>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
