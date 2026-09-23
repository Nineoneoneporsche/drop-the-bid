"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";
import { ProductThumb } from "../components/ProductImage";
import {
  TRAINING_CONFIG,
  TRAINING_CHAT_EVENTS,
  calcTrainingPriceAndStage,
  pickScenario,
  pickCompetitorClaimPrice,
  type TrainingDropStage,
} from "../lib/trainingSim";

// Training Mode. Visually mirrors app/strategy/page.tsx's live game-phase
// screen as closely as possible, but is entirely self-contained: every piece
// of state below is local to this component. It never imports useGame(),
// never touches supabase, and never reads/writes game_state, participants,
// chat_messages, payment, or orders. See app/lib/trainingSim.ts for the
// (also fully local) price + competitor simulation this drives off of.

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

type TrainingPhase = "intro" | "running" | "success" | "fail";

type Chat = { id: string; nickname: string; message: string };

const TICK_MS = 1000;
const COACH_VISIBLE_MS = 1800;

export default function PracticePage() {
  const [phase, setPhase] = useState<TrainingPhase>("intro");
  const [currentPrice, setCurrentPrice] = useState(TRAINING_CONFIG.startPrice);
  const [dropStage, setDropStage] = useState<TrainingDropStage>("normal");
  const [chatMessages, setChatMessages] = useState<Chat[]>([]);
  const [myClaimPrice, setMyClaimPrice] = useState<number | null>(null);
  const [competitorPrice, setCompetitorPrice] = useState<number | null>(null);
  const [tickFlash, setTickFlash] = useState(false);
  const [coachVisible, setCoachVisible] = useState(false);

  const priceRef = useRef(TRAINING_CONFIG.startPrice);
  const claimPriceRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedChatRef = useRef(new Set<number>());
  const coachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // DROP ZONE entry sweep — same visual pattern as /strategy: fires once per
  // NORMAL→FAST / FAST→FINAL transition.
  const [zoneSweepKey, setZoneSweepKey] = useState(0);
  const [showZoneSweep, setShowZoneSweep] = useState(false);
  const prevDropStageRef = useRef<TrainingDropStage>("normal");
  const zoneSweepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevDropStageRef.current;
    prevDropStageRef.current = dropStage;
    if (phase !== "running" || prev === dropStage || dropStage === "normal") return;
    setZoneSweepKey((k) => k + 1);
    setShowZoneSweep(true);
    if (zoneSweepTimerRef.current) clearTimeout(zoneSweepTimerRef.current);
    zoneSweepTimerRef.current = setTimeout(() => setShowZoneSweep(false), 2300);
  }, [dropStage, phase]);

  useEffect(() => () => {
    if (zoneSweepTimerRef.current) clearTimeout(zoneSweepTimerRef.current);
    if (coachTimerRef.current) clearTimeout(coachTimerRef.current);
  }, []);

  const startTraining = useCallback(() => {
    claimPriceRef.current = pickCompetitorClaimPrice(pickScenario());
    startedAtRef.current = Date.now();
    priceRef.current = TRAINING_CONFIG.startPrice;
    firedChatRef.current = new Set();
    prevDropStageRef.current = "normal";
    setCurrentPrice(TRAINING_CONFIG.startPrice);
    setDropStage("normal");
    setChatMessages([]);
    setMyClaimPrice(null);
    setCompetitorPrice(null);
    setShowZoneSweep(false);
    setPhase("running");

    // First-run coach message — fades out on its own, never shown again once
    // the price has actually started moving.
    setCoachVisible(true);
    if (coachTimerRef.current) clearTimeout(coachTimerRef.current);
    coachTimerRef.current = setTimeout(() => setCoachVisible(false), COACH_VISIBLE_MS);
  }, []);

  // Local price tick — reads only app/lib/trainingSim.ts, never GameContext.
  useEffect(() => {
    if (phase !== "running" || !startedAtRef.current) return;

    const tick = () => {
      const elapsedMs = Date.now() - startedAtRef.current!;
      const { price, stage } = calcTrainingPriceAndStage(elapsedMs);
      priceRef.current = price;
      setCurrentPrice(price);
      setDropStage(stage);
      setTickFlash(true);
      setTimeout(() => setTickFlash(false), 220);

      const elapsedSec = elapsedMs / 1000;
      for (const evt of TRAINING_CHAT_EVENTS) {
        if (elapsedSec >= evt.atSec && !firedChatRef.current.has(evt.atSec)) {
          firedChatRef.current.add(evt.atSec);
          setChatMessages((prev) => [...prev, { id: `chat-${evt.atSec}`, nickname: evt.nickname, message: evt.message }]);
        }
      }

      const claimPrice = claimPriceRef.current;
      if (price <= claimPrice || price <= TRAINING_CONFIG.floorPrice) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setCompetitorPrice(Math.min(claimPrice, price));
        setPhase("fail");
      }
    };

    // No immediate tick() here — startTraining() already set currentPrice to
    // the exact start price, so the screen holds it precisely until the
    // first real interval fire, instead of showing a few-milliseconds'
    // worth of fractional drop the instant the round begins.
    tickRef.current = setInterval(tick, TICK_MS);
    return () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };
  }, [phase]);

  const handleClaim = useCallback(() => {
    if (phase !== "running") return;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setMyClaimPrice(priceRef.current);
    setPhase("success");
  }, [phase]);

  const start = TRAINING_CONFIG.startPrice;
  const floor = TRAINING_CONFIG.floorPrice;
  const barPct = Math.min(100, Math.max(0, ((start - currentPrice) / (start - floor)) * 100));
  const pct = start > 0 ? (currentPrice / start) * 100 : 0;
  const isLow = pct < 50;
  const isCritical = pct < 30;
  const currentSavings = start - currentPrice;
  const currentSavingsPct = start > 0 ? Math.round((currentSavings / start) * 100) : 0;

  // ── Intro ──────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-20">
        <div className="w-full max-w-md px-4 pt-10">
          <div className="flex mb-5"><HomeButton /></div>
          <div className="mb-8">
            <h1 className="text-[22px] font-extrabold text-white leading-tight">모의훈련</h1>
            <p className="text-white/70 text-base mt-3 leading-relaxed">
              실전 전에 한 번 연습해보세요.<br />
              실제 경매와 동일하게 가격이 내려갑니다. 연습에서는 결제되지 않습니다.
            </p>
            <p className="text-white/40 text-xs mt-3">약 15초 · 실제 결제 없음</p>
          </div>
          <button
            onClick={startTraining}
            className="w-full py-4 text-white font-semibold text-base transition-opacity active:opacity-80 bid-btn-purple rounded-xl"
          >
            훈련 시작
          </button>
        </div>
        <BottomNav />
      </main>
    );
  }

  // ── Result screens (success / fail) — fast, no winner video/LED sequence ──
  if (phase === "success" || phase === "fail") {
    const isSuccess = phase === "success";
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-xs text-center">
          <p className="text-xs uppercase tracking-widest text-white/50 mb-2 font-medium">
            {isSuccess ? "낙찰 성공" : "한발 늦었습니다"}
          </p>
          <p className="text-xs text-white/45 mb-1">{isSuccess ? "내가 누른 가격" : "경쟁자가 낙찰한 가격"}</p>
          <p
            className="font-extrabold tabular-nums leading-none mb-8"
            style={{ fontSize: "2.6rem", color: "#f5f3ff", textShadow: "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7" }}
          >
            {fmt(isSuccess ? (myClaimPrice ?? 0) : (competitorPrice ?? 0))}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={startTraining}
              className="w-full py-4 text-white font-semibold text-base transition-opacity active:opacity-80 bid-btn-purple rounded-xl"
            >
              다시 해보기
            </button>
            <Link href="/" className="w-full py-4 font-semibold text-base text-center border border-white/15 text-white/65 rounded-xl">
              실전 경매 보러가기
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── Running — mirrors /strategy's game-phase screen ──────────────────────
  return (
    <main className="fixed inset-x-0 top-0 h-dvh bg-[#0a0a0a] max-w-md mx-auto overflow-hidden flex flex-col">

      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <video autoPlay loop muted playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.38 }}
        >
          <source src="/gamepagevideo.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(10,10,10,0.78) 0%, rgba(10,10,10,0.50) 38%, rgba(10,10,10,0.85) 100%)" }}
        />
      </div>

      {showZoneSweep && (
        <div key={`zone-${zoneSweepKey}`} className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none overflow-hidden">
          <img
            src="/dtblogowhite.PNG"
            alt=""
            className="zone-sweep"
            style={{
              width: 320,
              height: "auto",
              filter: "drop-shadow(0 0 10px rgba(168,85,247,0.85)) drop-shadow(0 0 24px rgba(139,92,246,0.5))",
            }}
          />
        </div>
      )}

      <div className="relative z-10 flex flex-col h-full">

        {/* Top bar — TRAINING marker replaces the real LIVE badge/counts,
            merged into a single compact chip so it reads but doesn't shout. */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-10 pb-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center w-8 h-8 text-white transition-colors"
            aria-label="메인화면"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
              <polyline points="9 21 9 12 15 12 15 21"/>
            </svg>
          </Link>
          <div className="w-px h-3.5 bg-white/15 flex-shrink-0" />
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full"
            style={{ color: "rgba(196,132,252,0.9)", background: "rgba(168,85,247,0.12)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#c084fc" }} />
            TRAINING · 실제 구매되지 않습니다
          </span>
        </div>

        {/* Product info */}
        <div className="flex-shrink-0 px-4 pt-2 pb-2">
          <div className="h-px bg-white/8 mb-2" />
          <div className="flex items-center gap-3">
            <ProductThumb alt={TRAINING_CONFIG.productName} size={44} rounded="rounded-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-white/90 text-base font-semibold leading-snug line-clamp-1">
                {TRAINING_CONFIG.productName}
              </p>
              <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: "#c084fc" }}>정가 {fmt(start)}</p>
            </div>
          </div>
        </div>

        {/* Empty stage — lets the DJ background actually read as a scene
            instead of being squeezed behind other elements. */}
        <div className="flex-1" />

        {/* Scripted, read-only chat — same bubble style as /strategy, anchored
            just above the CTA instead of pinned to the top. Only ever 2-3
            lines, so no scroll container needed. */}
        <div className="flex-shrink-0 px-4 pb-2">
          {chatMessages.map((msg) => {
            const avatarColor = `hsl(${(msg.nickname.charCodeAt(0) * 37) % 360}, 55%, 52%)`;
            return (
              <div key={msg.id} className="flex items-start gap-2 py-0.5 chat-in">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-extrabold text-white mt-0.5"
                  style={{ background: avatarColor }}
                >
                  {msg.nickname[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold mr-1.5" style={{ color: "rgba(255,255,255,0.9)" }}>{msg.nickname}</span>
                  <p className="text-sm leading-snug mt-0.5 text-white/95">{msg.message}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress bar + bid button — the screen's primary element */}
        <div className="relative flex-shrink-0 px-4 pt-2 pb-9">
          {/* First-run coach message — connects directly to the CTA it explains,
              fades out on its own after COACH_VISIBLE_MS. */}
          <div
            className="absolute bottom-full inset-x-0 mb-3 flex justify-center pointer-events-none transition-opacity duration-500"
            style={{ opacity: coachVisible ? 1 : 0 }}
          >
            <div className="px-4 py-2 rounded-xl text-center" style={{ background: "rgba(10,10,10,0.6)" }}>
              <p className="text-xs text-white/85 leading-snug">가격은 계속 내려갑니다.<br />원하는 순간 누르세요.</p>
            </div>
          </div>

          <div className="h-px bg-white/8 w-full overflow-hidden rounded-full mb-3">
            <div
              className="h-full transition-all duration-1000 rounded-full"
              style={{
                width: `${barPct}%`,
                background: isCritical ? "#ef4444" : isLow ? "linear-gradient(90deg, #a855f7, #ef4444)" : "#a855f7",
              }}
            />
          </div>

          <button
            onClick={handleClaim}
            className={`relative overflow-hidden w-full flex flex-col items-center justify-center h-[88px] text-white transition-all active:scale-[0.97] rounded-xl ${isCritical ? "bid-btn-critical critical-shake" : "bid-btn-purple"}`}
          >
            <div
              className="bid-shimmer absolute inset-y-0 w-[40%] pointer-events-none"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.13), transparent)" }}
            />
            <span
              className={`font-extrabold tabular-nums leading-none ${tickFlash ? "price-tick" : ""}`}
              style={{ fontSize: "2.4rem", letterSpacing: "-0.02em" }}
            >
              {fmt(currentPrice)}
            </span>
            <div className={`flex items-center gap-2 mt-1 transition-opacity duration-300 ${currentSavings > 0 ? "opacity-100" : "opacity-0"}`}>
              <span className="text-[11px] font-semibold text-white">-{currentSavingsPct}% · {fmt(currentSavings)} 절약</span>
              <span className="text-sm font-extrabold text-white flex items-center gap-1"><span className="material-symbols-outlined" style={{ fontSize: "16px" }}>local_fire_department</span>낙찰받기</span>
            </div>
          </button>
        </div>

      </div>
    </main>
  );
}
