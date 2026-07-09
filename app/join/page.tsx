"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, type Role, formatKRW } from "../context/GameContext";
import HomeButton from "../components/HomeButton";

const ROLES: { value: Role; label: string; desc: string }[] = [
  {
    value: "participant",
    label: "참여자",
    desc: "가격이 원하는 수준에 도달하면 손을 들어 낙찰받을 수 있어요",
  },
  {
    value: "spectator",
    label: "관전자",
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
    if (!trimmed) { setError("닉네임을 입력해주세요"); return; }
    if (trimmed.length < 2) { setError("닉네임은 2자 이상이어야 합니다"); return; }
    dispatch({ type: "JOIN", user: { nickname: trimmed, role } });
    dispatch({ type: "START_STRATEGY", timestamp: Date.now() });
    router.push("/strategy");
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col px-4 pt-8 pb-12 max-w-md mx-auto">
      <HomeButton />

      <div className="mt-10 mb-12">
        <p className="text-[10px] uppercase tracking-[0.14em] text-white/25 font-medium mb-1">Drop The Bid</p>
        <h1 className="text-4xl font-black text-white leading-tight">입장하기</h1>
        <p className="text-white/30 text-sm mt-2">
          {state.config.productName} ·{" "}
          <span className="text-orange-500 font-semibold">{formatKRW(state.config.startPrice)}</span> 부터 시작
        </p>
      </div>

      {/* Nickname */}
      <div className="mb-10">
        <label className="block text-[10px] uppercase tracking-[0.14em] text-white/25 font-medium mb-4">
          닉네임
        </label>
        <input
          type="text"
          value={nickname}
          onChange={(e) => { setNickname(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          placeholder="닉네임을 입력하세요"
          maxLength={20}
          autoFocus
          className="w-full bg-transparent border-b-2 border-white/15 px-0 py-3 text-white text-2xl font-bold placeholder-white/10 focus:outline-none focus:border-orange-500 transition-colors"
        />
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      {/* Role */}
      <div className="mb-12">
        <label className="block text-[10px] uppercase tracking-[0.14em] text-white/25 font-medium mb-2">
          역할 선택
        </label>
        {ROLES.map(({ value, label, desc }, i) => {
          const sel = role === value;
          return (
            <button
              key={value}
              onClick={() => setRole(value)}
              className={`w-full flex items-start gap-3 py-4 text-left ${i === 0 ? "border-b border-white/8" : ""}`}
            >
              <div
                className={`w-4 h-4 border-2 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                  sel ? "border-orange-500" : "border-white/20"
                }`}
              >
                {sel && <div className="w-2 h-2 rounded-full bg-orange-500" />}
              </div>
              <div>
                <p className={`font-bold text-base ${sel ? "text-white" : "text-white/25"}`}>{label}</p>
                <p className="text-white/25 text-xs mt-0.5 leading-snug">{desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-auto">
        <button
          onClick={handleJoin}
          className="w-full py-4 font-bold text-base text-white transition-opacity active:opacity-80"
          style={{ background: "#f97316" }}
        >
          {role === "participant" ? "참여자로 입장 →" : "관전자로 입장 →"}
        </button>
      </div>
    </main>
  );
}
