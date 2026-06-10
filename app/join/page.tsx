"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, type Role, formatKRW } from "../context/GameContext";

const ROLES: {
  value: Role;
  label: string;
  emoji: string;
  desc: string;
}[] = [
  {
    value: "participant",
    label: "참여자",
    emoji: "✋",
    desc: "가격이 원하는 수준에 도달하면 손을 들어 낙찰받을 수 있어요",
  },
  {
    value: "spectator",
    label: "관전자",
    emoji: "👁",
    desc: "라이브를 지켜보고 채팅에 참여할 수 있어요. 낙찰은 받을 수 없어요",
  },
];

export default function JoinPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<Role>("participant");
  const [error, setError] = useState("");

  function handleJoin() {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError("닉네임을 입력해주세요");
      return;
    }
    if (trimmed.length < 2) {
      setError("닉네임은 2자 이상이어야 합니다");
      return;
    }

    dispatch({ type: "JOIN", user: { nickname: trimmed, role } });
    dispatch({ type: "START_STRATEGY", timestamp: Date.now() });
    router.push("/strategy");
  }

  return (
    <main className="min-h-screen bg-[#fffbf5] flex flex-col px-4 pt-8 pb-12 max-w-md mx-auto">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-gray-400 hover:text-orange-500 transition-colors mb-8 self-start text-sm"
      >
        ← 뒤로
      </button>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-gray-900">참여하기</h1>
        <p className="text-gray-400 text-sm mt-1 leading-snug">
          {state.config.productName}
          <br />
          <span className="text-orange-500 font-semibold">
            {formatKRW(state.config.startPrice)}
          </span>{" "}
          부터 시작
        </p>
      </div>

      {/* Nickname */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          닉네임
        </label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="닉네임을 입력하세요"
          maxLength={20}
          autoFocus
          className="w-full bg-white border-2 border-gray-200 rounded-2xl px-4 py-4 text-gray-900 text-lg placeholder-gray-300 focus:outline-none focus:border-orange-400 transition-colors shadow-sm"
        />
        {error && (
          <p className="text-red-500 text-sm mt-2 flex items-center gap-1">
            <span>⚠️</span> {error}
          </p>
        )}
      </div>

      {/* Role selection */}
      <div className="mb-8">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          역할 선택
        </label>
        <div className="space-y-3">
          {ROLES.map(({ value, label, emoji, desc }) => {
            const selected = role === value;
            return (
              <button
                key={value}
                onClick={() => setRole(value)}
                className={`w-full flex items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                  selected
                    ? "border-orange-400 bg-orange-50 shadow-sm"
                    : "border-gray-100 bg-white hover:border-orange-200"
                }`}
              >
                <span className="text-2xl leading-none mt-0.5 flex-shrink-0">
                  {emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <p
                    className={`font-bold text-base ${
                      selected ? "text-orange-600" : "text-gray-800"
                    }`}
                  >
                    {label}
                  </p>
                  <p className="text-gray-400 text-sm mt-0.5 leading-snug">
                    {desc}
                  </p>
                </div>
                <div className="flex-shrink-0 mt-1">
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      selected
                        ? "border-orange-400 bg-orange-400"
                        : "border-gray-300"
                    }`}
                  >
                    {selected && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="mt-auto">
        <button
          onClick={handleJoin}
          className="w-full font-bold py-4 rounded-2xl text-base text-white transition-all active:scale-[0.98] shadow-md"
          style={{
            background: "linear-gradient(135deg, #fb923c 0%, #f97316 100%)",
            boxShadow: "0 4px 20px rgba(249,115,22,0.35)",
          }}
        >
          {role === "participant" ? "참여자로 입장 →" : "관전자로 입장 →"}
        </button>
      </div>
    </main>
  );
}
