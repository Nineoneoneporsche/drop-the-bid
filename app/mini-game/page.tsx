"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

/* ── Types ── */
type Phase = "ready" | "countdown" | "waiting" | "go" | "false_start" | "result";

/* ── Leaderboard mock ── */
const LEADERBOARD = [
  { rank: 1, nick: "빠른손가락", ms: 113 },
  { rank: 2, nick: "절대안놓침", ms: 128 },
  { rank: 3, nick: "반응왕",     ms: 141 },
  { rank: 4, nick: "샘플유저",   ms: 153 },
  { rank: 5, nick: "버티는민수", ms: 168 },
];

const RANK_COLORS = ["text-yellow-500", "text-gray-400", "text-amber-600"];

/* ── Helpers ── */
function fmtMs(ms: number) {
  return (ms / 1000).toFixed(3) + "초";
}

function evaluate(ms: number): { label: string; emoji: string; color: string } {
  if (ms < 120) return { label: "신의 손",           emoji: "🏆", color: "text-yellow-500" };
  if (ms < 170) return { label: "프로 낙찰러",       emoji: "⚡", color: "text-orange-500" };
  if (ms < 220) return { label: "상위 10%",          emoji: "🎯", color: "text-orange-400" };
  if (ms < 280) return { label: "평균 이상",         emoji: "👍", color: "text-blue-500"   };
  return           { label: "손가락 워밍업 필요",   emoji: "🌡️", color: "text-gray-400"   };
}

/* ── Leaderboard card ── */
function LeaderboardCard({ userBest }: { userBest: number | null }) {
  const nearTop5 = userBest !== null && userBest < 180;
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span>🏅</span>
        <p className="text-gray-900 font-bold text-sm">오늘의 랭킹</p>
      </div>
      <div className="space-y-3">
        {LEADERBOARD.map((entry) => (
          <div key={entry.rank} className="flex items-center gap-3">
            <span className={`w-5 text-center text-xs font-black ${RANK_COLORS[entry.rank - 1] ?? "text-gray-300"}`}>
              {entry.rank}
            </span>
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-300 to-amber-400 flex items-center justify-center text-[10px] font-black text-white flex-shrink-0">
              {entry.nick[0]}
            </div>
            <span className="flex-1 text-gray-700 text-sm font-medium">{entry.nick}</span>
            <span className="text-orange-500 font-mono text-sm font-bold tabular-nums">{fmtMs(entry.ms)}</span>
          </div>
        ))}
      </div>
      {nearTop5 && (
        <div className="mt-3 bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 text-center">
          <p className="text-orange-500 text-xs font-semibold">랭킹권에 근접했습니다! 🎯</p>
        </div>
      )}
    </div>
  );
}

/* ── Result screen ── */
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
    <div className="space-y-4 success-pop">
      {/* Main result */}
      <div className="bg-white rounded-3xl shadow-sm border border-orange-100 p-6 text-center">
        <div className="text-5xl mb-3">{ev.emoji}</div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">성공!</h2>

        <div
          className="font-black tabular-nums font-mono text-orange-500"
          style={{ fontSize: "3rem", lineHeight: 1 }}
        >
          {fmtMs(ms)}
        </div>
        <p className={`text-sm font-bold mt-2 ${ev.color}`}>{ev.label}</p>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mt-5">
          {[
            ["최고 기록", best !== null ? fmtMs(best) : "-"],
            ["평균",      avg  !== null ? fmtMs(avg)  : "-"],
            ["시도 횟수", `${attempts}회`],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-50 rounded-2xl p-3">
              <p className="text-gray-400 text-[10px] mb-1">{label}</p>
              <p className="text-gray-900 text-xs font-bold font-mono">{val}</p>
            </div>
          ))}
        </div>
      </div>

      <LeaderboardCard userBest={best} />

      <div className="flex flex-col gap-3">
        <button
          onClick={onRetry}
          className="w-full py-4 rounded-2xl text-white font-bold text-base active:scale-[0.98] transition-transform shadow-md"
          style={{
            background: "linear-gradient(135deg,#fb923c,#f97316)",
            boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
          }}
        >
          다시 도전
        </button>
        <Link
          href="/"
          className="w-full py-4 rounded-2xl font-bold text-base text-center border-2 border-orange-200 text-orange-500 bg-white active:scale-[0.98] transition-transform"
        >
          오늘의 DTB 보기
        </Link>
      </div>
    </div>
  );
}

/* ── Main page ── */
export default function MiniGamePage() {
  const [phase,        setPhase]        = useState<Phase>("ready");
  const [countNum,     setCountNum]     = useState(3);
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [bestTime,     setBestTime]     = useState<number | null>(null);
  const [totalTime,    setTotalTime]    = useState(0);
  const [attempts,     setAttempts]     = useState(0);

  /* Refs to avoid stale closures */
  const phaseRef  = useRef<Phase>("ready");
  const startRef  = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAll = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  /* Cleanup on unmount */
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

    /* Random go-delay: 1.5–4s after countdown ends */
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
    <main className="min-h-screen bg-[#fffbf5] flex flex-col items-center pb-28">
      <div className="w-full max-w-md px-4 pt-10">

        <div className="flex mb-4">
          <HomeButton />
        </div>

        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-2xl font-black text-gray-900 mb-1">낙찰 훈련소</h1>
          <p className="text-orange-500 font-semibold text-sm">가장 빠른 손가락만 살아남습니다.</p>
          <p className="text-gray-400 text-sm mt-1">실전 낙찰에 대비해 반응속도를 훈련해보세요.</p>
        </div>

        {/* ═══ READY ═══ */}
        {phase === "ready" && (
          <div className="space-y-4">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 text-center">
              <div className="text-6xl mb-4">⚡</div>
              <h2 className="text-xl font-black text-gray-900 mb-2">반응속도 테스트</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-6">
                버튼이 나타나면 최대한 빨리 누르세요.<br />
                단, 너무 일찍 누르면 실패입니다.
              </p>
              <button
                onClick={startRound}
                className="w-full py-4 rounded-2xl text-white font-bold text-base active:scale-[0.98] transition-transform shadow-md"
                style={{
                  background: "linear-gradient(135deg,#fb923c,#f97316)",
                  boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
                }}
              >
                훈련 시작
              </button>
            </div>
            <LeaderboardCard userBest={bestTime} />
          </div>
        )}

        {/* ═══ COUNTDOWN ═══ */}
        {phase === "countdown" && (
          <div
            className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden select-none"
            onPointerDown={handleFalseStart}
          >
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-8">
                집중하세요
              </p>
              <div
                key={countNum}
                className="font-black text-orange-500 winner-pop tabular-nums"
                style={{ fontSize: "9rem", lineHeight: 1 }}
              >
                {countNum}
              </div>
            </div>
            <div className="px-6 pb-6">
              <div className="bg-amber-50 border border-amber-100 rounded-2xl py-3 text-center">
                <p className="text-amber-600 text-xs font-bold">아직 누르지 마세요</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ WAITING ═══ */}
        {phase === "waiting" && (
          <div
            className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden select-none"
            onPointerDown={handleFalseStart}
          >
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <div className="flex gap-2 mb-8">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-3 h-3 rounded-full bg-orange-300 animate-bounce"
                    style={{ animationDelay: `${i * 0.18}s` }}
                  />
                ))}
              </div>
              <p className="text-gray-900 text-2xl font-black mb-2">기다리세요...</p>
              <p className="text-gray-400 text-sm">버튼이 곧 나타납니다</p>
            </div>
            <div className="px-6 pb-6">
              <div className="bg-amber-50 border border-amber-100 rounded-2xl py-3 text-center">
                <p className="text-amber-600 text-xs font-bold">아직 누르지 마세요</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ GO ═══ */}
        {phase === "go" && (
          <div className="flex flex-col items-center pt-6 pb-4">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-10">
              지금 누르세요!
            </p>
            <button
              onPointerDown={handleGoPress}
              className="w-60 h-60 rounded-full text-white font-black text-2xl leading-tight select-none"
              style={{
                background: "linear-gradient(135deg,#fb923c,#f97316)",
                animation: "go-pulse 0.8s ease-in-out infinite",
                touchAction: "manipulation",
              }}
            >
              🔥<br />낙찰받기
            </button>
          </div>
        )}

        {/* ═══ FALSE START ═══ */}
        {phase === "false_start" && (
          <div className="bg-white rounded-3xl shadow-sm border border-amber-200 p-6 text-center">
            <div className="text-5xl mb-3">🙈</div>
            <h2 className="text-xl font-black text-gray-900 mb-1">성급했습니다!</h2>
            <p className="text-gray-500 text-sm mb-1">
              낙찰 버튼이 나오기 전에 누르면 실패입니다.
            </p>
            <p className="text-gray-400 text-xs mb-6">
              버튼이 나타날 때까지 침착하게 기다리세요.
            </p>
            <button
              onClick={startRound}
              className="w-full py-4 rounded-2xl text-white font-bold text-base active:scale-[0.98] transition-transform shadow-md"
              style={{
                background: "linear-gradient(135deg,#fb923c,#f97316)",
                boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
              }}
            >
              다시 도전
            </button>
          </div>
        )}

        {/* ═══ RESULT ═══ */}
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
