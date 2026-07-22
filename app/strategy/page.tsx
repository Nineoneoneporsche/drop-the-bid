"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  useGame,
  formatKRW,
  formatTime,
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

// ── In-game rapid chat ────────────────────────────────────────────────────────
const RAPID_CHATS = shuffle([
  { nickname: "관전자K",    message: "아직 아무도 안 눌렀네" },
  { nickname: "두근두근",   message: "손이 떨려요 ㅋㅋ" },
  { nickname: "긴장맥스",   message: "심장 쫄깃쫄깃" },
  { nickname: "뚝심파",     message: "버텨버텨버텨" },
  { nickname: "관전러88",   message: "와 진짜 안 눌러요?" },
  { nickname: "눈치게임",   message: "지금 다들 숨참고 있는 거 알잖아요" },
  { nickname: "라이브덕후", message: "이런 분위기 너무 좋다 ㅋㅋ" },
  { nickname: "조용히봄",   message: "..." },
  { nickname: "긴장자",     message: "누가 먼저 누를 것 같아요?" },
  { nickname: "관전자K",    message: "저도 참가할걸 그랬나" },
  { nickname: "두근두근",   message: "지금 가격 실화임?" },
  { nickname: "뚝심파",     message: "조금만 더 조금만 더" },
  { nickname: "눈치게임",   message: "눈치 싸움 ㄷㄷ" },
  { nickname: "라이브덕후", message: "이 긴장감이 진짜 묘미죠" },
  { nickname: "관전러88",   message: "으악 빨리빨리" },
  { nickname: "조용히봄",   message: "제발 제발..." },
  { nickname: "긴장맥스",   message: "저면 지금 당장 눌렀을 것 같은데 ㅋ" },
  { nickname: "뚝심파",     message: "단합 단합!!" },
  { nickname: "관전자K",    message: "이거 얼마까지 내려갈 수 있는 거예요?" },
  { nickname: "두근두근",   message: "손가락이 저절로 가려고 해요 㠠" },
]);

// ── In-game chat events (price threshold %) ───────────────────────────────────
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
  const { state, sendMessage, addLocalMessage, raiseHand, startGame, resetGame, leaveGame } = useGame();
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
  const [forcedWatcher, setForcedWatcher] = useState(false);
  const [showWatchConfirm, setShowWatchConfirm] = useState(false);
  const [showAuctionFailed, setShowAuctionFailed] = useState(false);
  const [showOtherWon, setShowOtherWon] = useState(false);
  const [tickFlash, setTickFlash] = useState(false);
  const [djKey, setDjKey] = useState(0);
  const [showDJ, setShowDJ] = useState(false);
  const djTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const djIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedChatRef = useRef(new Set<number>());
  const firedNarratorRef = useRef(new Set<number>());
  const rapidChatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rapidIdxRef = useRef(0);

  // ── Background music ──────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const audio = new Audio("/bgm.mp3");
    audio.loop = true;
    audio.volume = 0.30;
    audioRef.current = audio;

    const tryPlay = () => {
      if (!audio.paused) return;
      audio.play().catch(() => {});
    };

    tryPlay();
    window.addEventListener("click", tryPlay, { once: true });
    window.addEventListener("touchstart", tryPlay, { once: true });

    return () => {
      audio.pause();
      audio.src = "";
      window.removeEventListener("click", tryPlay);
      window.removeEventListener("touchstart", tryPlay);
    };
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);

  const handleGoHome = useCallback(async () => {
    await leaveGame();
    router.replace("/");
  }, [leaveGame, router]);

  // ── Redirect guards ──────────────────────────────────────────────────────
  useEffect(() => {
    // Skip on the very first mount after joinGame — phase update may not be committed yet
    if (sessionStorage.getItem("dtb_joining")) {
      sessionStorage.removeItem("dtb_joining");
      return;
    }
    if (!state.isLoaded) return;
    if (!state.currentUser) {
      localStorage.removeItem("dtb_user");
      router.replace("/");
      return;
    }
    if (state.phase === "home") {
      leaveGame().then(() => router.replace("/"));
    }
  }, [state.isLoaded, state.currentUser, state.phase, router, leaveGame]);

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
          addLocalMessage({
            id: `lounge-${idx}`,
            nickname: item.nickname,
            message: item.message,
            kind: "chat",
            timestamp: Date.now(),
          });
        }
      });
    };
    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [state.phase, state.strategyStartedAt, state.config.strategyDuration, addLocalMessage]);

  // ── Game tick flash + DJ interval + rapid chat ───────────────────────────
  useEffect(() => {
    if (state.phase !== "game") return;

    const flashInterval = setInterval(() => {
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

    rapidIdxRef.current = 0;
    rapidChatRef.current = setInterval(() => {
      const msg = RAPID_CHATS[rapidIdxRef.current % RAPID_CHATS.length];
      rapidIdxRef.current += 1;
      addLocalMessage({
        id: `rapid-${Date.now()}-${rapidIdxRef.current}`,
        nickname: msg.nickname,
        message: msg.message,
        kind: "chat",
        timestamp: Date.now(),
      });
    }, 3500);

    return () => {
      clearInterval(flashInterval);
      if (djIntervalRef.current) clearInterval(djIntervalRef.current);
      if (djTimerRef.current) clearTimeout(djTimerRef.current);
      if (rapidChatRef.current) clearInterval(rapidChatRef.current);
    };
  }, [state.phase, addLocalMessage]);

  // ── Game chat / narrator events ──────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "game" || !state.config.startPrice) return;
    const pct = Math.round((state.currentPrice / state.config.startPrice) * 100);
    for (const evt of CHAT_EVENTS) {
      if (pct <= evt.threshold && !firedChatRef.current.has(evt.threshold)) {
        firedChatRef.current.add(evt.threshold);
        addLocalMessage({
          id: `chat-${evt.threshold}`,
          nickname: evt.nickname,
          message: evt.message,
          kind: "chat",
          timestamp: Date.now(),
        });
      }
    }
    for (const evt of NARRATOR_EVENTS) {
      if (pct <= evt.threshold && !firedNarratorRef.current.has(evt.threshold)) {
        firedNarratorRef.current.add(evt.threshold);
        addLocalMessage({
          id: `narrator-${evt.threshold}`,
          nickname: "narrator",
          message: evt.message,
          kind: "narrator",
          timestamp: Date.now() + 1,
        });
      }
    }
  }, [state.currentPrice, state.config.startPrice, state.phase, addLocalMessage]);

  // ── Auction failure detection ────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "game" || raised || showAuctionFailed) return;
    if (state.currentPrice <= state.config.floorPrice) {
      if (rapidChatRef.current) { clearInterval(rapidChatRef.current); rapidChatRef.current = null; }
      setShowAuctionFailed(true);
    }
  }, [state.currentPrice, state.phase, raised, showAuctionFailed, state.config.floorPrice]);

  // ── Other user won detection ─────────────────────────────────────────────
  useEffect(() => {
    if (!state.winner) return;
    if (state.winner.id !== state.currentUser?.guestId) {
      setShowOtherWon(true);
    }
  }, [state.winner, state.currentUser]);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatMessages]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleRaiseHand = useCallback(async () => {
    if (state.phase !== "game") return;
    if (!state.currentUser || state.currentUser.role !== "participant" || raised || forcedWatcher) return;
    const price = state.currentPrice;
    const won = await raiseHand(state.currentUser.nickname, price);
    if (won) {
      setBidPrice(price);
      setRaised(true);
    } else {
      setShowOtherWon(true);
    }
  }, [state.phase, state.currentUser, state.currentPrice, raised, forcedWatcher, raiseHand]);

  function handleSendMessage() {
    if (!message.trim() || !state.currentUser) return;
    sendMessage(state.currentUser.nickname, message.trim());
    setMessage("");
    inputRef.current?.focus();
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const isStrategy = state.phase === "strategy";
  const isGame     = state.phase === "game";
  const isParticipant = state.currentUser?.role === "participant" && !forcedWatcher;
  const chatBlocked   = isGame && state.currentUser?.role === "participant" && !forcedWatcher;
  const floor = state.config.floorPrice;
  const start = state.config.startPrice;
  const isUrgent = timeLeft <= 15;

  const barPct = start > floor
    ? Math.min(100, Math.max(0, ((start - state.currentPrice) / (start - floor)) * 100))
    : 0;
  const pct = start > 0 ? Math.max(0, (state.currentPrice / start) * 100) : 0;
  const isLow      = pct < 50;
  const isCritical = pct < 30;
  const currentSavings    = start - state.currentPrice;
  const currentSavingsPct = start > 0 ? Math.round((currentSavings / start) * 100) : 0;

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

      {/* ── Auction failed popup ── */}
      {showAuctionFailed && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center px-6" style={{ background: "rgba(10,10,10,0.85)" }}>
          <div className="w-full max-w-xs bg-[#1a1a1a] border border-white/15 rounded-2xl p-6 text-center">
            <div className="text-5xl mb-3">😔</div>
            <p className="text-white font-black text-lg mb-1.5">경매 실패</p>
            <p className="text-white/50 text-sm leading-relaxed mb-6">
              아무도 낙찰받지 않아 경매가 종료됐어요.
            </p>
            <button
              onClick={async () => { await resetGame(); await leaveGame(); router.replace("/"); }}
              className="w-full py-3.5 font-bold text-base text-white rounded-xl"
              style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* ── Other user won popup ── */}
      {showOtherWon && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center px-6" style={{ background: "rgba(10,10,10,0.85)" }}>
          <div className="w-full max-w-xs bg-[#1a1a1a] border border-white/15 rounded-2xl p-6 text-center relative">
            <button
              onClick={() => setShowOtherWon(false)}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/80 transition-colors rounded-full hover:bg-white/10"
              aria-label="닫기"
            >
              ✕
            </button>
            <div className="text-5xl mb-3">🏁</div>
            <p className="text-white font-black text-lg mb-1.5">낙찰 완료</p>
            {state.winner && (
              <p className="text-white/70 text-sm mb-1">
                <span className="font-black text-white">{state.winner.nickname}</span>님이{" "}
                <span className="font-bold" style={{ color: "#c084fc" }}>{formatKRW(state.winner.price)}</span>에 낙찰받았습니다.
              </p>
            )}
            <p className="text-white/45 text-xs mb-6">다음 경매를 기대해주세요!</p>
            <button
              onClick={handleGoHome}
              className="w-full py-3.5 font-bold text-base text-white rounded-xl"
              style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
            >
              홈으로
            </button>
          </div>
        </div>
      )}

      {/* ── Watch confirm popup ── */}
      {showWatchConfirm && (
        <div className="absolute inset-0 z-[50] flex items-center justify-center px-6" style={{ background: "rgba(10,10,10,0.75)" }}>
          <div className="w-full max-w-xs bg-[#1a1a1a] border border-white/15 rounded-2xl p-6 text-center">
            <p className="text-white font-bold text-base mb-1.5">경매를 포기하고 관전하시겠어요?</p>
            <p className="text-white/45 text-xs mb-6 leading-relaxed">관전으로 전환하면 낙찰받기 버튼이 비활성화되고 채팅에 참여할 수 있어요. 다시 경매에 참여할 수 없어요.</p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowWatchConfirm(false)}
                className="flex-1 py-3 text-sm font-bold text-white/55 border border-white/15 rounded-xl transition-colors hover:border-white/30"
              >
                취소
              </button>
              <button
                onClick={() => { setForcedWatcher(true); setShowWatchConfirm(false); }}
                className="flex-1 py-3 text-sm font-bold text-white rounded-xl"
                style={{ background: "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
              >
                확인
              </button>
            </div>
          </div>
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

      {/* ── Right action menu ── */}
      <RightActionMenu containerClassName="absolute right-3 bottom-[210px] z-40 flex flex-col gap-3" />

      {/* ── Main content ── */}
      <div className="relative z-10 flex flex-col h-full">

        {/* Top bar */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 pt-10 pb-3">
          <button
            onClick={handleGoHome}
            className="inline-flex items-center justify-center w-8 h-8 text-white/35 hover:text-white/75 transition-colors"
            aria-label="메인화면"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
              <polyline points="9 21 9 12 15 12 15 21"/>
            </svg>
          </button>
          <div className="w-px h-3.5 bg-white/15 flex-shrink-0" />
          <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-red-500">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            LIVE
          </span>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-white/40 tabular-nums">
            {isStrategy ? null : (
              <>
                <span>✋{state.participantCount}</span>
                <span className="text-white/20">·</span>
                <span>👁{state.spectatorCount.toLocaleString()}</span>
                <span className="text-white/20">·</span>
              </>
            )}
            <button
              onClick={toggleMute}
              className="text-[16px] leading-none transition-opacity active:scale-90"
              style={{ opacity: muted ? 0.3 : 0.75 }}
              aria-label={muted ? "음악 켜기" : "음악 끄기"}
            >
              {muted ? "🔇" : "🎵"}
            </button>
          </div>
          {isStrategy && (
            <button
              onClick={() => startGame()}
              className="text-[11px] font-bold text-white/50 border border-white/15 px-2.5 py-1 rounded-lg transition-colors hover:text-white/80 hover:border-white/30 active:scale-95"
            >
              바로시작 →
            </button>
          )}
        </div>

        {/* Product info */}
        <div className="flex-shrink-0 px-4 pr-[72px] pt-2 pb-2">
          <div className="h-px bg-white/8 mb-2" />
          <div className="flex items-center gap-3">
            <ProductThumb alt={state.config.productName} size={44} rounded="rounded-sm" />
            <div className="flex-1 min-w-0">
              <p className="text-white/90 text-sm font-semibold leading-snug line-clamp-1">
                {state.config.productName}
              </p>
              <p className="text-xs font-bold font-mono tabular-nums mt-1" style={{ color: "#c084fc" }}>정가 {formatKRW(start)}</p>
            </div>
          </div>
        </div>

        {/* Live chat */}
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

        {/* Chat input */}
        <div className="flex-shrink-0 px-4 pt-2 pb-1.5 border-t border-white/8">
          {chatBlocked ? (
            <div className="flex items-center justify-center py-2.5 bg-white/4 rounded-xl border border-white/8">
              <span className="text-white/35 text-[11px]">🔇 경매 중 채팅에 참여할 수 없어요</span>
            </div>
          ) : (
            <div className="flex">
              <input
                ref={inputRef}
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder={isStrategy ? "경기 전에 한 마디..." : "메시지..."}
                className="flex-1 bg-white/5 border border-white/10 border-r-0 px-3 py-2 text-white placeholder-white/18 text-[12px] focus:outline-none focus:border-purple-500/40 transition-colors min-w-0 rounded-l-xl"
              />
              <button
                onClick={handleSendMessage}
                disabled={!message.trim()}
                className="bg-white/5 disabled:bg-white/3 disabled:text-white/10 text-white/40 w-10 font-bold text-sm flex items-center justify-center flex-shrink-0 transition-colors rounded-r-xl"
              >
                ↑
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex-shrink-0 px-4 pt-1 pb-8">
          <div className="h-px bg-white/8 w-full overflow-hidden rounded-full mb-3">
            <div
              className="h-full transition-all duration-1000 rounded-full"
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

          <div className="flex gap-2">
            {/* Watch button */}
            <button
              onClick={() => isParticipant ? setShowWatchConfirm(true) : undefined}
              className="flex flex-col items-center justify-center border border-white/12 gap-1 transition-colors active:bg-white/5 flex-[3] rounded-xl h-[88px]"
            >
              <span className="text-xl leading-none">👁</span>
              <span className="text-[11px] font-bold text-white/45 mt-0.5">{forcedWatcher ? "관전 중" : "관전"}</span>
            </button>

            {/* Bid / Payment button */}
            {raised ? (
              <Link
                href={`/payment?price=${bidPrice}`}
                className="flex-[7] flex items-center justify-center h-[88px] font-black text-xl text-white bid-btn-purple rounded-xl"
              >
                결제하기 →
              </Link>
            ) : (
              <button
                onClick={handleRaiseHand}
                disabled={isStrategy || !isParticipant || state.currentPrice <= 0}
                className={`relative overflow-hidden flex-[7] flex flex-col items-center justify-center h-[88px] text-white transition-all active:scale-[0.97] disabled:cursor-not-allowed rounded-xl ${
                  isStrategy || !isParticipant || state.currentPrice <= 0
                    ? ""
                    : isCritical ? "bid-btn-critical critical-shake" : "bid-btn-purple"
                }`}
                style={{ background: isStrategy || !isParticipant ? "rgba(255,255,255,0.07)" : undefined }}
              >
                {isGame && isParticipant && (
                  <div
                    className="bid-shimmer absolute inset-y-0 w-[40%] pointer-events-none"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.13), transparent)" }}
                  />
                )}

                {isStrategy ? (
                  <>
                    <span
                      className="font-black font-mono tabular-nums leading-none"
                      style={{
                        fontSize: "2.4rem", letterSpacing: "-0.02em",
                        color: isUrgent ? "#fff1f2" : "#f5f3ff",
                        textShadow: isUrgent
                          ? "0 0 6px rgba(255,255,255,0.9), 0 0 14px #f87171, 0 0 28px #ef4444"
                          : "0 0 6px rgba(255,255,255,0.9), 0 0 14px #c084fc, 0 0 28px #a855f7",
                      }}
                    >
                      {pad(Math.floor(timeLeft / 60))}:{pad(timeLeft % 60)}
                    </span>
                    <span className="text-[11px] text-white/38 font-medium mt-2">⏳ 경기 준비 중</span>
                  </>
                ) : (
                  <>
                    <span
                      className={`font-black font-mono tabular-nums leading-none ${tickFlash ? "price-tick" : ""}`}
                      style={{ fontSize: "2.4rem", letterSpacing: "-0.02em" }}
                    >
                      {formatKRW(state.currentPrice)}
                    </span>
                    <div className={`flex items-center gap-2 mt-1 transition-opacity duration-300 ${currentSavings > 0 ? "opacity-100" : "opacity-0"}`}>
                      <span className="text-[11px] font-bold text-white">-{currentSavingsPct}% · {formatKRW(currentSavings)} 절약</span>
                      <span className="text-sm font-black text-white">🔥 낙찰받기</span>
                    </div>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
