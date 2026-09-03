"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, type Role, formatKRW } from "../context/GameContext";
import { supabase } from "../lib/supabase";
import HomeButton from "../components/HomeButton";

const ROLES: { value: Role; label: string; desc: string }[] = [
  {
    value: "participant",
    label: "참여자",
    desc: "가격이 원하는 수준에 도달하면 손을 들어 낙찰받을 수 있어요. 게임이 시작되면 채팅을 할 수 없어요",
  },
  {
    value: "spectator",
    label: "관전자",
    desc: "라이브를 지켜보고 채팅에 계속 참여할 수 있어요. 낙찰은 받을 수 없어요",
  },
];

export default function JoinPage() {
  const { state, joinGame } = useGame();
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [role, setRole] = useState<Role>("participant");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [memberNickname, setMemberNickname] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const nick = session?.user?.user_metadata?.nickname;
      if (nick) { setNickname(nick); setMemberNickname(nick); }
    });
  }, []);

  const countdownExpired = state.config.gameStartTime
    ? new Date(state.config.gameStartTime).getTime() <= now
    : false;
  const auctionLive = state.phase === "game";
  const participantBlocked = auctionLive || countdownExpired;

  useEffect(() => {
    if (participantBlocked) setRole("spectator");
  }, [participantBlocked]);

  async function handleJoin() {
    const trimmed = nickname.trim();
    if (!trimmed) { setError("닉네임을 입력해주세요"); return; }
    if (trimmed.length < 2) { setError("닉네임은 2자 이상이어야 합니다"); return; }
    // Close the mobile keyboard now, in parallel with the network calls below,
    // instead of leaving it to close while /strategy is already navigating in —
    // that race is what left the next (fixed-height) page's scroll offset stuck
    // mid-keyboard-close, shifting its whole layout up.
    (document.activeElement as HTMLElement | null)?.blur();
    setLoading(true);
    try {
      await joinGame(trimmed, role);
      router.push("/strategy");
    } catch {
      setError("입장 중 오류가 발생했습니다. 다시 시도해주세요.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col px-4 pt-8 pb-12 max-w-md mx-auto">
      <HomeButton />

      <div className="mt-10 mb-12">
        <p className="text-xs uppercase tracking-[0.14em] text-white/60 font-medium mb-1">Drop The Bid</p>
        <h1 className="text-[22px] font-black text-white leading-tight">입장하기</h1>
        <p className="text-white/70 text-base mt-2">
          {state.config.productName} ·{" "}
          <span className="font-semibold" style={{ color: "#a855f7" }}>{formatKRW(state.config.startPrice)}</span> 부터 시작
        </p>
      </div>

      {/* Nickname */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <label className="block text-xs uppercase tracking-[0.14em] text-white/60 font-medium">닉네임</label>
          {memberNickname && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.2)", color: "#c084fc" }}>
              회원
            </span>
          )}
        </div>
        {memberNickname ? (
          <>
            <p className="text-3xl font-bold text-white py-3 border-b-2" style={{ borderBottomColor: "#a855f7" }}>
              {memberNickname}
            </p>
            <p className="text-xs text-white/40 mt-2">회원 닉네임으로 자동 설정됩니다</p>
          </>
        ) : (
          <>
            <input
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="닉네임을 입력하세요"
              maxLength={20}
              autoFocus
              className="w-full bg-transparent border-b-2 border-white/25 px-0 py-3 text-white text-3xl font-bold placeholder-white/25 focus:outline-none transition-colors"
              onFocus={e => (e.target.style.borderBottomColor = "#a855f7")}
              onBlur={e => (e.target.style.borderBottomColor = "")}
            />
            <p className="text-xs text-white/35 mt-2">마이페이지에서 닉네임 설정 시 자동 입력돼요</p>
          </>
        )}
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </div>

      {/* Role */}
      <div className="mb-12">
        <label className="block text-xs uppercase tracking-[0.14em] text-white/60 font-medium mb-2">
          역할 선택
        </label>
        {ROLES.map(({ value, label, desc }, i) => {
          const disabled = value === "participant" && participantBlocked;
          const sel = role === value && !disabled;
          return (
            <button
              key={value}
              onClick={() => { if (!disabled) setRole(value); }}
              disabled={disabled}
              className={`w-full flex items-start gap-4 py-5 text-left ${i === 0 ? "border-b border-white/10" : ""} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <div
                className="w-5 h-5 border-2 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors"
                style={{ borderColor: sel ? "#a855f7" : "rgba(255,255,255,0.35)" }}
              >
                {sel && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#a855f7" }} />}
              </div>
              <div>
                <p className={`font-bold text-lg ${sel ? "text-white" : "text-white/60"}`}>{label}</p>
                <p className="text-white/55 text-sm mt-1 leading-snug">
                  {disabled ? (auctionLive ? "경매가 진행 중입니다. 관전으로만 입장 가능합니다." : "경매가 시작되어 참여자로 입장할 수 없습니다.") : desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-auto">
        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full py-5 font-bold text-base text-white transition-all active:scale-[0.98] active:opacity-90 disabled:opacity-50"
          style={{
            background: "linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)",
            borderRadius: "10px",
            boxShadow: "0 4px 24px rgba(139,92,246,0.45)",
          }}
        >
          {loading ? "입장 중..." : role === "participant" ? "참여자로 입장 →" : "관전자로 입장 →"}
        </button>
      </div>
    </main>
  );
}
