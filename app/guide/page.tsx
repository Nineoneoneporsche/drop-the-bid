"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

const PRODUCT_NAME = "NUVY 누비 유모차 자전거 타보-고급형 미니스트라이크";
const START_PRICE = 250_000;
const FLOOR_PRICE = 150_000;

function fmt(n: number) { return "₩" + n.toLocaleString("ko-KR"); }

const SEQUENCE = [
  { price: 250_000, chats: [{ nick: "shopping_star", msg: "오늘 어디까지 갈까요?" }, { nick: "minivelo_fan", msg: "다들 버티는 분위기네요" }] },
  { price: 220_000, chats: [{ nick: "구경꾼99", msg: "와 벌써 22만원" }, { nick: "라이브팬", msg: "아직 아무도 안 누르네?" }] },
  { price: 180_000, chats: [{ nick: "실속파", msg: "이걸 버틴다고??" }, { nick: "쇼핑고수", msg: "슬슬 누를 사람 나올 듯" }] },
  { price: 150_000, chats: [{ nick: "라이브킹", msg: "레전드네 ㄷㄷ" }, { nick: "채팅구경", msg: "단합력 무엇 ㅋㅋ" }] },
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

export default function GuidePage() {
  const [stepIdx, setStepIdx] = useState(0);
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
      setStepIdx(0); setChats([]); setButtonPressed(false); setShowSuccess(false); setShowHint(false);
      for (const evt of EVENTS) {
        const t = setTimeout(() => {
          if (evt.action === "price") setStepIdx(evt.stepIdx);
          else if (evt.action === "chat") {
            const msg = SEQUENCE[evt.stepIdx].chats[evt.chatIdx];
            setChats((c) => [...c, { ...msg, id: ++msgIdRef.current }]);
          }
          else if (evt.action === "press") setButtonPressed(true);
          else if (evt.action === "success") setShowSuccess(true);
          else if (evt.action === "hint") setShowHint(true);
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
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-20">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-5">
          <HomeButton />
        </div>

        <div className="mb-8">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-3xl font-black text-white">경기 방식</h1>
          <p className="text-white/70 text-sm mt-1.5">가격이 내려가는 순간, 먼저 누른 사람이 임자!</p>
        </div>

        {/* Live preview — white panel for contrast (shows what the actual game looks like) */}
        <div className="bg-[#0f0f0f] border border-white/15 overflow-hidden mb-2 relative">
          <div className="bg-[#141414] px-4 pt-4 pb-3 border-b border-white/15">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5">
                <span className="w-1 h-1 bg-white rounded-full animate-pulse inline-block" />
                LIVE
              </span>
              <span className="text-white/65 text-xs">✋ <b>186명</b></span>
              <span className="text-white/65 text-xs">👁 <b>3,412명</b></span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="relative w-5 h-5 flex-shrink-0 bg-white/10">
                <Image src="/product.png" alt="product" fill sizes="20px" style={{ objectFit: "cover" }} />
              </div>
              <p className="text-white/65 text-xs truncate flex-1">{PRODUCT_NAME}</p>
            </div>
            <div
              className={`font-black tabular-nums font-mono transition-colors duration-700`}
              style={{ fontSize: "2.4rem", lineHeight: 1.1, color: isLow ? "#f97316" : "#ffffff" }}
            >
              {fmt(currentPrice)}
            </div>
            <p className="text-white/60 text-xs mt-0.5 mb-2">↓ ₩1,000/초 하락</p>
            <div>
              <div className="flex justify-between text-[10px] text-white/55 mb-1">
                <span>{fmt(START_PRICE)}</span>
                <span className="text-orange-500 font-medium">목표 {fmt(FLOOR_PRICE)}</span>
              </div>
              <div className="h-px bg-white/10 w-full">
                <div
                  className="h-px transition-all duration-700"
                  style={{ width: `${Math.min(100, Math.max(0, barPct))}%`, background: isLow ? "#ef4444" : "#f97316" }}
                />
              </div>
            </div>
          </div>

          <div className="bg-[#0f0f0f] px-4 py-2 h-[60px] flex flex-col justify-end gap-1 overflow-hidden">
            {visibleChats.map((c) => (
              <div key={c.id} className="chat-in leading-relaxed">
                <span className="text-[10px] font-bold text-white/60 mr-1.5">{c.nick}</span>
                <span className="text-[11px] text-white/75">{c.msg}</span>
              </div>
            ))}
          </div>

          <div className="px-4 pb-4 bg-[#0f0f0f]">
            <div
              className="w-full py-3.5 font-bold text-base text-white text-center select-none transition-all duration-300"
              style={{
                background: buttonPressed ? "#16a34a" : "#f97316",
                transform: buttonPressed ? "scale(0.97)" : "scale(1)",
              }}
            >
              {buttonPressed ? "✅ 낙찰 완료!" : "🔥 낙찰받기"}
            </div>
          </div>

          {showSuccess && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f]/96 z-10 px-6 success-pop">
              <div className="text-4xl mb-3">🎉</div>
              <p className="text-[10px] uppercase tracking-widest text-white/60 mb-1">낙찰 성공</p>
              <p className="font-black text-orange-500 font-mono tabular-nums leading-none mb-2" style={{ fontSize: "2.4rem" }}>
                {fmt(FLOOR_PRICE)}
              </p>
              <p className="text-white/75 text-sm text-center">
                <span className="font-bold text-white">샘플유저</span>님이 낙찰받았습니다!
              </p>
              {showHint && (
                <p className="text-white/55 text-xs text-center leading-relaxed mt-3">
                  실제 게임에서는 가장 먼저 누른<br />1명만 낙찰받을 수 있습니다.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-white/50 text-[10px] text-center mb-8">↺ 자동 반복</p>

        {/* Rules */}
        <div className="mb-8 space-y-5">
          {[
            { n: "01", title: "가격은 계속 내려갑니다", desc: "시간이 지날수록 상품 가격이 내려갑니다." },
            { n: "02", title: "원하는 순간에 누르세요", desc: "더 기다릴수록 싸지지만, 누군가 먼저 낙찰받을 수 있습니다." },
            { n: "03", title: "가장 빠른 1명이 승리", desc: "서버 기준으로 가장 먼저 누른 사람이 낙찰됩니다." },
          ].map(({ n, title, desc }) => (
            <div key={n} className="flex items-start gap-4">
              <span className="text-[10px] font-black text-white/45 font-mono w-5 flex-shrink-0 pt-0.5">{n}</span>
              <div>
                <p className="text-sm font-bold text-white/90">{title}</p>
                <p className="text-xs text-white/65 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/practice"
            className="w-full py-4 text-white font-bold text-base text-center transition-opacity active:opacity-80"
            style={{ background: "#f97316" }}
          >
            모의훈련 해보기
          </Link>
          <Link href="/" className="w-full py-4 font-bold text-base text-center text-white/60 hover:text-white/85 transition-colors">
            오늘의 DTB 보기 →
          </Link>
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
