"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGame, formatKRW, DEFAULT_CONFIG } from "../context/GameContext";

export default function AdminPage() {
  const { state, dispatch } = useGame();
  const router = useRouter();

  const [form, setForm] = useState({
    productName: state.config.productName,
    description: state.config.description,
    startPrice: state.config.startPrice.toString(),
    dropAmount: state.config.dropAmount.toString(),
    strategyDuration: state.config.strategyDuration.toString(),
    floorPrice: state.config.floorPrice.toString(),
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
    const floorPrice = parseInt(form.floorPrice, 10);

    if (!startPrice || startPrice <= 0) return alert("시작가를 올바르게 입력해주세요");
    if (!dropAmount || dropAmount <= 0) return alert("하락 금액을 올바르게 입력해주세요");
    if (!strategyDuration || strategyDuration <= 0) return alert("전략 시간을 올바르게 입력해주세요");
    if (isNaN(floorPrice) || floorPrice < 0) return alert("목표 하한가를 올바르게 입력해주세요");

    dispatch({
      type: "UPDATE_CONFIG",
      config: {
        productName: form.productName.trim() || DEFAULT_CONFIG.productName,
        description: form.description.trim() || DEFAULT_CONFIG.description,
        startPrice,
        dropAmount,
        strategyDuration,
        floorPrice,
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
  const fp = parseInt(form.floorPrice, 10);
  const gameDuration = sp > 0 && da > 0 ? Math.floor(sp / da) : null;
  const barDuration = sp > 0 && fp >= 0 && da > 0 && sp > fp ? Math.floor((sp - fp) / da) : null;

  return (
    <main className="min-h-screen bg-[#fffbf5] pb-16 max-w-md mx-auto">
      <div className="px-4 pt-10 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-black text-gray-900">관리자 설정</h1>
            <p className="text-gray-400 text-sm">Drop The Bid</p>
          </div>
          <button
            onClick={() => router.push("/")}
            className="text-gray-400 hover:text-orange-500 border border-gray-200 rounded-xl px-3 py-1.5 text-sm transition-colors bg-white shadow-sm"
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
              placeholder={DEFAULT_CONFIG.productName}
              className={INPUT}
            />
          </Field>

          <Field label="상품 설명">
            <input
              type="text"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder={DEFAULT_CONFIG.description}
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
            label="목표 하한가 (원) — 프로그레스 바 기준"
            hint={
              !isNaN(fp) && fp >= 0
                ? `${formatKRW(fp)} · ${barDuration != null ? `약 ${barDuration}초 소요` : ""}`
                : undefined
            }
          >
            <input
              type="number"
              value={form.floorPrice}
              onChange={(e) => set("floorPrice", e.target.value)}
              className={INPUT + " font-mono"}
              min={0}
            />
          </Field>

          <Field
            label="초당 하락 금액 (원/초)"
            hint={
              gameDuration != null
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
            label="전략 회의 시간 (초)"
            hint={
              !isNaN(sd) && sd > 0
                ? `${Math.floor(sd / 60)}분 ${sd % 60}초`
                : undefined
            }
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
            className={`w-full font-bold py-4 rounded-2xl text-base transition-all duration-300 active:scale-[0.98] shadow-md ${
              saved ? "bg-green-500 text-white" : "text-white"
            }`}
            style={
              saved
                ? undefined
                : {
                    background:
                      "linear-gradient(135deg,#fb923c 0%,#f97316 100%)",
                    boxShadow: "0 4px 16px rgba(249,115,22,0.3)",
                  }
            }
          >
            {saved ? "✅ 저장되었습니다!" : "설정 저장"}
          </button>

          <button
            onClick={handleReset}
            className="w-full bg-white border-2 border-gray-200 hover:border-red-300 hover:text-red-500 text-gray-500 font-semibold py-4 rounded-2xl text-base transition-all active:scale-[0.98]"
          >
            게임 리셋 &amp; 홈으로
          </button>
        </div>

        {/* Preview */}
        <div className="mt-8 bg-white rounded-3xl border border-gray-100 p-5 shadow-sm">
          <p className="text-gray-400 text-xs uppercase tracking-wider font-medium mb-4">
            저장된 설정
          </p>
          <div className="space-y-2.5">
            {[
              ["상품명", state.config.productName],
              ["상품 설명", state.config.description],
              ["시작가", formatKRW(state.config.startPrice)],
              ["목표 하한가", formatKRW(state.config.floorPrice)],
              ["하락 금액", `${formatKRW(state.config.dropAmount)}/초`],
              ["전략 시간", `${state.config.strategyDuration}초`],
              [
                "경매 시작",
                state.config.gameStartTime
                  ? new Date(state.config.gameStartTime).toLocaleString("ko-KR")
                  : "미설정",
              ],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between items-baseline gap-4"
              >
                <span className="text-gray-400 text-sm flex-shrink-0">{k}</span>
                <span className="text-gray-900 text-sm font-semibold text-right truncate">
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

const INPUT =
  "w-full bg-white border-2 border-gray-200 rounded-2xl px-4 py-3 text-gray-900 placeholder-gray-300 focus:outline-none focus:border-orange-400 transition-colors shadow-sm";

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
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-gray-400 text-xs mt-1.5">{hint}</p>}
    </div>
  );
}
