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

// Chat events from participants (regular messages)
const CHAT_EVENTS = [
  { threshold: 95, nickname: "kimchi_buyer", message: "아직 이르다... 기다려요" },
  { threshold: 90, nickname: "bidder_pro", message: "슬슬 긴장되네요 😅 다들 버티죠?" },
  { threshold: 85, nickname: "techie_seoul", message: "85만원... 손 가고 싶은 거 참는 중 ㅋ" },
  { threshold: 80, nickname: "mac_lover99", message: "믿어요 다들! 우리 약속했잖아요 💪" },
  { threshold: 75, nickname: "newbie_here", message: "손이 떨려요... 근데 참을게요" },
  { threshold: 70, nickname: "kimchi_buyer", message: "70% 진입!! 이제 진짜 심리전이에요" },
  { threshold: 65, nickname: "bidder_pro", message: "누가 먼저 배신하나 봐봐요... 👀" },
  { threshold: 60, nickname: "techie_seoul", message: "60만원... 이쯤이면 손들어도 되는 거 아닌가" },
];

// Atmospheric narrator messages
const NARRATOR_EVENTS = [
  { threshold: 88, message: "👀  누군가의 손가락이 움직이고 있습니다..." },
  { threshold: 75, message: "🌡️  긴장감이 고조되고 있습니다." },
  { threshold: 62, message: "⚠️  신뢰가 흔들리고 있습니다..." },
  { threshold: 50, message: "🔥  배신이 일어날 것 같습니다." },
  { threshold: 40, message: "💀  지금이 누군가의 한계입니다." },
  { threshold: 30, message: "⚡  신뢰는 무너졌습니다. 이제 각자도생입니다." },
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
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [state.phase, dispatch]);

  // Auto chat + narrator events
  useEffect(() => {
    if (state.phase !== "game" || !state.config.startPrice) return;
    const pct = Math.round((state.currentPrice / state.config.startPrice) * 100);

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
  const pct =
    state.config.startPrice > 0
      ? Math.max(0, (state.currentPrice / state.config.startPrice) * 100)
      : 0;
  const tension = Math.min(100, Math.round(100 - pct * 0.85));

  const priceColor =
    pct > 70 ? "text-green-400" : pct > 45 ? "text-yellow-400" : "text-red-400";
  const tensionColor =
    tension < 40 ? "bg-green-500" : tension < 65 ? "bg-yellow-500" : tension < 85 ? "bg-orange-500" : "bg-red-500";
  const tensionLabel =
    tension < 40 ? "낮음" : tension < 65 ? "보통" : tension < 85 ? "높음" : "위험";
  const tensionTextColor =
    tension < 40 ? "text-green-400" : tension < 65 ? "text-yellow-400" : tension < 85 ? "text-orange-400" : "text-red-400";
  const isCritical = tension >= 85;

  if (!state.currentUser) return null;

  return (
    <main className="h-screen bg-[#080808] flex flex-col max-w-md mx-auto overflow-hidden">
      {/* Price + tension header */}
      <div className="flex-shrink-0 px-4 pt-9 pb-4 border-b border-gray-800/80">
        {/* Status row */}
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-400 text-xs font-semibold uppercase tracking-widest">
            Live Drop
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-gray-500">
              ✋ <span className="text-gray-300">{MOCK_PARTICIPANT_COUNT - MOCK_SPECTATOR_COUNT}명</span>
            </span>
            <span className="text-gray-500">
              👁 <span className="text-gray-300">{MOCK_SPECTATOR_COUNT}명</span>
            </span>
          </div>
        </div>

        <p className="text-gray-500 text-xs mb-1">{state.config.productName}</p>

        {/* Price */}
        <div
          className={`text-5xl font-mono font-bold tabular-nums transition-colors duration-300 ${priceColor} ${tickFlash ? "price-tick" : ""}`}
        >
          {formatKRW(state.currentPrice)}
        </div>

        <div className="flex items-center gap-3 mt-1.5 mb-3">
          <span className="text-gray-700 text-xs">
            ↓ {formatKRW(state.config.dropAmount)}/초
          </span>
          <span className="text-gray-800">·</span>
          <span className="text-gray-700 text-xs">시작가의 {Math.round(pct)}%</span>
        </div>

        {/* Tension meter */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-gray-500 text-xs uppercase tracking-wider">긴장도</span>
            <span className={`text-xs font-bold ${tensionTextColor}`}>
              {tensionLabel} {tension}%
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-1000 ${tensionColor} ${
                isCritical ? "tension-critical" : ""
              }`}
              style={{ width: `${tension}%` }}
            />
          </div>
        </div>
      </div>

      {/* Raise hand (participants only) */}
      {isParticipant && (
        <div className="flex-shrink-0 px-4 py-3 border-b border-gray-800/80">
          <button
            onClick={handleRaiseHand}
            disabled={raised || state.currentPrice <= 0}
            className={`w-full font-bold py-5 rounded-2xl text-xl transition-all duration-150 ${
              raised
                ? "bg-green-800 text-white cursor-not-allowed"
                : "text-white active:scale-[0.98]"
            }`}
            style={
              !raised
                ? {
                    background:
                      "linear-gradient(135deg,#dc2626 0%,#ea580c 100%)",
                    boxShadow: "0 0 28px rgba(220,38,38,0.45)",
                    animation: "pulse-slow 2s ease-in-out infinite",
                  }
                : undefined
            }
          >
            {raised ? "✅ 손 들었습니다!" : "✋  손들기 — 지금 낙찰받기"}
          </button>
          {!raised && (
            <p className="text-gray-700 text-xs text-center mt-2">
              지금 누르면{" "}
              <span className="text-gray-300 font-semibold">
                {formatKRW(state.currentPrice)}
              </span>
              에 낙찰
            </p>
          )}
        </div>
      )}

      {!isParticipant && (
        <div className="flex-shrink-0 mx-4 my-2 bg-gray-900/50 rounded-xl px-4 py-2.5">
          <span className="text-gray-500 text-xs">👁 관전 중 — 참여자만 낙찰받을 수 있어요</span>
        </div>
      )}

      {/* Chat + narrator feed */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {state.chatMessages.map((msg) => {
          const isMe = msg.nickname === state.currentUser?.nickname;

          if (msg.kind === "system") {
            return (
              <div key={msg.id} className="flex justify-center">
                <span className="bg-gray-800/80 text-gray-400 text-xs px-3 py-1.5 rounded-full">
                  {msg.message}
                </span>
              </div>
            );
          }

          if (msg.kind === "narrator") {
            return (
              <div key={msg.id} className="narrator-slide">
                <div
                  className="rounded-xl px-4 py-3 text-center border"
                  style={{
                    background: "rgba(80,10,0,0.5)",
                    borderColor: "rgba(200,40,0,0.4)",
                  }}
                >
                  <p className="text-orange-300 text-sm font-medium italic">
                    {msg.message}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-600 to-red-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {msg.nickname[0].toUpperCase()}
              </div>
              <div
                className={`max-w-[70%] flex flex-col ${
                  isMe ? "items-end" : "items-start"
                }`}
              >
                <span className="text-xs text-gray-600 mb-1">
                  {isMe ? "나" : msg.nickname} · {formatTime(msg.timestamp)}
                </span>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm leading-snug ${
                    isMe
                      ? "bg-orange-600 text-white rounded-tr-sm"
                      : "bg-gray-800/90 text-white rounded-tl-sm"
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

      {/* Input */}
      <div className="flex-shrink-0 px-4 pt-3 pb-8 border-t border-gray-800/80 bg-[#080808]">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="메시지..."
            className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 text-sm focus:outline-none focus:border-orange-600 transition-colors min-w-0"
          />
          <button
            onClick={sendMessage}
            disabled={!message.trim()}
            className="bg-orange-600 hover:bg-orange-500 disabled:opacity-30 text-white w-12 rounded-xl font-bold text-lg flex items-center justify-center transition-colors flex-shrink-0"
          >
            ↑
          </button>
        </div>
      </div>
    </main>
  );
}
