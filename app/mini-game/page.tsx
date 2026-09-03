"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

type Phase = "ready" | "countdown" | "waiting" | "go" | "false_start" | "result";

const LEADERBOARD = [
  { rank: 1, nick: "빠른손가락", ms: 113 },
  { rank: 2, nick: "절대안놓침", ms: 128 },
  { rank: 3, nick: "반응왕",     ms: 141 },
  { rank: 4, nick: "샘플유저",   ms: 153 },
  { rank: 5, nick: "버티는민수", ms: 168 },
];

const RANK_LABEL = ["🥇", "🥈", "🥉"];

function fmtMs(ms: number) {
  return (ms / 1000).toFixed(3) + "초";
}

function evaluate(ms: number): { label: string; color: string } {
  if (ms < 120) return { label: "신의 손",           color: "text-yellow-400" };
  if (ms < 170) return { label: "프로 낙찰러",       color: "text-[#c084fc]"  };
  if (ms < 220) return { label: "상위 10%",          color: "text-[#a855f7]"  };
  if (ms < 280) return { label: "평균 이상",         color: "text-blue-400"   };
  return           { label: "손가락 워밍업 필요",   color: "text-white/60"   };
}

function Leaderboard({ userBest }: { userBest: number | null }) {
  const nearTop5 = userBest !== null && userBest < 180;
  return (
    <div className="bg-[#141414] border border-white/15">
      <div className="px-4 py-3 border-b border-white/15">
        <p className="text-xs uppercase tracking-[0.12em] text-white/60 font-medium">오늘의 랭킹</p>
      </div>
      <div>
        {LEADERBOARD.map((entry, i) => (
          <div key={entry.rank} className={`flex items-center gap-3 px-4 py-3 ${i < LEADERBOARD.length - 1 ? "border-b border-white/12" : ""}`}>
            <span className="w-5 text-center text-xs font-black text-white/65">{RANK_LABEL[i] ?? entry.rank}</span>
            <span className="flex-1 text-white/80 text-sm font-medium">{entry.nick}</span>
            <span className="font-mono text-sm font-bold tabular-nums" style={{ color: "#4ade80" }}>{fmtMs(entry.ms)}</span>
          </div>
        ))}
      </div>
      {nearTop5 && (
        <div className="px-4 py-2.5 border-t border-[#4ade80]/20 bg-[#4ade80]/8">
          <p className="text-xs font-semibold text-center" style={{ color: "#4ade80" }}>랭킹권에 근접했습니다! 🎯</p>
        </div>
      )}
    </div>
  );
}

function ResultScreen({
  ms, best, avg, attempts, onRetry,
}: {
  ms: number;
  best: number | null;
  avg: number | null;
  attempts: number;
  onRetry: () => void;
}) {
  const ev = evaluate(ms);
  return (
    <div className="space-y-3 success-pop">
      <div className="bg-[#141414] border border-white/15 px-5 py-6 text-center">
        <p className="text-xs uppercase tracking-[0.12em] text-white/60 font-medium mb-3">반응속도 측정 결과</p>
        <div
          className="font-black tabular-nums font-mono leading-none mb-1"
          style={{ fontSize: "3.5rem", color: "#c084fc" }}
        >
          {fmtMs(ms)}
        </div>
        <p className={`text-sm font-bold ${ev.color}`}>{ev.label}</p>

        <div className="grid grid-cols-3 gap-px mt-5 border border-white/15">
          {[
            ["최고 기록", best !== null ? fmtMs(best) : "-"],
            ["평균",      avg  !== null ? fmtMs(avg)  : "-"],
            ["시도 횟수", `${attempts}회`],
          ].map(([label, val]) => (
            <div key={label} className="bg-white/5 py-3 text-center">
              <p className="text-white/60 text-xs mb-1">{label}</p>
              <p className="text-white/85 text-xs font-bold font-mono">{val}</p>
            </div>
          ))}
        </div>
      </div>

      <Leaderboard userBest={best} />

      <div className="flex flex-col gap-2">
        <button
          onClick={onRetry}
          className="w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80 bid-btn-purple"
        >
          다시 도전
        </button>
        <Link
          href="/"
          className="w-full py-4 font-bold text-base text-center border border-white/18 text-white/65"
        >
          오늘의 DTB 보기
        </Link>
      </div>
    </div>
  );
}

export default function MiniGamePage() {
  const [phase,        setPhase]        = useState<Phase>("ready");
  const [countNum,     setCountNum]     = useState(3);
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [bestTime,     setBestTime]     = useState<number | null>(null);
  const [totalTime,    setTotalTime]    = useState(0);
  const [attempts,     setAttempts]     = useState(0);

  const phaseRef  = useRef<Phase>("ready");
  const startRef  = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAll = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearAll(), [clearAll]);

  const startRound = useCallback(() => {
    clearAll();
    phaseRef.current = "countdown";
    setCountNum(3);
    setReactionTime(null);
    setPhase("countdown");

    const push = (fn: () => void, ms: number) =>
      timersRef.current.push(setTimeout(fn, ms));

    push(() => setCountNum(2), 700);
    push(() => setCountNum(1), 1_400);
    push(() => {
      phaseRef.current = "waiting";
      setPhase("waiting");
    }, 2_100);

    const goAt = 2_100 + 1_500 + Math.random() * 2_500;
    push(() => {
      if (phaseRef.current !== "waiting") return;
      phaseRef.current = "go";
      startRef.current = performance.now();
      setPhase("go");
    }, goAt);
  }, [clearAll]);

  const handleFalseStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (phaseRef.current !== "countdown" && phaseRef.current !== "waiting") return;
    clearAll();
    phaseRef.current = "false_start";
    setPhase("false_start");
  }, [clearAll]);

  const handleGoPress = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (phaseRef.current !== "go") return;
    const elapsed = Math.round(performance.now() - startRef.current);
    phaseRef.current = "result";
    setPhase("result");
    setReactionTime(elapsed);
    setAttempts((a) => a + 1);
    setTotalTime((t) => t + elapsed);
    setBestTime((b) => (b === null ? elapsed : Math.min(b, elapsed)));
  }, []);

  const avgTime = attempts > 0 ? Math.round(totalTime / attempts) : null;

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-4">
          <HomeButton />
        </div>

        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.12em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-[22px] font-black text-white leading-tight">낙찰 훈련소</h1>
          <p className="text-base font-semibold mt-1.5" style={{ color: "#4ade80" }}>가장 빠른 손가락만 살아남습니다.</p>
        </div>

        {/* READY */}
        {phase === "ready" && (
          <div className="space-y-3">
            <div className="bg-[#141414] border border-white/15 px-5 py-6 text-center">
              <div className="mb-4"><span className="material-symbols-outlined" style={{fontSize:"3rem"}}>bolt</span></div>
              <h2 className="text-lg font-black text-white mb-2">반응속도 테스트</h2>
              <p className="text-white/65 text-sm leading-relaxed mb-6">
                버튼이 나타나면 최대한 빨리 누르세요.<br />
                단, 너무 일찍 누르면 실패입니다.
              </p>
              <button
                onClick={startRound}
                className="w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80 bid-btn-purple"
              >
                훈련 시작
              </button>
            </div>
            <Leaderboard userBest={bestTime} />
          </div>
        )}

        {/* COUNTDOWN */}
        {phase === "countdown" && (
          <div
            className="bg-[#141414] border border-white/15 overflow-hidden select-none"
            onPointerDown={handleFalseStart}
          >
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <p className="text-[10px] uppercase tracking-widest text-white/55 font-medium mb-8">집중하세요</p>
              <div
                key={countNum}
                className="font-black winner-pop tabular-nums"
                style={{ fontSize: "9rem", lineHeight: 1, color: "#c084fc" }}
              >
                {countNum}
              </div>
            </div>
            <div className="px-6 pb-5">
              <div className="px-4 py-3 text-center" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)" }}>
                <p className="text-xs font-bold" style={{ color: "#a855f7" }}>아직 누르지 마세요</p>
              </div>
            </div>
          </div>
        )}

        {/* WAITING */}
        {phase === "waiting" && (
          <div
            className="bg-[#141414] border border-white/15 overflow-hidden select-none"
            onPointerDown={handleFalseStart}
          >
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <div className="flex gap-2 mb-8">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full animate-bounce"
                    style={{ background: "#a855f7", animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </div>
              <p className="text-white text-2xl font-black mb-2">기다리세요...</p>
              <p className="text-white/65 text-sm">버튼이 곧 나타납니다</p>
            </div>
            <div className="px-6 pb-5">
              <div className="px-4 py-3 text-center" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)" }}>
                <p className="text-xs font-bold" style={{ color: "#a855f7" }}>아직 누르지 마세요</p>
              </div>
            </div>
          </div>
        )}

        {/* GO */}
        {phase === "go" && (
          <div className="flex flex-col items-center pt-6 pb-4">
            <p className="text-[10px] uppercase tracking-widest text-white/60 font-medium mb-10">지금 누르세요!</p>
            <button
              onPointerDown={handleGoPress}
              className="w-60 h-60 rounded-full text-white font-black text-2xl leading-tight select-none bid-btn-purple"
              style={{ touchAction: "manipulation" }}
            >
              <span className="material-symbols-outlined" style={{fontSize:"2.5rem",display:"block",marginBottom:"6px"}}>local_fire_department</span>낙찰받기
            </button>
          </div>
        )}

        {/* FALSE START */}
        {phase === "false_start" && (
          <div className="bg-[#141414] border border-red-500/30 px-6 py-8 text-center">
            <div className="mb-3"><span className="material-symbols-outlined" style={{fontSize:"3rem"}}>do_not_touch</span></div>
            <h2 className="text-lg font-black text-white mb-1">성급했습니다!</h2>
            <p className="text-white/70 text-sm mb-1">낙찰 버튼이 나오기 전에 누르면 실패입니다.</p>
            <p className="text-white/60 text-xs mb-6">버튼이 나타날 때까지 침착하게 기다리세요.</p>
            <button
              onClick={startRound}
              className="w-full py-4 text-white font-bold text-base transition-opacity active:opacity-80 bid-btn-purple"
            >
              다시 도전
            </button>
          </div>
        )}

        {/* RESULT */}
        {phase === "result" && reactionTime !== null && (
          <ResultScreen
            ms={reactionTime}
            best={bestTime}
            avg={avgTime}
            attempts={attempts}
            onRetry={startRound}
          />
        )}
      </div>

      <BottomNav />
    </main>
  );
}
