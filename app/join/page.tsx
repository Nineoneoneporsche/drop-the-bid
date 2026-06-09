"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, type Role } from "../context/GameContext";

const ROLES: { value: Role; label: string; emoji: string; desc: string }[] = [
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
    desc: "경매를 지켜보고 채팅에 참여할 수 있어요. 낙찰은 받을 수 없어요",
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
    if (!trimmed) { setError("닉네임을 입력해주세요"); return; }
    if (trimmed.length < 2) { setError("닉네임은 2자 이상이어야 합니다"); return; }

    dispatch({ type: "JOIN", user: { nickname: trimmed, role } });
    dispatch({ type: "START_STRATEGY", timestamp: Date.now() });
    router.push("/strategy");
  }

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col px-4 pt-10 pb-12 max-w-md mx-auto">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors mb-8 self-start"
      >
        ← 뒤로
      </button>

      <div className="mb-1">
        <h1 className="text-2xl font-bold text-white">경매 참여하기</h1>
        <p className="text-gray-500 mt-1">{state.config.productName}</p>
      </div>

      {/* Nickname */}
      <div className="mt-8">
        <label className="block text-sm font-medium text-gray-300 mb-2">닉네임</label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => { setNickname(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="닉네임을 입력하세요"
          maxLength={20}
          autoFocus
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-4 text-white text-lg placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors"
        />
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      {/* Role */}
      <div className="mt-6">
        <label className="block text-sm font-medium text-gray-300 mb-3">역할 선택</label>
        <div className="space-y-3">
          {ROLES.map(({ value, label, emoji, desc }) => (
            <button
              key={value}
              onClick={() => setRole(value)}
              className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                role === value
                  ? "border-orange-500 bg-orange-500/10"
                  : "border-gray-700 bg-gray-900 hover:border-gray-600"
              }`}
            >
              <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">{label}</p>
                <p className="text-gray-400 text-sm mt-0.5 leading-snug">{desc}</p>
              </div>
              <div className="flex-shrink-0 mt-1">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    role === value ? "border-orange-500 bg-orange-500" : "border-gray-600"
                  }`}
                >
                  {role === value && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto pt-8">
        <button
          onClick={handleJoin}
          className="w-full bg-orange-500 hover:bg-orange-400 active:bg-orange-600 active:scale-[0.98] text-white font-bold py-4 rounded-xl text-base transition-all duration-150 shadow-lg shadow-orange-500/20"
        >
          {role === "participant" ? "참여자로 입장 →" : "관전자로 입장 →"}
        </button>
      </div>
    </main>
  );
}
