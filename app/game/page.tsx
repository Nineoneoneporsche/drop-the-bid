"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  useGame,
  formatKRW,
  MOCK_PARTICIPANT_COUNT,
  MOCK_SPECTATOR_COUNT,
} from "../context/GameContext";
import { ProductThumb } from "../components/ProductImage";
import RightActionMenu from "../components/RightActionMenu";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

// Five recurring personalities, each with a consistent voice:
// 버티기대장  — the coordinator. Rallies everyone to hold.
// 빠른손99    — the risk taker. Perpetually on the edge of pressing.
// 신중한민수  — the cautious analyst. Calculates, hedges, asks questions.
// 구경꾼A     — the observer. Watches group dynamics, meta-comments.
// 의심많은B  — the suspicious one. Certain someone is about to betray.
//
// Floor = ₩150,000 = 60% of start. Events below threshold 60 never fire.
// Full arc: 100% → 60%, mapped to early / mid / late game below.

const CHAT_EVENTS = [
  // ── EARLY GAME (97–81%) ─────────────────────────────────────────────────
  {
    threshold: 97,
    nickname: "버티기대장",
    message: "자 오늘 목표가 얼마까지예요? 저는 최소 17만원까지는 버텨볼 거예요",
  },
  {
    threshold: 95,
    nickname: "신중한민수",
    message: "저는 18만원 선을 생각하고 있어요. 거기까지면 꽤 좋은 가격이죠",
  },
  {
    threshold: 93,
    nickname: "빠른손99",
    message: "솔직히 20만원에 눌러도 이미 괜찮지 않나요? 10% 할인인데...",
  },
  {
    threshold: 91,
    nickname: "버티기대장",
    message: "20만원은 너무 아까워요. 다 같이 버티면 분명히 더 내려가요. 조금만 참아요",
  },
  {
    threshold: 89,
    nickname: "구경꾼A",
    message: "이 채팅방 분위기 보니까 오늘은 꽤 내려갈 것 같은데요",
  },
  {
    threshold: 87,
    nickname: "의심많은B",
    message: "근데 채팅 안 하는 사람들이 더 많잖아요. 그 사람들이 제일 무서운 거 아닌가요",
  },
  {
    threshold: 85,
    nickname: "신중한민수",
    message: "맞아요... 저 포함해서 몇 명이 조용히 버티고 있는지 감도 안 와요",
  },
  {
    threshold: 83,
    nickname: "버티기대장",
    message: "괜찮아요, 다들 믿어봐요. 여기서 흔들리면 안 돼요. 아직 한참 남았어요",
  },
  {
    threshold: 81,
    nickname: "빠른손99",
    message: "저는 믿는데... 근데 손이 벌써 조금씩 가고 있어요 ㅎ",
  },
  // ── MID GAME (80–67%) ───────────────────────────────────────────────────
  {
    threshold: 79,
    nickname: "버티기대장",
    message: "드디어 20만원 밑으로 떨어졌어요! 여기서 누르는 사람은 없겠죠?",
  },
  {
    threshold: 78,
    nickname: "구경꾼A",
    message: "20% 할인에도 아무도 안 눌렀네요. 오늘 단합력 진짜 대단한데요",
  },
  {
    threshold: 76,
    nickname: "의심많은B",
    message: "단합력이라고 하기엔... 지금 이 순간에도 손가락 화면 위에 올려놓은 사람 있을 것 같은데요",
  },
  {
    threshold: 74,
    nickname: "신중한민수",
    message: "지금 정확히 몇 퍼센트 할인인지 계산하기 귀찮아서요. 아시는 분 계세요?",
  },
  {
    threshold: 72,
    nickname: "빠른손99",
    message: "28% 할인이에요. 근데 솔직히 이 가격도 이미 충분하지 않나요? 저만 그런가요",
  },
  {
    threshold: 70,
    nickname: "버티기대장",
    message: "충분하지 않아요!! 17만원까지는 같이 가봐요. 거기서 32% 할인이에요!",
  },
  {
    threshold: 68,
    nickname: "의심많은B",
    message: "다들 진짜 안 눌렀어요? 솔직하게요. 저만 혼자 버티고 있는 건 아니죠?",
  },
  {
    threshold: 67,
    nickname: "구경꾼A",
    message: "이 타이밍에 먼저 누르는 사람... 뭐라 하진 않겠지만 오래 기억할 것 같아요",
  },
  // ── LATE GAME (66–61%) ──────────────────────────────────────────────────
  {
    threshold: 66,
    nickname: "빠른손99",
    message: "저 솔직히 말할게요. 지금 거의 한계예요. 이 가격 진짜 좋잖아요...",
  },
  {
    threshold: 65,
    nickname: "버티기대장",
    message: "제발요ㅠ 조금만 더요. 16만원까지만! 거기서 36% 할인이에요",
  },
  {
    threshold: 64,
    nickname: "신중한민수",
    message: "저도 손이 떨려요. 이게 심리전이구나 처음 실감하네요. 일단 버텨볼게요",
  },
  {
    threshold: 63,
    nickname: "의심많은B",
    message: "느낌이 이상해요. 누군가 아무 말 없이 조용히 누르려고 준비 중인 것 같아요",
  },
  {
    threshold: 62,
    nickname: "버티기대장",
    message: "안 눌렀죠?? 아직 안 눌렀죠?? 제발 10초만요, 딱 10초만 더요!!",
  },
  {
    threshold: 61,
    nickname: "빠른손99",
    message: "저 진짜예요. 진짜 못 버티겠어요. 근데 아직 참고 있어요... 으으으",
  },
];

const NARRATOR_EVENTS = [
  { threshold: 92, message: "경기 시작 — 참가자들이 숨죽이며 가격을 지켜보고 있습니다" },
  { threshold: 79, message: "₩200,000 이하 진입 — 아직 아무도 낙찰받지 않았습니다" },
  { threshold: 70, message: "30% 할인 구간 돌파 — 심리전이 본격화되고 있습니다" },
  { threshold: 65, message: "⚡ 35% 이상 할인 — 언제든 낙찰이 날 수 있습니다" },
  { threshold: 61, message: "🔥 최저가 근접 — 지금이 경기의 마지막 순간입니다" },
];

export default function GamePage() {
  const { state, dispatch } = useGame();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [raised, setRaised] = useState(false);
  const [tickFlash, setTickFlash] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedChatRef = useRef(new Set<number>());
  const firedNarratorRef = useRef(new Set<number>());

  useEffect(() => {
    if (!state.currentUser) { router.replace("/"); return; }
    if (state.phase === "ended") { router.replace("/winner"); return; }
  }, [state.currentUser, state.phase, router]);

  useEffect(() => {
    if (state.phase !== "game") return;
    tickRef.current = setInterval(() => {
      dispatch({ type: "TICK" });
      setTickFlash(true);
      setTimeout(() => setTickFlash(false), 220);
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [state.phase, dispatch]);

  useEffect(() => {
    if (state.phase !== "game" || !state.config.startPrice) return;
    const pct = Math.round((state.currentPrice / state.config.startPrice) * 100);
    for (const evt of CHAT_EVENTS) {
      if (pct <= evt.threshold && !firedChatRef.current.has(evt.threshold)) {
        firedChatRef.current.add(evt.threshold);
        dispatch({ type: "SEND_MESSAGE", nickname: evt.nickname, message: evt.message, timestamp: Date.now() });
      }
    }
    for (const evt of NARRATOR_EVENTS) {
      if (pct <= evt.threshold && !firedNarratorRef.current.has(evt.threshold)) {
        firedNarratorRef.current.add(evt.threshold);
        dispatch({ type: "SEND_NARRATOR", message: evt.message, timestamp: Date.now() + 1 });
      }
    }
  }, [state.currentPrice, state.config.startPrice, state.phase, dispatch]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatMessages]);

  const handleRaiseHand = useCallback(() => {
    if (!state.currentUser || state.currentUser.role !== "participant" || raised) return;
    setRaised(true);
    if (tickRef.current) clearInterval(tickRef.current);
    dispatch({ type: "RAISE_HAND", nickname: state.currentUser.nickname, price: state.currentPrice });
    router.push("/winner");
  }, [state.currentUser, state.currentPrice, raised, dispatch, router]);

  function sendMessage() {
    if (!message.trim() || !state.currentUser) return;
    dispatch({
      type: "SEND_MESSAGE",
      nickname: state.currentUser.nickname,
      message: message.trim(),
      timestamp: Date.now(),
    });
    setMessage("");
  }

  const isParticipant = state.currentUser?.role === "participant";
  const floor = state.config.floorPrice;
  const start = state.config.startPrice;
  const barPct = start > floor
    ? Math.min(100, Math.max(0, ((start - state.currentPrice) / (start - floor)) * 100))
    : 0;
  const pct = start > 0 ? Math.max(0, (state.currentPrice / start) * 100) : 0;
  const isLow = pct < 50;
  const isCritical = pct < 30;
  const currentSavings = start - state.currentPrice;
  const currentSavingsPct = start > 0 ? Math.round((currentSavings / start) * 100) : 0;

  if (!state.currentUser) return null;

  return (
    <main className="h-screen bg-[#0a0a0a] max-w-md mx-auto overflow-hidden relative flex flex-col">

      {/* ── Atmospheric blurred background ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <Image
          src="/product.png"
          alt=""
          fill
          priority
          style={{
            objectFit: "cover",
            opacity: 0.09,
            filter: "blur(40px) saturate(0.4)",
            transform: "scale(1.15)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(10,10,10,0.95) 0%, rgba(10,10,10,0.48) 38%, rgba(10,10,10,0.98) 100%)",
          }}
        />
      </div>

      {/* Right action buttons — bottom-anchored, consistent with strategy page */}
      <RightActionMenu containerClassName="absolute right-3 bottom-[128px] z-40 flex flex-col gap-3" />

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col h-full">

        {/* Top bar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-10 pb-2">
          <div className="flex items-center gap-2">
            <HomeButton />
            <div className="w-px h-3.5 bg-white/15 flex-shrink-0" />
            <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-red-500 flex-shrink-0">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              LIVE
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-white/55 tabular-nums flex-shrink-0">
            <span>✋{MOCK_PARTICIPANT_COUNT - 31}</span>
            <span className="text-white/20">·</span>
            <span>👁{MOCK_SPECTATOR_COUNT.toLocaleString()}</span>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────────
            1. PRICE — visual hero
            ────────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-4 pt-1 pb-3">
          <p className="text-[9px] uppercase tracking-[0.20em] text-white/40 font-medium mb-1.5">
            현재 가격 · {formatKRW(state.config.dropAmount)}/초 하락
          </p>

          <div
            className={`font-black tabular-nums font-mono leading-none transition-colors duration-300 ${tickFlash ? "price-tick" : ""}`}
            style={{
              fontSize: "5rem",
              color: isCritical ? "#ef4444" : isLow ? "#f97316" : "#ffffff",
              letterSpacing: "-0.02em",
            }}
          >
            {formatKRW(state.currentPrice)}
          </div>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-white/28 text-xs tabular-nums line-through">{formatKRW(start)}</span>
            {currentSavings > 0 && (
              <span
                className="text-[11px] font-bold px-2 py-0.5"
                style={{
                  background: isCritical ? "rgba(239,68,68,0.16)" : "rgba(249,115,22,0.16)",
                  color: isCritical ? "#ef4444" : "#f97316",
                }}
              >
                -{currentSavingsPct}% · {formatKRW(currentSavings)} 절약
              </span>
            )}
          </div>

          <div className="mt-2.5">
            <div className="h-px bg-white/10 w-full overflow-hidden">
              <div
                className="h-full transition-all duration-1000"
                style={{
                  width: `${barPct}%`,
                  background: isCritical
                    ? "#ef4444"
                    : isLow
                    ? "linear-gradient(90deg, #f97316, #ef4444)"
                    : "#f97316",
                }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-white/28">시작 {formatKRW(start)}</span>
              <span className="text-[9px]" style={{ color: isCritical ? "#ef4444" : "#f97316" }}>
                최저 {formatKRW(floor)}
              </span>
            </div>
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────────
            2. LIVE CHAT — fills the middle, scrolls live
            Chat is here so users follow crowd psychology in real time.
            ────────────────────────────────────────────────────────────── */}
        <div className="relative flex-1 overflow-hidden">
          {/* Top fade blends into price section */}
          <div
            className="absolute top-0 left-0 right-0 h-5 z-10 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, rgba(10,10,10,0.75), transparent)" }}
          />
          {/* Bottom fade blends into product section */}
          <div
            className="absolute bottom-0 left-0 right-0 h-5 z-10 pointer-events-none"
            style={{ background: "linear-gradient(to top, rgba(10,10,10,0.75), transparent)" }}
          />
          <div className="h-full overflow-y-auto px-4 pt-3 pb-3">
            {state.chatMessages.map((msg) => {
              if (msg.kind === "system") {
                return (
                  <div key={msg.id} className="py-1 text-center">
                    <span className="text-[11px] text-white/38">{msg.message}</span>
                  </div>
                );
              }
              if (msg.kind === "narrator") {
                return (
                  <div key={msg.id} className="py-1 narrator-slide">
                    <span className="text-[11px] font-semibold text-orange-500">▶ {msg.message}</span>
                  </div>
                );
              }
              const isMe = msg.nickname === state.currentUser?.nickname;
              return (
                <div key={msg.id} className="py-0.5 leading-relaxed">
                  <span className={`text-[11px] font-bold mr-1.5 ${isMe ? "text-orange-400" : "text-white/55"}`}>
                    {isMe ? "나" : msg.nickname}
                  </span>
                  <span className="text-[11px] text-white/70">{msg.message}</span>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* ──────────────────────────────────────────────────────────────
            3. PRODUCT  +  4. ACTION — pinned to bottom
            Right action buttons (지갑/공유/더보기) float inside this
            relative wrapper, vertically centered on the whole block.
            ────────────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0">

          {/* 3. Product — thumbnail + name + retail + target */}
          <div className="px-4 pr-[72px] pt-3 pb-3">
            <div className="h-px bg-white/8 mb-3" />
            <div className="flex items-center gap-3">
              <ProductThumb alt={state.config.productName} size={48} rounded="rounded-sm" />
              <div className="flex-1 min-w-0">
                <p className="text-white/82 text-[13px] font-semibold leading-snug line-clamp-2">
                  {state.config.productName}
                </p>
                <div className="flex items-center gap-5 mt-1.5">
                  <div>
                    <p className="text-[8px] text-white/28 uppercase tracking-wider mb-0.5">정가</p>
                    <p className="text-white/38 text-[11px] font-mono tabular-nums line-through">
                      {formatKRW(start)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-white/28 uppercase tracking-wider mb-0.5">목표 최저가</p>
                    <p className="text-orange-400 text-[11px] font-bold font-mono tabular-nums">
                      {formatKRW(floor)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Action — [관전 30%] [🔥 낙찰받기 70%] */}
          <div className="px-4 pr-[72px] pb-3">
            <div className="h-px bg-white/8 mb-3" />
            <div className="flex gap-2">
              {/* Observer — 30% */}
              <button
                className="flex flex-col items-center justify-center py-3.5 border border-white/12 gap-0.5 transition-colors active:bg-white/5 flex-[3]"
              >
                <span className="text-base leading-none">👁</span>
                <span className="text-[11px] font-bold text-white/50 mt-1">관전</span>
                <span className="text-[9px] text-white/25 tabular-nums">
                  {MOCK_SPECTATOR_COUNT.toLocaleString()}명
                </span>
              </button>

              {/* Bid — 70% */}
              <button
                onClick={handleRaiseHand}
                disabled={raised || !isParticipant || state.currentPrice <= 0}
                className="flex-[7] flex items-center justify-center py-3.5 font-black text-[18px] text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed"
                style={{
                  background: raised
                    ? "#16a34a"
                    : !isParticipant
                    ? "rgba(255,255,255,0.07)"
                    : isCritical
                    ? "#ef4444"
                    : "#f97316",
                }}
              >
                {raised ? "✅ 낙찰 완료!" : "🔥 낙찰받기"}
              </button>
            </div>

            {/* CTA hint */}
            {isParticipant && !raised && (
              <p className="text-white/42 text-[11px] text-center mt-1.5">
                지금 누르면{" "}
                <span className="font-bold text-white/72">{formatKRW(state.currentPrice)}</span>에 낙찰
                {currentSavings > 0 && (
                  <span className="ml-1.5 font-bold" style={{ color: isCritical ? "#ef4444" : "#f97316" }}>
                    · {formatKRW(currentSavings)} 절약
                  </span>
                )}
              </p>
            )}
            {!isParticipant && (
              <p className="text-white/32 text-[11px] text-center mt-1.5">
                참여자로 입장해야 낙찰받을 수 있어요
              </p>
            )}
          </div>
        </div>

        {/* Chat input */}
        <div className="flex-shrink-0 px-4 pt-2 pb-[4.5rem] border-t border-white/8">
          <div className="flex">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="메시지..."
              className="flex-1 bg-white/5 border border-white/10 border-r-0 px-3 py-2 text-white placeholder-white/18 text-[12px] focus:outline-none focus:border-orange-500/40 transition-colors min-w-0"
            />
            <button
              onClick={sendMessage}
              disabled={!message.trim()}
              className="bg-white/5 disabled:bg-white/3 disabled:text-white/10 text-white/40 w-10 font-bold text-sm flex items-center justify-center flex-shrink-0 transition-colors"
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
