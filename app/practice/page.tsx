"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

const START = 10_000;
const FLOOR =  3_000;
const DROP  =    200;
const TICK  =    500;

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

type Phase = "start" | "playing" | "won" | "lost";
type Chat  = { id: number; nick: string; msg: string };

const CHAT_EVENTS = [
  { threshold: 9000, nick: "라이브팬",  msg: "이번엔 어디까지 갈까요?" },
  { threshold: 8000, nick: "쇼핑고수",  msg: "7천원 밑으로 가면 누를까..." },
  { threshold: 7000, nick: "구경꾼99",  msg: "와 아직 아무도 안 누르네" },
  { threshold: 6200, nick: "실속파",    msg: "이걸 버틴다고??" },
  { threshold: 5200, nick: "채팅구경",  msg: "슬슬 누를 사람 나올 듯" },
  { threshold: 4400, nick: "득템요정",  msg: "와 이 가격이면 고민된다" },
  { threshold: 3600, nick: "알뜰파",    msg: "진짜 레전드네 ㄷㄷ" },
];

const NEON_PURPLE = "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7, 0 0 52px rgba(139,92,246,0.55)";
const NEON_RED    = "0 0 6px rgba(255,255,255,0.9), 0 0 14px #f87171, 0 0 28px #ef4444, 0 0 52px rgba(239,68,68,0.55)";

export default function PracticePage() {
  const [phase,    setPhase]    = useState<Phase>("start");
  const [price,    setPrice]    = useState(START);
  const [chats,    setChats]    = useState<Chat[]>([]);
  const [winPrice, setWinPrice] = useState(0);

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
    compPriceRef.current = 3_800 + Math.floor(Math.random() * 2_000);
    priceRef.current = START;
    phaseRef.current = "playing";
    chatIdRef.current = 0;
    firedChatsRef.current = new Set();
    setPrice(START); setChats([]); setWinPrice(0); setPhase("playing");
  }, [stopTick]);

  useEffect(() => {
    if (phase !== "playing") return;
    tickRef.current = setInterval(() => {
      const next = Math.max(FLOOR, priceRef.current - DROP);
      priceRef.current = next;
      setPrice(next);
      if (next <= compPriceRef.current && phaseRef.current === "playing") {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        phaseRef.current = "lost"; setPhase("lost"); return;
      }
      if (next <= FLOOR) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      }
    }, TICK);
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return;
    for (const evt of CHAT_EVENTS) {
      if (price <= evt.threshold && !firedChatsRef.current.has(evt.threshold)) {
        firedChatsRef.current.add(evt.threshold);
        setChats((c) => [...c, { id: ++chatIdRef.current, nick: evt.nick, msg: evt.msg }]);
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

  const barPct   = Math.min(100, Math.max(0, ((START - price) / (START - FLOOR)) * 100));
  const isTense  = price < 5_000;
  const visibleChats = chats.slice(-4);
  const winSaved = START - winPrice;
  const winPct   = Math.round((winSaved / START) * 100);

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-20">
      <div className="w-full max-w-md px-4 pt-10">
        <div className="flex mb-5">
          <HomeButton />
        </div>

        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.12em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-5xl font-black text-white leading-tight">모의훈련</h1>
          <p className="text-base text-white/70 mt-2">실제 게임 전에 감각을 익혀보세요.</p>
        </div>

        {/* START */}
        {phase === "start" && (
          <div className="bg-[#141414] border border-white/15">
            <div className="flex items-center justify-center py-10 bg-white/5">
              <span style={{ fontSize: 64 }}>🎫</span>
            </div>
            <div className="px-5 pt-4 pb-5">
              <p className="text-[10px] uppercase tracking-wider text-white/55 mb-1 font-medium">연습 상품</p>
              <h2 className="text-white font-bold text-lg mb-4">배민 10,000원 상품권</h2>
              <div className="flex gap-6 mb-5">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/55 mb-1 font-medium">시작가</p>
                  <p className="text-2xl font-black text-white font-mono tabular-nums">{fmt(START)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/55 mb-1 font-medium">목표가</p>
                  <p className="text-2xl font-black font-mono tabular-nums" style={{ color: "#c084fc" }}>{fmt(FLOOR)}</p>
                </div>
              </div>
              <div className="px-4 py-3 mb-5" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)" }}>
                <p className="text-xs leading-relaxed" style={{ color: "#c084fc" }}>
                  💡 <strong>연습 모드입니다.</strong> 실제 결제나 낙찰은 이루어지지 않습니다.
                </p>
              </div>
              <button
                onClick={startGame}
                className="w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80 bid-btn-purple"
              >
                훈련 시작
              </button>
            </div>
          </div>
        )}

        {/* PLAYING */}
        {phase === "playing" && (
          <div className="bg-[#141414] border border-white/15 overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-white/15">
              <div className="flex items-center gap-2 mb-3">
                <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5">
                  <span className="w-1 h-1 bg-white rounded-full animate-pulse inline-block" />
                  LIVE
                </span>
                <span className="text-white/65 text-xs">✋ <b className="text-white/80">38명</b></span>
                <span className="text-white/65 text-xs">👁 <b className="text-white/80">124명</b></span>
                <span className="ml-auto bg-white/12 text-white/65 text-[10px] font-bold px-2 py-0.5">연습모드</span>
              </div>

              {isTense && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 px-3 py-1.5 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block flex-shrink-0" />
                  <span className="text-red-400 text-xs font-bold">위험 구간 진입</span>
                </div>
              )}

              {/* Price — neon style matching strategy page */}
              <div
                className="font-black tabular-nums font-mono leading-none transition-all duration-300"
                style={{
                  fontSize: "3.5rem",
                  color: isTense ? "#fff1f2" : "#f5f3ff",
                  textShadow: isTense ? NEON_RED : NEON_PURPLE,
                }}
              >
                {fmt(price)}
              </div>
              <p className="text-white/60 text-xs mt-1.5 mb-3">↓ {fmt(DROP)} / 0.5초 하락</p>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-[10px] text-white/55 mb-1">
                  <span>{fmt(START)}</span>
                  <span className="font-medium" style={{ color: isTense ? "#ef4444" : "#a855f7" }}>
                    목표가 {fmt(FLOOR)}
                  </span>
                </div>
                <div className="h-px bg-white/10 w-full">
                  <div
                    className="h-px transition-all duration-500"
                    style={{ width: `${barPct}%`, background: isTense ? "#ef4444" : "#a855f7" }}
                  />
                </div>
              </div>
            </div>

            {/* Chat */}
            <div className="px-4 py-2 h-[72px] flex flex-col justify-end gap-1 overflow-hidden">
              {visibleChats.map((c) => (
                <div key={c.id} className="chat-in leading-relaxed">
                  <span className="text-[10px] font-bold text-white/60 mr-1.5">{c.nick}</span>
                  <span className="text-[11px] text-white/80">{c.msg}</span>
                </div>
              ))}
            </div>

            {/* Bid button */}
            <div className="px-4 pb-4">
              <button
                onClick={handlePress}
                className={`w-full py-5 text-xl font-bold text-white transition-all active:scale-[0.98] ${isTense ? "bid-btn-critical" : "bid-btn-purple"}`}
              >
                🔥 낙찰받기
              </button>
              <p className="text-white/42 text-[11px] text-center mt-1.5">
                지금 누르면{" "}
                <span className="font-bold text-white/72">{fmt(price)}</span>에 낙찰
                {price < START && (
                  <span className="ml-1.5 font-bold" style={{ color: isTense ? "#ef4444" : "#c084fc" }}>
                    · {fmt(START - price)} 절약
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* SUCCESS */}
        {phase === "won" && (
          <div className="success-pop bg-[#141414] border border-white/15 px-6 py-8 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <p className="text-[10px] uppercase tracking-widest text-white/60 mb-2 font-medium">모의 낙찰 성공</p>
            <p
              className="font-black font-mono tabular-nums leading-none mb-1"
              style={{
                fontSize: "3rem",
                color: "#f5f3ff",
                textShadow: NEON_PURPLE,
              }}
            >
              {fmt(winPrice)}
            </p>
            <p className="text-white/40 text-sm tabular-nums line-through mb-2">{fmt(START)}</p>
            <p className="text-green-400 text-sm font-semibold mb-1">
              {fmt(winSaved)} 절약 ({winPct}% ↓)
            </p>
            <div className="border border-white/15 bg-white/5 px-4 py-3 mt-5 mb-6">
              <p className="text-white/65 text-xs leading-relaxed">
                실제 게임에서는 가장 먼저 누른<br />1명만 낙찰받을 수 있습니다.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={startGame}
                className="w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80 bid-btn-purple"
              >
                다시 훈련하기
              </button>
              <Link href="/" className="w-full py-4 font-bold text-base text-center border border-white/18 text-white/65">
                오늘의 DTB 보기
              </Link>
            </div>
          </div>
        )}

        {/* FAILURE */}
        {phase === "lost" && (
          <div className="success-pop bg-[#141414] border border-white/15 px-6 py-8 text-center">
            <div className="text-5xl mb-4">😔</div>
            <p className="text-[10px] uppercase tracking-widest text-white/60 mb-2 font-medium">다른 참가자 낙찰</p>
            <h2 className="text-2xl font-black text-white mb-2">실패!</h2>
            <p className="text-white/75 text-sm mb-1">다른 참가자가 먼저 낙찰받았습니다.</p>
            <p className="text-white/60 text-sm mb-6">조금만 더 빨리 눌렀어야 해요.</p>
            <div className="px-4 py-3 mb-6" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)" }}>
              <p className="text-xs leading-relaxed" style={{ color: "#c084fc" }}>
                💡 타이밍이 핵심입니다.<br />너무 늦으면 다른 사람이 먼저 낙찰받아요.
              </p>
            </div>
            <button
              onClick={startGame}
              className="w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80 bid-btn-purple"
            >
              다시 훈련하기
            </button>
          </div>
        )}
      </div>
      <BottomNav />
    </main>
  );
}
