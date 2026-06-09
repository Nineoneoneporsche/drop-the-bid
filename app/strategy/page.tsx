"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, formatKRW, formatTime, MOCK_PARTICIPANT_COUNT } from "../context/GameContext";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

// Messages that auto-arrive at specific seconds elapsed after strategy start
const ARRIVING_MESSAGES = [
  { atSecond: 10, nickname: "bidder_pro", message: "650k까지 버티면 우리 모두 이길 수 있어요 💪" },
  { atSecond: 22, nickname: "kimchi_buyer", message: "다들 약속 지켜요. 절대 70만원 위에서 누르면 안 돼요" },
  { atSecond: 38, nickname: "techie_seoul", message: "근데 솔직히... 누군가 배신할 것 같은 느낌 😅" },
  { atSecond: 52, nickname: "mac_lover99", message: "에이 설마요. 우리 믿어봐요!" },
  { atSecond: 70, nickname: "newbie_here", message: "저 진짜 안 눌러요. 맹세해요 🙏🙏" },
  { atSecond: 90, nickname: "bidder_pro", message: "믿는다고 했던 사람이 제일 먼저 손드는 법이죠 ㅋㅋ" },
  { atSecond: 115, nickname: "kimchi_buyer", message: "곧 시작해요! 모두 긴장하세요. 배신하는 사람 없기!" },
  { atSecond: 140, nickname: "techie_seoul", message: "30초 남았습니다... 숨 참고 버텨요 😤" },
  { atSecond: 160, nickname: "mac_lover99", message: "마지막 순간까지 신뢰를 지켜봐요. 모두를 위해 🙏" },
];

export default function StrategyPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();
  const [timeLeft, setTimeLeft] = useState(state.config.strategyDuration);
  const [message, setMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firedRef = useRef(new Set<number>());

  useEffect(() => {
    if (!state.currentUser) router.replace("/");
  }, [state.currentUser, router]);

  useEffect(() => {
    if (!state.strategyStartedAt) return;

    const update = () => {
      const elapsed = Math.floor((Date.now() - state.strategyStartedAt!) / 1000);
      const remaining = Math.max(0, state.config.strategyDuration - elapsed);
      setTimeLeft(remaining);

      // Fire auto-arriving messages
      for (const msg of ARRIVING_MESSAGES) {
        if (elapsed >= msg.atSecond && !firedRef.current.has(msg.atSecond)) {
          firedRef.current.add(msg.atSecond);
          dispatch({
            type: "SEND_MESSAGE",
            nickname: msg.nickname,
            message: msg.message,
            timestamp: Date.now(),
          });
        }
      }

      if (remaining === 0) {
        dispatch({ type: "START_GAME", timestamp: Date.now() });
        router.push("/game");
      }
    };

    update();
    const t = setInterval(update, 500);
    return () => clearInterval(t);
  }, [state.strategyStartedAt, state.config.strategyDuration, dispatch, router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chatMessages]);

  function sendMessage() {
    if (!message.trim() || !state.currentUser) return;
    dispatch({
      type: "SEND_MESSAGE",
      nickname: state.currentUser.nickname,
      message: message.trim(),
      timestamp: Date.now(),
    });
    setMessage("");
    inputRef.current?.focus();
  }

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const progress = timeLeft / state.config.strategyDuration;
  const urgency =
    timeLeft < 30 ? "text-red-400" : timeLeft < 60 ? "text-yellow-400" : "text-green-400";

  if (!state.currentUser) return null;

  return (
    <main className="h-screen bg-[#080808] flex flex-col max-w-md mx-auto overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-10 pb-4 border-b border-gray-800/80">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-yellow-400 text-xs font-semibold uppercase tracking-wider">
                협상 라운지
              </span>
              <span className="ml-2 bg-gray-800 border border-gray-700 text-gray-400 text-xs px-2 py-0.5 rounded-full">
                👥 {MOCK_PARTICIPANT_COUNT}명
              </span>
            </div>
            <h2 className="text-white font-bold text-base leading-tight">
              {state.config.productName}
            </h2>
            <p className="text-gray-500 text-sm mt-0.5">
              시작가 {formatKRW(state.config.startPrice)}
            </p>
          </div>

          {/* Countdown */}
          <div className="text-right flex-shrink-0">
            <div className={`text-3xl font-mono font-bold tabular-nums ${urgency}`}>
              {pad(mins)}:{pad(secs)}
            </div>
            <p className="text-gray-600 text-xs mt-0.5">게임 시작까지</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all duration-1000 bg-gradient-to-r from-green-500 via-yellow-400 to-red-500"
            style={{ width: `${(1 - progress) * 100}%` }}
          />
        </div>

        {/* Negotiation prompt */}
        <div
          className="mt-3 rounded-xl px-3 py-2.5 border"
          style={{
            background: "rgba(30,10,0,0.7)",
            borderColor: "rgba(180,60,0,0.4)",
          }}
        >
          <p className="text-orange-400 text-xs font-medium">
            🤝 전략을 짜세요 — 언제 손들지 서로 조율하세요
          </p>
        </div>

        {timeLeft < 30 && (
          <div className="mt-2 bg-red-950/60 border border-red-800/60 rounded-lg px-3 py-2 text-center">
            <p className="text-red-400 text-xs font-semibold">⚡ {timeLeft}초 후 가격 하락 시작!</p>
          </div>
        )}
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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

          return (
            <div key={msg.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`}>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-600 to-red-600 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                {msg.nickname[0].toUpperCase()}
              </div>
              <div
                className={`max-w-[72%] flex flex-col ${
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
                      : "bg-gray-800 text-white rounded-tl-sm"
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
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="전략을 공유해보세요..."
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
