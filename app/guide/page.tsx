"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

const PRODUCT_NAME = "Apple iPad Air 11형 Wi-Fi 128GB";
const START_PRICE  = 899_000;
const FLOOR_PRICE  = 550_000;

const NEON_PURPLE = "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7, 0 0 52px rgba(139,92,246,0.55)";
const NEON_RED    = "0 0 6px rgba(255,255,255,0.9), 0 0 14px #f87171, 0 0 28px #ef4444, 0 0 52px rgba(239,68,68,0.55)";

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

const SEQUENCE = [
  { price: 899_000, chats: [{ nick: "shopping_star", msg: "오늘 어디까지 갈까요?" },     { nick: "minivelo_fan", msg: "다들 버티는 분위기네요" }] },
  { price: 780_000, chats: [{ nick: "구경꾼99",       msg: "와 벌써 78만원" },            { nick: "라이브팬",     msg: "아직 아무도 안 누르네?" }] },
  { price: 650_000, chats: [{ nick: "실속파",         msg: "이걸 버틴다고??" },           { nick: "쇼핑고수",     msg: "슬슬 누를 사람 나올 듯" }] },
  { price: 550_000, chats: [{ nick: "라이브킹",       msg: "레전드네 ㄷㄷ" },            { nick: "채팅구경",     msg: "단합력 무엇 ㅋㅋ" }] },
];

type ChatMsg = { nick: string; msg: string; id: number };
type Evt =
  | { at: number; action: "price";   stepIdx: number }
  | { at: number; action: "chat";    stepIdx: number; chatIdx: number }
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

const RULES = [
  { n: "01", title: "가격은 계속 내려갑니다",  desc: "시간이 지날수록 상품 가격이 내려갑니다." },
  { n: "02", title: "원하는 순간에 누르세요",   desc: "더 기다릴수록 싸지지만, 누군가 먼저 낙찰받을 수 있습니다." },
  { n: "03", title: "가장 빠른 1명이 승리",     desc: "서버 기준으로 가장 먼저 누른 사람이 낙찰됩니다." },
];

export default function GuidePage() {
  const [stepIdx,        setStepIdx]        = useState(0);
  const [chats,          setChats]          = useState<ChatMsg[]>([]);
  const [buttonPressed,  setButtonPressed]  = useState(false);
  const [showSuccess,    setShowSuccess]    = useState(false);
  const [showHint,       setShowHint]       = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const msgIdRef  = useRef(0);

  /* scroll-reveal */
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("card-visible"); observer.unobserve(e.target); }
      }),
      { threshold: 0.06, rootMargin: "0px 0px -32px 0px" }
    );
    cardRefs.current.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  const setRef = (i: number) => (el: HTMLElement | null) => { cardRefs.current[i] = el; };

  /* animation loop */
  useEffect(() => {
    function schedule() {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      setStepIdx(0); setChats([]); setButtonPressed(false); setShowSuccess(false); setShowHint(false);
      for (const evt of EVENTS) {
        const t = setTimeout(() => {
          if      (evt.action === "price")   setStepIdx(evt.stepIdx);
          else if (evt.action === "chat")    { const m = SEQUENCE[evt.stepIdx].chats[evt.chatIdx]; setChats(c => [...c, { ...m, id: ++msgIdRef.current }]); }
          else if (evt.action === "press")   setButtonPressed(true);
          else if (evt.action === "success") setShowSuccess(true);
          else if (evt.action === "hint")    setShowHint(true);
        }, evt.at);
        timersRef.current.push(t);
      }
      timersRef.current.push(setTimeout(schedule, LOOP_MS));
    }
    schedule();
    return () => { timersRef.current.forEach(clearTimeout); };
  }, []);

  const currentPrice = SEQUENCE[stepIdx].price;
  const barPct       = ((START_PRICE - currentPrice) / (START_PRICE - FLOOR_PRICE)) * 100;
  const isTense      = stepIdx >= 3;
  const visibleChats = chats.slice(-3);

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-20">
      <div className="w-full max-w-md px-4 pt-10">

        <div ref={setRef(0)} className="card-rise flex mb-5">
          <HomeButton />
        </div>

        <div ref={setRef(1)} className="card-rise mb-8" style={{ transitionDelay: "60ms" }}>
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-5xl font-black text-white leading-tight">게임방법</h1>
          <p className="text-base text-white/65 mt-2">가격이 내려가는 순간, 먼저 누른 사람이 임자!</p>
        </div>

        {/* Live preview */}
        <div ref={setRef(2)} className="card-rise mb-1" style={{ transitionDelay: "120ms" }}>
          <div className="bg-[#141414] border border-white/10 rounded-2xl overflow-hidden relative">

            {/* Header */}
            <div className="px-4 pt-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                  <span className="w-1 h-1 bg-white rounded-full animate-pulse inline-block" />
                  LIVE
                </span>
                <span className="text-white/65 text-xs">✋ <b className="text-white/80">186명</b></span>
                <span className="text-white/65 text-xs">👁 <b className="text-white/80">3,412명</b></span>
              </div>

              <div className="flex items-center gap-2 mb-2.5">
                <div className="relative w-5 h-5 flex-shrink-0 bg-white/10 rounded-sm overflow-hidden">
                  <Image src="/product.png" alt="product" fill sizes="20px" style={{ objectFit: "cover" }} />
                </div>
                <p className="text-white/60 text-xs truncate flex-1">{PRODUCT_NAME}</p>
              </div>

              <div
                className="font-black tabular-nums font-mono leading-none transition-all duration-700 price-tick"
                style={{
                  fontSize: "2.4rem",
                  color: isTense ? "#fff1f2" : "#f5f3ff",
                  textShadow: isTense ? NEON_RED : NEON_PURPLE,
                }}
              >
                {fmt(currentPrice)}
              </div>
              <p className="text-white/55 text-xs mt-1 mb-2.5">↓ ₩1,000/초 하락</p>

              <div>
                <div className="flex justify-between text-[10px] text-white/50 mb-1">
                  <span>{fmt(START_PRICE)}</span>
                  <span className="font-medium" style={{ color: isTense ? "#ef4444" : "#a855f7" }}>
                    목표 {fmt(FLOOR_PRICE)}
                  </span>
                </div>
                <div className="h-px bg-white/10 w-full rounded-full">
                  <div
                    className="h-px transition-all duration-700 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, barPct))}%`, background: isTense ? "#ef4444" : "#a855f7" }}
                  />
                </div>
              </div>
            </div>

            {/* Chat */}
            <div className="px-4 py-2 h-[60px] flex flex-col justify-end gap-1 overflow-hidden">
              {visibleChats.map((c) => (
                <div key={c.id} className="chat-in leading-relaxed">
                  <span className="text-[10px] font-bold text-white/60 mr-1.5">{c.nick}</span>
                  <span className="text-[11px] text-white/75">{c.msg}</span>
                </div>
              ))}
            </div>

            {/* Bid button (demo) */}
            <div className="px-4 pb-4">
              <div
                className="w-full py-3.5 font-bold text-base text-white text-center rounded-xl select-none transition-all duration-300"
                style={{
                  background: buttonPressed
                    ? "linear-gradient(180deg, #4ade80 0%, #22c55e 100%)"
                    : "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)",
                  transform: buttonPressed ? "scale(0.97)" : "scale(1)",
                  boxShadow: buttonPressed
                    ? "0 2px 14px rgba(74,222,128,0.5)"
                    : "0 2px 14px rgba(168,85,247,0.55)",
                }}
              >
                {buttonPressed ? "✅ 낙찰 완료!" : "🔥 낙찰받기"}
              </div>
            </div>

            {/* Success overlay */}
            {showSuccess && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f]/95 z-10 px-6 success-pop rounded-2xl">
                <div className="text-4xl mb-3">🎉</div>
                <p className="text-[10px] uppercase tracking-widest text-white/55 mb-1 font-medium">낙찰 성공</p>
                <p
                  className="font-black font-mono tabular-nums leading-none mb-2"
                  style={{ fontSize: "2.4rem", color: "#f5f3ff", textShadow: NEON_PURPLE }}
                >
                  {fmt(FLOOR_PRICE)}
                </p>
                <p className="text-white/70 text-sm text-center">
                  <span className="font-bold text-white">샘플유저</span>님이 낙찰받았습니다!
                </p>
                {showHint && (
                  <p className="text-white/45 text-xs text-center leading-relaxed mt-3">
                    실제 게임에서는 가장 먼저 누른<br />1명만 낙찰받을 수 있습니다.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-white/35 text-[10px] text-center mb-8" style={{ transitionDelay: "140ms" }}>↺ 자동 반복</p>

        {/* Rules */}
        <div ref={setRef(3)} className="card-rise space-y-3 mb-8" style={{ transitionDelay: "180ms" }}>
          {RULES.map(({ n, title, desc }) => (
            <div key={n} className="bg-[#141414] border border-white/10 rounded-2xl px-5 py-4 flex items-start gap-4">
              <span
                className="text-[11px] font-black font-mono flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7" }}
              >
                {n}
              </span>
              <div>
                <p className="text-base font-bold text-white/90 mb-0.5">{title}</p>
                <p className="text-sm text-white/55 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTAs */}
        <div ref={setRef(4)} className="card-rise flex flex-col gap-2" style={{ transitionDelay: "240ms" }}>
          <Link href="/practice" className="w-full py-4 text-white font-bold text-base text-center bid-btn-purple rounded-xl">
            모의훈련 해보기
          </Link>
          <Link href="/" className="w-full py-4 font-bold text-base text-center border border-white/12 text-white/55 rounded-xl transition-colors hover:border-white/25 hover:text-white/80">
            오늘의 DTB 보기 →
          </Link>
        </div>

      </div>
      <BottomNav />
    </main>
  );
}
