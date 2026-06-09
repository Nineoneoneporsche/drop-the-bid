"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, formatKRW, DEFAULT_CONFIG } from "../context/GameContext";

export default function AdminPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();

  const [form, setForm] = useState({
    productName: state.config.productName,
    startPrice: state.config.startPrice.toString(),
    dropAmount: state.config.dropAmount.toString(),
    strategyDuration: state.config.strategyDuration.toString(),
    gameStartTime: state.config.gameStartTime ?? "",
  });
  const [saved, setSaved] = useState(false);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    const startPrice = parseInt(form.startPrice, 10);
    const dropAmount = parseInt(form.dropAmount, 10);
    const strategyDuration = parseInt(form.strategyDuration, 10);

    if (!startPrice || startPrice <= 0) return alert("시작가를 올바르게 입력해주세요");
    if (!dropAmount || dropAmount <= 0) return alert("하락 금액을 올바르게 입력해주세요");
    if (!strategyDuration || strategyDuration <= 0) return alert("전략 시간을 올바르게 입력해주세요");

    dispatch({
      type: "UPDATE_CONFIG",
      config: {
        productName: form.productName.trim() || DEFAULT_CONFIG.productName,
        startPrice,
        dropAmount,
        strategyDuration,
        gameStartTime: form.gameStartTime || null,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleReset() {
    if (!confirm("게임을 리셋하고 홈으로 이동할까요?")) return;
    dispatch({ type: "RESET" });
    router.push("/");
  }

  const sp = parseInt(form.startPrice, 10);
  const da = parseInt(form.dropAmount, 10);
  const sd = parseInt(form.strategyDuration, 10);
  const gameDuration = sp > 0 && da > 0 ? Math.floor(sp / da) : null;

  return (
    <main className="min-h-screen bg-gray-950 pb-16 max-w-md mx-auto">
      <div className="px-4 pt-10 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-white">관리자 설정</h1>
            <p className="text-gray-500 text-sm">Drop The Bid</p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="text-gray-500 hover:text-gray-300 border border-gray-800 rounded-lg px-3 py-1.5 text-sm transition-colors"
          >
            ← 홈
          </button>
        </div>

        {/* Form */}
        <div className="space-y-5">
          <Field label="상품명">
            <input
              type="text"
              value={form.productName}
              onChange={(e) => set("productName", e.target.value)}
              placeholder="Mac mini M4"
              className={INPUT}
            />
          </Field>

          <Field
            label="시작가 (원)"
            hint={!isNaN(sp) && sp > 0 ? formatKRW(sp) : undefined}
          >
            <input
              type="number"
              value={form.startPrice}
              onChange={(e) => set("startPrice", e.target.value)}
              className={INPUT + " font-mono"}
              min={1}
            />
          </Field>

          <Field
            label="초당 하락 금액 (원/초)"
            hint={
              gameDuration
                ? `약 ${Math.floor(gameDuration / 60)}분 ${gameDuration % 60}초 후 0원`
                : undefined
            }
          >
            <input
              type="number"
              value={form.dropAmount}
              onChange={(e) => set("dropAmount", e.target.value)}
              className={INPUT + " font-mono"}
              min={1}
            />
          </Field>

          <Field
            label="전략 시간 (초)"
            hint={!isNaN(sd) && sd > 0 ? `${Math.floor(sd / 60)}분 ${sd % 60}초` : undefined}
          >
            <input
              type="number"
              value={form.strategyDuration}
              onChange={(e) => set("strategyDuration", e.target.value)}
              className={INPUT + " font-mono"}
              min={10}
            />
          </Field>

          <Field
            label="경매 시작 예정 시간"
            hint="비워두면 홈 화면에 '지금 참여 가능' 표시"
          >
            <input
              type="datetime-local"
              value={form.gameStartTime}
              onChange={(e) => set("gameStartTime", e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>

        {/* Actions */}
        <div className="mt-8 space-y-3">
          <button
            onClick={handleSave}
            className={`w-full font-bold py-4 rounded-xl text-base transition-all duration-300 ${
              saved
                ? "bg-green-700 text-white"
                : "bg-orange-500 hover:bg-orange-400 active:scale-[0.98] text-white shadow-lg shadow-orange-500/20"
            }`}
          >
            {saved ? "✅ 저장되었습니다!" : "설정 저장"}
          </button>

          <button
            onClick={handleReset}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold py-4 rounded-xl text-base transition-all active:scale-[0.98]"
          >
            게임 리셋 &amp; 홈으로
          </button>
        </div>

        {/* Preview */}
        <div className="mt-8 bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">저장된 설정</p>
          <div className="space-y-2">
            {[
              ["상품명", state.config.productName],
              ["시작가", formatKRW(state.config.startPrice)],
              ["하락 금액", `${formatKRW(state.config.dropAmount)}/초`],
              ["전략 시간", `${state.config.strategyDuration}초`],
              [
                "경매 시작",
                state.config.gameStartTime
                  ? new Date(state.config.gameStartTime).toLocaleString("ko-KR")
                  : "미설정",
              ],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-baseline gap-4">
                <span className="text-gray-500 text-sm flex-shrink-0">{k}</span>
                <span className="text-white text-sm font-medium text-right truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

const INPUT =
  "w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 transition-colors";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      {children}
      {hint && <p className="text-gray-600 text-xs mt-1.5">{hint}</p>}
    </div>
  );
}
