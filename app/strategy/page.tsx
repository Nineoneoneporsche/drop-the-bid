"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  useGame,
  formatKRW,
  formatTime,
  MOCK_PARTICIPANT_COUNT,
  MOCK_SPECTATOR_COUNT,
} from "../context/GameContext";
import { ProductThumb } from "../components/ProductImage";
import RightActionMenu from "../components/RightActionMenu";
import HomeButton from "../components/HomeButton";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Pre-game lounge messages ─────────────────────────────────────────────────
const LOUNGE_MESSAGES: { nickname: string; message: string }[] = [
  { nickname: "쇼핑고수",    message: "드디어 시작이네요 🎉" },
  { nickname: "라이브팬",    message: "오늘 기대 많이 됩니다!" },
  { nickname: "득템요정",    message: "이거 꼭 갖고 싶었어요!" },
  { nickname: "설레는밤",    message: "두근두근 떨려요" },
  { nickname: "행운아123",   message: "드디어!" },
  { nickname: "기다렸다",    message: "기다렸던 라이브예요 ㅎㅎ" },
  { nickname: "운좋을듯",    message: "오늘 운 좋을 것 같아요!" },
  { nickname: "happy_live",  message: "설레네요 진짜로" },
  { nickname: "라이브킹",    message: "오오오 시작한다!" },
  { nickname: "알람설정완료", message: "이거 보려고 알람 맞춰뒀어요" },
  { nickname: "드디어왔다",  message: "드디어 왔네요 ㅋㅋ" },
  { nickname: "꼭가져간다",  message: "오늘 꼭 가져갑니다!" },
  { nickname: "짜릿해요",    message: "짜릿하다~" },
  { nickname: "설거지중달려옴", message: "라이브 켜놓고 설거지 하다 달려왔어요 ㅋㅋ" },
  { nickname: "느낌좋아",    message: "오늘 뭔가 될 것 같은 느낌적 느낌" },
  { nickname: "빨리빨리",    message: "빨리 시작하죠" },
  { nickname: "언제해요",    message: "언제 시작해요?" },
  { nickname: "1분이영원",   message: "1분이 이렇게 길 줄이야" },
  { nickname: "내려가라",    message: "얼른 가격 내려가라" },
  { nickname: "초조해요",    message: "초조하네요" },
  { nickname: "기다리기힘들어", message: "기다리는 거 힘들다" },
  { nickname: "와이파이확인3회", message: "와이파이 확인 3번 함 ㅋㅋ" },
  { nickname: "배터리100",   message: "폰 배터리 100% 충전하고 왔어요 ㅋ" },
  { nickname: "준비운동중",  message: "손가락 준비운동 중입니다 ㅋㅋ" },
  { nickname: "좋은가격나올듯", message: "오늘 좋은 가격 나올 것 같아요" },
  { nickname: "분위기좋다",  message: "오늘 분위기 좋네요" },
  { nickname: "같이즐겨요",  message: "다같이 즐겨봐요 ㅎㅎ" },
  { nickname: "화이팅123",   message: "다들 화이팅이에요!" },
  { nickname: "얼마까지갈까", message: "이거 어디까지 내려갈까요" },
  { nickname: "신중하게",    message: "신중하게 가야죠" },
  { nickname: "타이밍중요",  message: "타이밍이 중요하겠네요" },
  { nickname: "처음이에요ㅋ", message: "ㅋㅋㅋㅋ 오늘 처음 해봅니다" },
  { nickname: "채팅재밌다",  message: "채팅창 은근 재밌네요 ㅋㅋ" },
  { nickname: "숨참는중",    message: "다들 숨참고 계시는 거 알아요 ㅋㅋ" },
  { nickname: "심장입으로",  message: "심장이 입으로 나올 것 같아 ㅋㅋ" },
  { nickname: "아이아빠",    message: "아이가 좋아할 것 같아요" },
  { nickname: "딸맘",        message: "딸이 엄청 갖고 싶어 했어요" },
  { nickname: "아이패드팬",  message: "아이가 iPad 갖고 싶다고 해서 왔어요" },
  { nickname: "아이선물",    message: "아이한테 서프라이즈로 주고 싶어요" },
  { nickname: "솔직히비싸",  message: "89만원이면 솔직히 비싸긴 하죠" },
  { nickname: "55만되면바로", message: "55만원 나오면 바로요 ㅋ" },
  { nickname: "최저가도전",  message: "최저가 도전 중" },
  { nickname: "가성비파",    message: "가성비 파라 부릅니다" },
  { nickname: "아이패드탐나", message: "iPad Air 진짜 탐나네요" },
  { nickname: "오늘첫도전",  message: "처음이라 긴장되네요" },
  { nickname: "첫참여자",    message: "첫 참여입니다 잘 부탁드려요" },
  { nickname: "사람많다",    message: "생각보다 사람 많네요" },
  { nickname: "신기한쇼핑",  message: "신기한 쇼핑 방식이네요" },
  { nickname: "재밌네요",    message: "이거 생각보다 재밌어요" },
  { nickname: "구경꾼99",    message: "구경만 하다 채팅 합니다 ㅋ" },
  { nickname: "라이브러버",  message: "라이브 쇼핑 너무 좋아요" },
];

// ── In-game chat events (price threshold) ────────────────────────────────────
const CHAT_EVENTS = [
  { threshold: 97, nickname: "버티기대장", message: "자 오늘 목표가 얼마까지예요? 저는 최소 70만원까지는 버텨볼 거예요" },
  { threshold: 95, nickname: "신중한민수", message: "저는 75만원 선을 생각하고 있어요. 거기까지면 꽤 좋은 가격이죠" },
  { threshold: 93, nickname: "빠른손99",   message: "솔직히 80만원에 눌러도 이미 괜찮지 않나요? 11% 할인인데..." },
  { threshold: 91, nickname: "버티기대장", message: "80만원은 너무 아까워요. 다 같이 버티면 분명히 더 내려가요. 조금만 참아요" },
  { threshold: 89, nickname: "구경꾼A",    message: "이 채팅방 분위기 보니까 오늘은 꽤 내려갈 것 같은데요" },
  { threshold: 87, nickname: "의심많은B",  message: "근데 채팅 안 하는 사람들이 더 많잖아요. 그 사람들이 제일 무서운 거 아닌가요" },
  { threshold: 85, nickname: "신중한민수", message: "맞아요... 저 포함해서 몇 명이 조용히 버티고 있는지 감도 안 와요" },
  { threshold: 83, nickname: "버티기대장", message: "괜찮아요, 다들 믿어봐요. 여기서 흔들리면 안 돼요. 아직 한참 남았어요" },
  { threshold: 81, nickname: "빠른손99",   message: "저는 믿는데... 근데 손이 벌써 조금씩 가고 있어요 ㅎ" },
  { threshold: 79, nickname: "버티기대장", message: "드디어 71만원 밑으로 떨어졌어요! 여기서 누르는 사람은 없겠죠?" },
  { threshold: 78, nickname: "구경꾼A",    message: "20% 할인에도 아무도 안 눌렀네요. 오늘 단합력 진짜 대단한데요" },
  { threshold: 76, nickname: "의심많은B",  message: "단합력이라고 하기엔... 지금 이 순간에도 손가락 화면 위에 올려놓은 사람 있을 것 같은데요" },
  { threshold: 74, nickname: "신중한민수", message: "지금 정확히 몇 퍼센트 할인인지 계산하기 귀찮아서요. 아시는 분 계세요?" },
  { threshold: 72, nickname: "빠른손99",   message: "28% 할인이에요. 근데 솔직히 이 가격도 이미 충분하지 않나요? 저만 그런가요" },
  { threshold: 70, nickname: "버티기대장", message: "충분하지 않아요!! 63만원까지는 같이 가봐요. 거기서 30% 할인이에요!" },
  { threshold: 68, nickname: "의심많은B",  message: "다들 진짜 안 눌렀어요? 솔직하게요. 저만 혼자 버티고 있는 건 아니죠?" },
  { threshold: 67, nickname: "구경꾼A",    message: "이 타이밍에 먼저 누르는 사람... 뭐라 하진 않겠지만 오래 기억할 것 같아요" },
  { threshold: 66, nickname: "빠른손99",   message: "저 솔직히 말할게요. 지금 거의 한계예요. 이 가격 진짜 좋잖아요..." },
  { threshold: 65, nickname: "버티기대장", message: "제발요ㅠ 조금만 더요. 58만원까지만! 거기서 35% 할인이에요" },
  { threshold: 64, nickname: "신중한민수", message: "저도 손이 떨려요. 이게 심리전이구나 처음 실감하네요. 일단 버텨볼게요" },
  { threshold: 63, nickname: "의심많은B",  message: "느낌이 이상해요. 누군가 아무 말 없이 조용히 누르려고 준비 중인 것 같아요" },
  { threshold: 62, nickname: "버티기대장", message: "안 눌렀죠?? 아직 안 눌렀죠?? 제발 10초만요, 딱 10초만 더요!!" },
  { threshold: 61, nickname: "빠른손99",   message: "저 진짜예요. 진짜 못 버티겠어요. 근데 아직 참고 있어요... 으으으" },
];

const NARRATOR_EVENTS = [
  { threshold: 92, message: "경기 시작 — 참가자들이 숨죽이며 가격을 지켜보고 있습니다" },
  { threshold: 79, message: "₩720,000 이하 진입 — 아직 아무도 낙찰받지 않았습니다" },
  { threshold: 70, message: "30% 할인 구간 돌파 — 심리전이 본격화되고 있습니다" },
  { threshold: 65, message: "⚡ 35% 이상 할인 — 언제든 낙찰이 날 수 있습니다" },
  { threshold: 61, message: "🔥 최저가 근접 — 지금이 경기의 마지막 순간입니다" },
];

export default function StrategyPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();

  // Shared
  const [message, setMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Strategy phase
  const [timeLeft, setTimeLeft] = useState(state.config.strategyDuration);
  const scheduleRef = useRef<Array<{ atSecond: number; nickname: string; message: string }>>([]);
  const firedLoungeRef = useRef(new Set<number>());

  // Game phase
  const [raised, setRaised] = useState(false);
  const [bidPrice, setBidPrice] = useState(0);
  const [tickFlash, setTickFlash] = useState(false);
  const [djKey, setDjKey] = useState(0);
  const [showDJ, setShowDJ] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const djTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const djIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedChatRef = useRef(new Set<number>());
  const firedNarratorRef = useRef(new Set<number>());

  // ── Redirect guards ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.currentUser) { router.replace("/"); return; }
  }, [state.currentUser, router]);

  // ── Schedule lounge messages once ────────────────────────────────────────
  useEffect(() => {
    const pool = shuffle(LOUNGE_MESSAGES);
    const sched: typeof scheduleRef.current = [];
    let t = 1 + Math.floor(Math.random() * 3);
    for (const item of pool) {
      if (t >= 57) break;
      sched.push({ atSecond: t, ...item });
      t += 2 + Math.floor(Math.random() * 5);
    }
    scheduleRef.current = sched;
  }, []);

  // ── Strategy countdown ───────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "strategy" || !state.strategyStartedAt) return;
    const update = () => {
      const elapsed = Math.floor((Date.now() - state.strategyStartedAt!) / 1000);
      const remaining = Math.max(0, state.config.strategyDuration - elapsed);
      setTimeLeft(remaining);
      scheduleRef.current.forEach((item, idx) => {
        if (elapsed >= item.atSecond && !firedLoungeRef.current.has(idx)) {
          firedLoungeRef.current.add(idx);
          dispatch({ type: "SEND_MESSAGE", nickname: item.nickname, message: item.message, timestamp: Date.now() });
        }
      });
      if (remaining === 0) dispatch({ type: "START_GAME", timestamp: Date.now() });
    };
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [state.phase, state.strategyStartedAt, state.config.strategyDuration, dispatch]);

  // ── Game tick + DJ interval ──────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "game") return;
    tickRef.current = setInterval(() => {
      dispatch({ type: "TICK" });
      setTickFlash(true);
      setTimeout(() => setTickFlash(false), 220);
    }, 1000);
    function triggerDJ() {
      setDjKey((k) => k + 1);
      setShowDJ(true);
      if (djTimerRef.current) clearTimeout(djTimerRef.current);
      djTimerRef.current = setTimeout(() => setShowDJ(false), 2500);
    }
    djIntervalRef.current = setInterval(triggerDJ, 20_000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (djIntervalRef.current) clearInterval(djIntervalRef.current);
      if (djTimerRef.current) clearTimeout(djTimerRef.current);
    };
  }, [state.phase, dispatch]);

  // ── Game chat / narrator events ──────────────────────────────────────────
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

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatMessages]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleRaiseHand = useCallback(() => {
    if (state.phase !== "game") return;
    if (!state.currentUser || state.currentUser.role !== "participant" || raised) return;
    setBidPrice(state.currentPrice);
    setRaised(true);
    if (tickRef.current) clearInterval(tickRef.current);
    dispatch({ type: "RAISE_HAND", nickname: state.currentUser.nickname, price: state.currentPrice });
  }, [state.phase, state.currentUser, state.currentPrice, raised, dispatch]);

  function sendMessage() {
    if (!message.trim() || !state.currentUser) return;
    dispatch({ type: "SEND_MESSAGE", nickname: state.currentUser.nickname, message: message.trim(), timestamp: Date.now() });
    setMessage("");
    inputRef.current?.focus();
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const isStrategy = state.phase === "strategy";
  const isGame     = state.phase === "game";
  const isParticipant = state.currentUser?.role === "participant";
  const floor = state.config.floorPrice;
  const start = state.config.startPrice;
  const isUrgent = timeLeft <= 15;

  // Game-phase price values
  const barPct = start > floor
    ? Math.min(100, Math.max(0, ((start - state.currentPrice) / (start - floor)) * 100))
    : 0;
  const pct = start > 0 ? Math.max(0, (state.currentPrice / start) * 100) : 0;
  const isLow      = pct < 50;
  const isCritical = pct < 30;
  const currentSavings    = start - state.currentPrice;
  const currentSavingsPct = start > 0 ? Math.round((currentSavings / start) * 100) : 0;

  // Winner overlay values (captured at bid moment)
  const bidSaved    = start - bidPrice;
  const bidDiscount = start > 0 ? Math.round((bidSaved / start) * 100) : 0;
  const winnerNick  = state.currentUser?.nickname ?? "";

  if (!state.currentUser) return null;

  return (
    <main className="h-screen bg-[#0a0a0a] max-w-md mx-auto overflow-hidden relative flex flex-col">

      {/* ── Background video ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <video autoPlay loop muted playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.45 }}
        >
          <source src="/gamepagevideo.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0"
          style={{ background: "linear-gradient(180deg, rgba(10,10,10,0.80) 0%, rgba(10,10,10,0.35) 38%, rgba(10,10,10,0.85) 100%)" }}
        />
      </div>

      {/* ── DJ overlay ── */}
      {showDJ && (
        <div key={djKey} className="dj-pop absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <Image src="/gamedj.png" alt="DJ" width={320} height={320} style={{ objectFit: "contain" }} priority />
        </div>
      )}

      {/* ── Winner overlay ── */}
      {raised && (
        <div className="absolute inset-0 z-[45] flex items-center justify-center px-5" style={{ background: "rgba(10,10,10,0.82)" }}>
          <div className="success-pop w-full text-center" style={{ border: "1px solid rgba(139,92,246,0.35)", background: "#111", padding: "2rem 1.5rem", boxShadow: "0 0 60px rgba(139,92,246,0.2)" }}>
            <div className="text-5xl mb-3">🎉</div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold mb-1" style={{ color: "#c084fc" }}>낙찰 성공</p>
            <p className="text-white/80 text-sm mb-4">
              <span className="font-black text-white">{winnerNick}</span>님, 축하합니다!
            </p>
            <div className="font-black tabular-nums font-mono leading-none mb-1"
              style={{ fontSize: "3.4rem", color: "#f5f3ff", textShadow: "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7, 0 0 52px rgba(139,92,246,0.55)" }}>
              {formatKRW(bidPrice)}
            </div>
            <p className="text-white/40 text-sm tabular-nums line-through mb-4">{formatKRW(start)}</p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.2)", padding: "0.75rem" }}>
                <p className="text-[10px] text-white/50 uppercase tracking-wider mb-1">절약 금액</p>
                <p className="text-base font-black font-mono tabular-nums" style={{ color: "#c084fc" }}>{formatKRW(bidSaved)}</p>
              </div>
              <div style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.2)", padding: "0.75rem" }}>
                <p className="text-[10px] text-white/50 uppercase tracking-wider mb-1">낙찰 비율</p>
                <p className="text-base font-black font-mono tabular-nums" style={{ color: "#c084fc" }}>정가의 {100 - bidDiscount}%</p>
              </div>
            </div>
            <Link href={`/payment?price=${bidPrice}`} className="block w-full py-3.5 font-black text-[18px] text-white text-center bid-btn-purple" style={{ letterSpacing: "0.04em" }}>
              결제하기 →
            </Link>
          </div>
        </div>
      )}

      {/* ── Right action menu — sits above chat input + buttons ── */}
      <RightActionMenu containerClassName="absolute right-3 bottom-[108px] z-40 flex flex-col gap-3" />

      {/* ── Main content ── */}
      <div className="relative z-10 flex flex-col h-full">

        {/* Top bar: HomeButton + LIVE only */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-10 pb-3">
          <HomeButton />
          <div className="w-px h-3.5 bg-white/15 flex-shrink-0" />
          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-red-500">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            LIVE
          </span>
        </div>

        {/* ── Hero: countdown / price — no label above ── */}
        <div className="flex-shrink-0 px-4 pb-2">
          {isStrategy ? (
            <div className="font-black tabular-nums font-mono leading-none"
              style={{
                fontSize: "3.2rem", letterSpacing: "-0.02em",
                color: isUrgent ? "#fff1f2" : "#f5f3ff",
                textShadow: isUrgent
                  ? "0 0 6px rgba(255,255,255,0.9), 0 0 14px #f87171, 0 0 28px #ef4444, 0 0 52px rgba(239,68,68,0.55)"
                  : "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7, 0 0 52px rgba(139,92,246,0.55)",
              }}
            >
              {pad(Math.floor(timeLeft / 60))}:{pad(timeLeft % 60)}
            </div>
          ) : (
            <div className={`font-black tabular-nums font-mono leading-none transition-all duration-300 ${tickFlash ? "price-tick" : ""}`}
              style={{
                fontSize: "3.2rem", letterSpacing: "-0.02em",
                color: isCritical ? "#fff1f2" : "#f5f3ff",
                textShadow: isCritical
                  ? "0 0 6px rgba(255,255,255,0.9), 0 0 14px #f87171, 0 0 28px #ef4444, 0 0 52px rgba(239,68,68,0.55)"
                  : "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7, 0 0 52px rgba(139,92,246,0.55)",
              }}
            >
              {formatKRW(state.currentPrice)}
            </div>
          )}

          {/* Savings row (game only) */}
          {isGame && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-white/40 text-xs tabular-nums line-through">{formatKRW(start)}</span>
              {currentSavings > 0 && (
                <span className="text-xs font-bold px-2 py-0.5" style={{
                  background: isCritical ? "rgba(239,68,68,0.16)" : "rgba(168,85,247,0.18)",
                  color: isCritical ? "#ef4444" : "#c084fc",
                }}>
                  -{currentSavingsPct}% · {formatKRW(currentSavings)} 절약
                </span>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="mt-2">
            <div className="h-px bg-white/10 w-full overflow-hidden">
              <div className="h-full transition-all duration-1000"
                style={{
                  width: isStrategy ? `${(timeLeft / state.config.strategyDuration) * 100}%` : `${barPct}%`,
                  background: isStrategy
                    ? (isUrgent ? "#ef4444" : "#a855f7")
                    : isCritical ? "#ef4444"
                    : isLow ? "linear-gradient(90deg, #a855f7, #ef4444)"
                    : "#a855f7",
                }}
              />
            </div>
            <div className="flex justify-between mt-1">
              {isStrategy ? (
                <>
                  <span className="text-[10px] text-white/40">경기 준비 중</span>
                  {isUrgent && <span className="text-[10px] font-bold animate-pulse" style={{ color: "#a855f7" }}>⚡ 잠시 후 시작</span>}
                </>
              ) : (
                <>
                  <span className="text-[10px] text-white/40">시작 {formatKRW(start)}</span>
                  <span className="text-[10px]" style={{ color: isCritical ? "#ef4444" : "#a855f7" }}>최저 {formatKRW(floor)}</span>
                </>
              )}
            </div>
          </div>

          {/* Participant / spectator count — below countdown */}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-white/55 tabular-nums">
            <span>✋{MOCK_PARTICIPANT_COUNT - (isGame ? 31 : 0)}</span>
            <span className="text-white/20">·</span>
            <span>👁{MOCK_SPECTATOR_COUNT.toLocaleString()}</span>
          </div>
        </div>

        {/* ── Product info ── */}
        <div className="flex-shrink-0 px-4 pr-[72px] pt-2 pb-2">
          <div className="h-px bg-white/8 mb-2" />
          <div className="flex items-center gap-3">
            <ProductThumb alt={state.config.productName} size={44} rounded="rounded-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-white/90 text-sm font-semibold leading-snug line-clamp-1">
                {state.config.productName}
              </p>
              <p className="text-white/40 text-xs font-mono tabular-nums mt-1">정가 {formatKRW(start)}</p>
            </div>
          </div>
        </div>

        {/* ── Live chat — flex-1 ── */}
        <div className="relative flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto no-scrollbar px-4 pt-2 pb-2 chat-fade-top">
            {state.chatMessages.map((msg) => {
              if (msg.kind === "system") return (
                <div key={msg.id} className="py-1.5 text-center">
                  <span className="text-xs text-white/50">{msg.message}</span>
                </div>
              );
              if (msg.kind === "narrator") return (
                <div key={msg.id} className="py-1 narrator-slide">
                  <span className="text-xs font-semibold" style={{ color: "#c084fc" }}>▶ {msg.message}</span>
                </div>
              );
              const isMe = msg.nickname === state.currentUser?.nickname;
              const displayName = isMe ? "나" : msg.nickname;
              const initial = displayName[0].toUpperCase();
              const avatarColor = isMe
                ? "rgba(168,85,247,0.85)"
                : `hsl(${(msg.nickname.charCodeAt(0) * 37) % 360}, 55%, 52%)`;
              return (
                <div key={msg.id} className="flex items-start gap-2 py-0.5 chat-in">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black text-white mt-0.5"
                    style={{ background: avatarColor }}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-bold mr-1.5" style={{ color: isMe ? "#a855f7" : "rgba(255,255,255,0.85)" }}>
                      {displayName}
                    </span>
                    {!isGame && <span className="text-[10px] text-white/45">{formatTime(msg.timestamp)}</span>}
                    <p className="text-sm text-white/90 leading-snug mt-0.5">{msg.message}</p>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* ── Chat input ── */}
        <div className="flex-shrink-0 px-4 pt-2 pb-1.5 border-t border-white/8">
          <div className="flex">
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={isStrategy ? "경기 전에 한 마디..." : "메시지..."}
              className="flex-1 bg-white/5 border border-white/10 border-r-0 px-3 py-2 text-white placeholder-white/18 text-[12px] focus:outline-none focus:border-purple-500/40 transition-colors min-w-0 rounded-l-xl"
            />
            <button
              onClick={sendMessage}
              disabled={!message.trim()}
              className="bg-white/5 disabled:bg-white/3 disabled:text-white/10 text-white/40 w-10 font-bold text-sm flex items-center justify-center flex-shrink-0 transition-colors rounded-r-xl"
            >
              ↑
            </button>
          </div>
        </div>

        {/* ── Action buttons — very bottom, half height ── */}
        <div className="flex-shrink-0 px-4 pt-1.5 pb-8">
          {isGame && isParticipant && !raised && bidPrice === 0 && (
            <p className="text-white/42 text-[11px] text-center mb-1.5">
              지금 누르면 <span className="font-bold text-white/72">{formatKRW(state.currentPrice)}</span>에 낙찰
              {currentSavings > 0 && (
                <span className="ml-1.5 font-bold" style={{ color: isCritical ? "#ef4444" : "#c084fc" }}>
                  · {formatKRW(currentSavings)} 절약
                </span>
              )}
            </p>
          )}
          {isStrategy && (
            <p className="text-white/32 text-[11px] text-center mb-1.5">카운트다운 종료 후 낙찰받기가 활성화됩니다</p>
          )}
          {isGame && !isParticipant && (
            <p className="text-white/32 text-[11px] text-center mb-1.5">참여자로 입장해야 낙찰받을 수 있어요</p>
          )}

          <div className="flex gap-2">
            <button className="flex items-center justify-center py-2 border border-white/12 gap-1.5 transition-colors active:bg-white/5 flex-[3] rounded-xl">
              <span className="text-sm leading-none">👁</span>
              <span className="text-xs font-bold text-white/50">관전</span>
            </button>

            {raised ? (
              <Link
                href={`/payment?price=${bidPrice}`}
                className="flex-[7] flex items-center justify-center py-2 font-black text-base text-white bid-btn-purple rounded-xl"
                style={{ letterSpacing: "0.04em" }}
              >
                결제하기 →
              </Link>
            ) : (
              <button
                onClick={handleRaiseHand}
                disabled={isStrategy || !isParticipant || state.currentPrice <= 0}
                className={`flex-[7] flex items-center justify-center py-2 font-black text-base text-white transition-all active:scale-[0.97] disabled:cursor-not-allowed rounded-xl ${
                  isStrategy || !isParticipant || state.currentPrice <= 0
                    ? ""
                    : isCritical ? "bid-btn-critical" : "bid-btn-purple"
                }`}
                style={{
                  background: isStrategy || !isParticipant ? "rgba(255,255,255,0.07)" : undefined,
                  letterSpacing: "0.04em",
                }}
              >
                {isStrategy ? "⏳ 경기 준비 중" : "🔥 낙찰받기"}
              </button>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
