"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";
import StageBackdrop from "../components/StageBackdrop";
import { ProductThumb } from "../components/ProductImage";
import { TRAINING_CONFIG, TRAINING_GUIDE_EVENTS, calcTrainingPrice, trainingDurationSec } from "../lib/trainingSim";
import { WINNER_PAYMENT_WINDOW_MINUTES } from "../lib/paymentWindow";

// 구매 체험. Visually mirrors app/strategy/page.tsx's live drop screen, but is
// entirely self-contained: every piece of state below is local to this
// component. It never imports useGame(), never touches supabase, and never
// reads/writes game_state, participants, chat_messages, payment, or orders.
// No virtual competitor and no scripted "participant" chat — the user watches
// the price fall, buys whenever they like (or the price reaches the floor),
// and sees what would happen next in a real drop.

function fmt(n: number) {
  return "₩" + n.toLocaleString("ko-KR");
}

type TrainingPhase = "intro" | "running" | "bought" | "floor";

type Guide = { id: string; message: string };

const TICK_MS = 1000;
const COACH_VISIBLE_MS = 1800;

export default function PracticePage() {
  const [phase, setPhase] = useState<TrainingPhase>("intro");
  const [currentPrice, setCurrentPrice] = useState(TRAINING_CONFIG.startPrice);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [myClaimPrice, setMyClaimPrice] = useState<number | null>(null);
  const [tickFlash, setTickFlash] = useState(false);
  const [coachVisible, setCoachVisible] = useState(false);

  const priceRef = useRef(TRAINING_CONFIG.startPrice);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedGuideRef = useRef(new Set<number>());
  const coachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (coachTimerRef.current) clearTimeout(coachTimerRef.current);
  }, []);

  const startTraining = useCallback(() => {
    startedAtRef.current = Date.now();
    priceRef.current = TRAINING_CONFIG.startPrice;
    firedGuideRef.current = new Set();
    setCurrentPrice(TRAINING_CONFIG.startPrice);
    setGuides([]);
    setMyClaimPrice(null);
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
      const price = calcTrainingPrice(elapsedMs);
      priceRef.current = price;
      setCurrentPrice(price);
      setTickFlash(true);
      setTimeout(() => setTickFlash(false), 220);

      const elapsedSec = elapsedMs / 1000;
      for (const evt of TRAINING_GUIDE_EVENTS) {
        if (elapsedSec >= evt.atSec && !firedGuideRef.current.has(evt.atSec)) {
          firedGuideRef.current.add(evt.atSec);
          setGuides((prev) => [...prev, { id: `guide-${evt.atSec}`, message: evt.message }]);
        }
      }

      if (price <= TRAINING_CONFIG.floorPrice) {
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setPhase("floor");
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
    setPhase("bought");
  }, [phase]);

  const start = TRAINING_CONFIG.startPrice;
  const floor = TRAINING_CONFIG.floorPrice;
  const barPct = Math.min(100, Math.max(0, ((start - currentPrice) / (start - floor)) * 100));
  const currentSavings = start - currentPrice;
  const currentSavingsPct = start > 0 ? Math.round((currentSavings / start) * 100) : 0;

  // ── Intro ──────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-20">
        <div className="w-full max-w-md px-4 pt-10">
          <div className="flex mb-5"><HomeButton /></div>
          <div className="mb-8">
            <h1 className="text-[22px] font-extrabold text-white leading-tight">구매 체험</h1>
            <p className="text-white/70 text-base mt-3 leading-relaxed">
              실제 드랍 전에 구매 방법을 체험해 보세요.<br />
              가격 범위는 실제 드랍과 같지만, 체험을 위해 실제보다 빠르게 내려갑니다. 체험에서는 결제되지 않습니다.
            </p>
            <p className="text-white/40 text-xs mt-3">약 {trainingDurationSec()}초 · 실제 결제 없음</p>
          </div>
          <button
            onClick={startTraining}
            className="w-full py-4 text-white font-semibold text-base transition-opacity active:opacity-80 bid-btn-purple rounded-xl"
          >
            체험 시작
          </button>
        </div>
        <BottomNav />
      </main>
    );
  }

  // ── Result screens — what the user did, and what a real drop would do next ──
  if (phase === "bought" || phase === "floor") {
    const bought = phase === "bought";
    return (
      <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-xs text-center">
          <p className="text-xs uppercase tracking-widest text-white/50 mb-2 font-medium">
            {bought ? "구매 확정 (체험)" : "최저가 도달 (체험 종료)"}
          </p>
          <p className="text-xs text-white/45 mb-1">{bought ? "구매 확정 가격" : "최저가"}</p>
          <p
            className="font-extrabold tabular-nums leading-none mb-4"
            style={{ fontSize: "2.6rem", color: "#f5f3ff", textShadow: "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7" }}
          >
            {fmt(bought ? (myClaimPrice ?? 0) : floor)}
          </p>
          <p className="text-white/55 text-sm leading-relaxed mb-8">
            {bought
              ? `실제 드랍이라면 ${WINNER_PAYMENT_WINDOW_MINUTES}분 안에 결제하면 구매가 완료됩니다. 체험에서는 결제되지 않습니다.`
              : "실제 드랍에서는 최저가까지 구매가 없으면 판매 없이 종료됩니다."}
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={startTraining}
              className="w-full py-4 text-white font-semibold text-base transition-opacity active:opacity-80 bid-btn-purple rounded-xl"
            >
              다시 해보기
            </button>
            <Link href="/" className="w-full py-4 font-semibold text-base text-center border border-white/15 text-white/65 rounded-xl">
              예정된 드랍 보기
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
        <StageBackdrop opacity={0.38} />
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(10,10,10,0.78) 0%, rgba(10,10,10,0.50) 38%, rgba(10,10,10,0.85) 100%)" }}
        />
      </div>

      <div className="relative z-10 flex flex-col h-full">

        {/* Top bar — 체험 marker replaces the real LIVE badge/counts,
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
            체험 · 실제 구매되지 않습니다
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

        {/* Guide lines — the service explaining the steps, styled like the
            live drop's narrator lines (no avatars, no participant names). */}
        <div className="flex-shrink-0 px-4 pb-2 space-y-1">
          {guides.map((g) => (
            <p key={g.id} className="text-sm leading-snug text-[#d8b4fe] chat-in">▶ {g.message}</p>
          ))}
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
                background: "#a855f7",
              }}
            />
          </div>

          <button
            onClick={handleClaim}
            className={`relative overflow-hidden w-full flex flex-col items-center justify-center h-[88px] text-white transition-all active:scale-[0.97] rounded-xl bid-btn-purple`}
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
              <span className="text-sm font-extrabold text-white flex items-center gap-1"><span className="material-symbols-outlined" style={{ fontSize: "16px" }}>local_fire_department</span>구매하기</span>
            </div>
          </button>
        </div>

      </div>
    </main>
  );
}
