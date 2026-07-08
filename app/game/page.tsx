"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useGame,
  formatKRW,
  formatTime,
  MOCK_PARTICIPANT_COUNT,
  MOCK_SPECTATOR_COUNT,
} from "../context/GameContext";
import { ProductThumb } from "../components/ProductImage";
import RightActionMenu from "../components/RightActionMenu";
import BottomNav from "../components/BottomNav";
import HomeButton from "../components/HomeButton";

// Friendly chat messages from other participants
const CHAT_EVENTS = [
  { threshold: 95, nickname: "shopping_star", message: "조금 더 기다려볼게요 👀" },
  { threshold: 88, nickname: "minivelo_fan",  message: "220,000원대네요, 슬슬 고민되는데..." },
  { threshold: 80, nickname: "kid_gear_mom",  message: "200,000원 밑으로 가면 바로 손들게요!" },
  { threshold: 77, nickname: "구경꾼99",      message: "와 이걸 버틴다고?? 😳" },
  { threshold: 74, nickname: "라이브팬",      message: "아직도 아무도 안 누르네" },
  { threshold: 72, nickname: "smart_buyer",   message: "다들 조금 더 기다려봐요 😊" },
  { threshold: 70, nickname: "실속파",        message: "생각보다 강한데요?" },
  { threshold: 67, nickname: "쇼핑고수",      message: "슬슬 긴장된다" },
  { threshold: 65, nickname: "shopping_star", message: "170,000원... 이 정도면 정말 좋은 가격이네요" },
  { threshold: 64, nickname: "기다렸다",      message: "여기서 더 기다린다고?" },
  { threshold: 61, nickname: "알뜰파",        message: "이 가격이면 고민되는데" },
  { threshold: 59, nickname: "구경꾼99",      message: "레전드네 ㄷㄷ" },
  { threshold: 58, nickname: "minivelo_fan",  message: "누가 먼저 누를지 두근두근 🤩" },
  { threshold: 56, nickname: "채팅구경",      message: "단합력 무엇 ㅋㅋ" },
  { threshold: 53, nickname: "뭐야이거",      message: "진짜 아무도 안 누른다고?" },
  { threshold: 49, nickname: "라이브킹",      message: "이건 예상 못했다" },
  { threshold: 46, nickname: "득템요정",      message: "오늘 참가자들 독하네" },
  { threshold: 44, nickname: "sunny_star",    message: "여기까지 오는 건 처음 보는데" },
  { threshold: 42, nickname: "ㅋㅋ구경",      message: "채팅방 분위기 왜 이래 ㅋㅋ" },
  { threshold: 41, nickname: "설레는밤",      message: "다들 참을성 무슨 일이야" },
];

// Neutral live-commerce narrator messages
const NARRATOR_EVENTS = [
  { threshold: 90, message: "📢  가격이 계속 내려가고 있어요" },
  { threshold: 76, message: "💬  참가자들이 신중하게 기다리고 있습니다" },
  { threshold: 63, message: "👥  현재 많은 분들이 지켜보고 있어요" },
  { threshold: 50, message: "🎯  좋은 가격이 다가오고 있습니다!" },
  { threshold: 40, message: "✨  지금이 절호의 찬스예요!" },
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

  // Price tick
  useEffect(() => {
    if (state.phase !== "game") return;
    tickRef.current = setInterval(() => {
      dispatch({ type: "TICK" });
      setTickFlash(true);
      setTimeout(() => setTickFlash(false), 300);
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [state.phase, dispatch]);

  // Auto events
  useEffect(() => {
    if (state.phase !== "game" || !state.config.startPrice) return;
    const pct = Math.round(
      (state.currentPrice / state.config.startPrice) * 100
    );

    for (const evt of CHAT_EVENTS) {
      if (pct <= evt.threshold && !firedChatRef.current.has(evt.threshold)) {
        firedChatRef.current.add(evt.threshold);
        dispatch({
          type: "SEND_MESSAGE",
          nickname: evt.nickname,
          message: evt.message,
          timestamp: Date.now(),
        });
      }
    }

    for (const evt of NARRATOR_EVENTS) {
      if (pct <= evt.threshold && !firedNarratorRef.current.has(evt.threshold)) {
        firedNarratorRef.current.add(evt.threshold);
        dispatch({
          type: "SEND_NARRATOR",
          message: evt.message,
          timestamp: Date.now() + 1,
        });
      }
    }
  }, [state.currentPrice, state.config.startPrice, state.phase, dispatch]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatMessages]);

  const handleRaiseHand = useCallback(() => {
    if (
      !state.currentUser ||
      state.currentUser.role !== "participant" ||
      raised
    )
      return;
    setRaised(true);
    if (tickRef.current) clearInterval(tickRef.current);
    dispatch({
      type: "RAISE_HAND",
      nickname: state.currentUser.nickname,
      price: state.currentPrice,
    });
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

  // Price progress bar: 0 at startPrice, 100 at floorPrice
  const floor = state.config.floorPrice;
  const start = state.config.startPrice;
  const barPct =
    start > floor
      ? Math.min(
          100,
          Math.max(
            0,
            ((start - state.currentPrice) / (start - floor)) * 100
          )
        )
      : 0;
  // Percentage remaining vs start
  const pct =
    start > 0
      ? Math.max(0, (state.currentPrice / start) * 100)
      : 0;

  const isLow = pct < 50;

  if (!state.currentUser) return null;

  return (
    <main className="h-screen bg-[#fffbf5] flex flex-col max-w-md mx-auto overflow-hidden relative">
      <RightActionMenu />
      {/* Price header */}
      <div className="flex-shrink-0 bg-white px-4 pt-9 pb-4 border-b border-gray-100 shadow-sm">
        <div className="flex mb-2">
          <HomeButton />
        </div>
        {/* Status row */}
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </span>
          <span className="text-gray-400 text-xs">
            ✋ <span className="text-gray-700 font-semibold">{MOCK_PARTICIPANT_COUNT - 31}명</span>
          </span>
          <span className="text-gray-400 text-xs">
            👁 <span className="text-gray-700 font-semibold">{MOCK_SPECTATOR_COUNT.toLocaleString()}명</span>
          </span>
          <span className="ml-auto text-gray-400 text-xs">
            {isParticipant ? "✋ 참여자" : "👁 관전자"}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-1">
          <ProductThumb alt={state.config.productName} size={32} rounded="rounded-lg" />
          <p className="text-gray-400 text-xs truncate">{state.config.productName}</p>
        </div>

        {/* Price */}
        <div
          className={`font-black tabular-nums font-mono transition-colors duration-300 ${
            tickFlash ? "price-tick" : ""
          } ${isLow ? "text-red-500" : "text-orange-500"}`}
          style={{ fontSize: "3.2rem", lineHeight: 1.1 }}
        >
          {formatKRW(state.currentPrice)}
        </div>

        <p className="text-gray-400 text-xs mt-1 mb-3">
          ↓ {formatKRW(state.config.dropAmount)}/초 하락
        </p>

        {/* Progress bar: start → floor */}
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>{formatKRW(start)}</span>
            <span className="text-orange-500 font-semibold">
              목표가 {formatKRW(floor)}
            </span>
          </div>
          <div className="w-full bg-orange-50 rounded-full h-3 overflow-hidden border border-orange-100">
            <div
              className="h-3 rounded-full transition-all duration-1000"
              style={{
                width: `${barPct}%`,
                background: isLow
                  ? "linear-gradient(90deg,#f97316,#ef4444)"
                  : "linear-gradient(90deg,#fb923c,#f59e0b)",
              }}
            />
          </div>
          <p className="text-right text-xs text-gray-400 mt-1">
            {Math.round(barPct)}% 내려왔어요
          </p>
        </div>
      </div>

      {/* Raise hand */}
      {isParticipant && (
        <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-gray-100">
          <button
            onClick={handleRaiseHand}
            disabled={raised || state.currentPrice <= 0}
            className={`w-full font-bold py-5 rounded-2xl text-xl transition-all active:scale-[0.98] ${
              raised ? "cursor-not-allowed" : ""
            }`}
            style={
              raised
                ? { background: "#16a34a", color: "#fff" }
                : {
                    background:
                      "linear-gradient(135deg,#fb923c 0%,#f97316 100%)",
                    color: "#fff",
                    boxShadow: "0 4px 24px rgba(249,115,22,0.4)",
                  }
            }
          >
            {raised ? "✅ 낙찰 완료!" : "🔥 낙찰받기"}
          </button>
          {!raised && (
            <p className="text-gray-400 text-xs text-center mt-2">
              지금 누르면{" "}
              <span className="text-orange-500 font-semibold">
                {formatKRW(state.currentPrice)}
              </span>
              에 낙찰받아요
            </p>
          )}
        </div>
      )}

      {!isParticipant && (
        <div className="flex-shrink-0 mx-4 my-2 bg-orange-50 rounded-2xl px-4 py-2.5 border border-orange-100">
          <p className="text-orange-400 text-xs font-medium text-center">
            👁 관전 중 — 참여자로 입장하면 낙찰받을 수 있어요
          </p>
        </div>
      )}

      {/* Chat + narrator feed */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {state.chatMessages.map((msg) => {
          const isMe = msg.nickname === state.currentUser?.nickname;

          if (msg.kind === "system") {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="bg-orange-50 text-orange-400 text-xs px-4 py-1.5 rounded-full border border-orange-100">
                  {msg.message}
                </span>
              </div>
            );
          }

          if (msg.kind === "narrator") {
            return (
              <div key={msg.id} className="narrator-slide">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-center">
                  <p className="text-amber-700 text-sm font-medium">
                    {msg.message}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-amber-400 flex items-center justify-center text-xs font-black text-white flex-shrink-0 shadow-sm">
                {msg.nickname[0].toUpperCase()}
              </div>
              <div
                className={`max-w-[70%] flex flex-col ${
                  isMe ? "items-end" : "items-start"
                }`}
              >
                <span className="text-xs text-gray-400 mb-1">
                  {isMe ? "나" : msg.nickname} · {formatTime(msg.timestamp)}
                </span>
                <div
                  className={`px-3 py-2.5 rounded-2xl text-sm leading-snug shadow-sm ${
                    isMe
                      ? "bg-orange-500 text-white rounded-tr-sm"
                      : "bg-white text-gray-800 rounded-tl-sm border border-gray-100"
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Chat input */}
      <div className="flex-shrink-0 bg-white px-4 pt-3 pb-24 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="메시지..."
            className="flex-1 bg-gray-50 border-2 border-gray-100 rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-300 text-sm focus:outline-none focus:border-orange-300 transition-colors min-w-0"
          />
          <button
            onClick={sendMessage}
            disabled={!message.trim()}
            className="bg-orange-500 hover:bg-orange-400 disabled:opacity-30 text-white w-12 rounded-2xl font-bold text-lg flex items-center justify-center transition-colors flex-shrink-0 shadow-sm"
          >
            ↑
          </button>
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
