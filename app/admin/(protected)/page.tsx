"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useGame, formatKRW, DEFAULT_CONFIG, validateDropZones, type OperatorMessage } from "../../context/GameContext";
import { getServerNow } from "../../lib/serverClock";

const PHASE_LABEL: Record<string, string> = {
  home: "대기중 (waiting)",
  strategy: "전략 회의중",
  game: "경매 진행중",
  ended: "종료 (낙찰됨)",
};

function fmtElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}분 ${s}초`;
}

type PaymentStatus = {
  paymentComplete: boolean | null;
  stalePendingCount: number;
  reconciliationRequiredCount: number;
};

function MonitoringPanel() {
  const { state } = useGame();
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [now, setNow] = useState(() => getServerNow());

  // Payment-related figures come from a service-role-backed admin route
  // (Phase 8) — payment_attempts/orders are locked down since Phase 3.6/7
  // and were never meant to be readable from the browser. Everything else
  // on this panel (phase, counts, winner) is already live via useGame()'s
  // existing Realtime subscriptions, no new plumbing needed for those.
  async function refreshPaymentStatus() {
    try {
      const res = await fetch("/api/admin/payment-status");
      const data = await res.json();
      if (data.ok) {
        setPaymentStatus(data);
        setStatusError(false);
      } else {
        setStatusError(true);
      }
    } catch {
      setStatusError(true);
    }
  }

  useEffect(() => {
    refreshPaymentStatus();
    const t = setInterval(refreshPaymentStatus, 15_000);
    return () => clearInterval(t);
  }, []);

  // Ticks the "낙찰 후 경과시간" display once a second while a winner is
  // pending — same getServerNow()-based pattern the price ticker/strategy
  // countdown already use elsewhere in the app.
  useEffect(() => {
    if (!state.winner?.claimedAt) return;
    const t = setInterval(() => setNow(getServerNow()), 1000);
    return () => clearInterval(t);
  }, [state.winner?.claimedAt]);

  const elapsedSeconds = state.winner?.claimedAt != null
    ? Math.max(0, Math.floor((now - state.winner.claimedAt) / 1000))
    : null;

  return (
    <div className="bg-white rounded-3xl border border-gray-100 p-5 shadow-sm mb-8 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-xs uppercase tracking-wider font-medium">현재 상태</p>
        <button
          onClick={refreshPaymentStatus}
          className="text-gray-400 hover:text-orange-500 text-xs border border-gray-200 rounded-lg px-2 py-1"
        >
          새로고침
        </button>
      </div>

      <div className="flex justify-between items-baseline">
        <span className="text-gray-400 text-sm">phase</span>
        <span className="text-gray-900 text-sm font-semibold">{PHASE_LABEL[state.phase] ?? state.phase}</span>
      </div>
      <div className="flex justify-between items-baseline">
        <span className="text-gray-400 text-sm">참가자 / 관전자</span>
        <span className="text-gray-900 text-sm font-semibold">{state.participantCount}명 / {state.spectatorCount}명</span>
      </div>

      {state.winner && (
        <>
          <div className="border-t border-gray-100 pt-3 flex justify-between items-baseline">
            <span className="text-gray-400 text-sm">낙찰자</span>
            <span className="text-gray-900 text-sm font-semibold">{state.winner.nickname} · {formatKRW(state.winner.price)}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-gray-400 text-sm">낙찰자 ID</span>
            <span className="text-gray-500 text-xs font-mono">{state.winner.id}</span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-gray-400 text-sm">낙찰 후 경과</span>
            <span className="text-gray-900 text-sm font-semibold">
              {elapsedSeconds != null ? fmtElapsed(elapsedSeconds) : "—"}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-gray-400 text-sm">결제 상태</span>
            <span className={`text-sm font-semibold ${paymentStatus?.paymentComplete ? "text-green-600" : "text-red-500"}`}>
              {paymentStatus == null ? "확인 중..." : paymentStatus.paymentComplete ? "결제 완료" : "결제 미완료"}
            </span>
          </div>
        </>
      )}

      <div className="border-t border-gray-100 pt-3 flex justify-between items-baseline">
        <span className="text-gray-400 text-sm">결제 정체 (10분 이상 pending)</span>
        <span className={`text-sm font-semibold ${paymentStatus && paymentStatus.stalePendingCount > 0 ? "text-red-500" : "text-gray-900"}`}>
          {paymentStatus?.stalePendingCount ?? "—"}건
        </span>
      </div>
      <div className="flex justify-between items-baseline">
        <span className="text-gray-400 text-sm">수동 확인 필요 (reconciliation_required)</span>
        <span className={`text-sm font-semibold ${paymentStatus && paymentStatus.reconciliationRequiredCount > 0 ? "text-red-500" : "text-gray-900"}`}>
          {paymentStatus?.reconciliationRequiredCount ?? "—"}건
        </span>
      </div>

      {statusError && (
        <p className="text-red-500 text-xs">결제 현황을 불러오지 못했습니다. 새로고침을 눌러 다시 시도해주세요.</p>
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AdminPage() {
  const { state } = useGame();
  const router = useRouter();

  function toFormNum(n: number | null): string {
    return n == null ? "" : n.toString();
  }

  const [form, setForm] = useState({
    productName: state.config.productName,
    startPrice: state.config.startPrice.toString(),
    dropAmount: state.config.dropAmount.toString(),
    strategyDuration: state.config.strategyDuration.toString(),
    floorPrice: state.config.floorPrice.toString(),
    gameStartTime: state.config.gameStartTime ?? "",
    fastDropPrice: toFormNum(state.config.fastDropPrice),
    fastDropAmount: toFormNum(state.config.fastDropAmount),
    finalDropPrice: toFormNum(state.config.finalDropPrice),
    finalDropAmount: toFormNum(state.config.finalDropAmount),
    dropIntervalSeconds: state.config.dropIntervalSeconds.toString(),
    fastDropIntervalSeconds: state.config.fastDropIntervalSeconds.toString(),
    finalDropIntervalSeconds: state.config.finalDropIntervalSeconds.toString(),
  });
  const [saved, setSaved] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [operatorNickname, setOperatorNickname] = useState(state.config.operatorNickname);
  const [operatorMessages, setOperatorMessages] = useState<OperatorMessage[]>(state.config.operatorMessages);

  // Keep form in sync with state.config — fixes the init race where useState
  // captures DEFAULT_CONFIG before GameProvider's localStorage useEffect fires.
  useEffect(() => {
    setForm({
      productName: state.config.productName,
      startPrice: state.config.startPrice.toString(),
      dropAmount: state.config.dropAmount.toString(),
      strategyDuration: state.config.strategyDuration.toString(),
      floorPrice: state.config.floorPrice.toString(),
      gameStartTime: state.config.gameStartTime ? toLocalInput(state.config.gameStartTime) : "",
      fastDropPrice: toFormNum(state.config.fastDropPrice),
      fastDropAmount: toFormNum(state.config.fastDropAmount),
      finalDropPrice: toFormNum(state.config.finalDropPrice),
      finalDropAmount: toFormNum(state.config.finalDropAmount),
      dropIntervalSeconds: state.config.dropIntervalSeconds.toString(),
      fastDropIntervalSeconds: state.config.fastDropIntervalSeconds.toString(),
      finalDropIntervalSeconds: state.config.finalDropIntervalSeconds.toString(),
    });
    setOperatorNickname(state.config.operatorNickname);
    setOperatorMessages(state.config.operatorMessages);
  }, [state.config]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
    setZoneError(null);
  }

  // "" -> disabled (null); a bare "-" or partial input while typing -> NaN,
  // treated as "not yet a valid number" rather than silently 0.
  function toNum(s: string): number | null {
    if (s.trim() === "") return null;
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? null : n;
  }

  function handleSave() {
    const startPrice = parseInt(form.startPrice, 10);
    const dropAmount = parseInt(form.dropAmount, 10);
    const strategyDuration = parseInt(form.strategyDuration, 10);
    const floorPrice = parseInt(form.floorPrice, 10);

    // parseFloat, not parseInt — these allow sub-second values like 0.5.
    const dropIntervalSeconds      = parseFloat(form.dropIntervalSeconds);
    const fastDropIntervalSeconds  = parseFloat(form.fastDropIntervalSeconds);
    const finalDropIntervalSeconds = parseFloat(form.finalDropIntervalSeconds);

    if (!startPrice || startPrice <= 0) return alert("시작가를 올바르게 입력해주세요");
    if (!dropAmount || dropAmount <= 0) return alert("하락 금액을 올바르게 입력해주세요");
    if (!strategyDuration || strategyDuration <= 0) return alert("전략 시간을 올바르게 입력해주세요");
    if (isNaN(floorPrice) || floorPrice < 0) return alert("목표 하한가를 올바르게 입력해주세요");
    if (!dropIntervalSeconds || dropIntervalSeconds <= 0) return alert("NORMAL 하락 주기를 올바르게 입력해주세요");
    if (!fastDropIntervalSeconds || fastDropIntervalSeconds <= 0) return alert("FAST DROP 하락 주기를 올바르게 입력해주세요");
    if (!finalDropIntervalSeconds || finalDropIntervalSeconds <= 0) return alert("FINAL DROP 하락 주기를 올바르게 입력해주세요");

    const fastDropPrice   = toNum(form.fastDropPrice);
    const fastDropAmount  = toNum(form.fastDropAmount);
    const finalDropPrice  = toNum(form.finalDropPrice);
    const finalDropAmount = toNum(form.finalDropAmount);

    const err = validateDropZones({ startPrice, floorPrice, fastDropPrice, fastDropAmount, finalDropPrice, finalDropAmount });
    if (err) { setZoneError(err); return; }
    setZoneError(null);

    for (const row of operatorMessages) {
      if (isNaN(row.threshold) || row.threshold < 0 || row.threshold > 100) {
        return alert("운영자 메시지 구간(%)은 0~100 사이여야 합니다");
      }
    }

    // Server-side (service-role, admin-session-gated) write — see
    // app/api/admin/update-config/route.ts. Re-validates everything here
    // again (whitelisted fields + validateDropZones) so a raw REST call
    // bypassing this UI can't write an invalid or arbitrary config.
    fetch("/api/admin/update-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productName: form.productName.trim() || DEFAULT_CONFIG.productName,
        startPrice,
        dropAmount,
        strategyDuration,
        floorPrice,
        gameStartTime: form.gameStartTime ? new Date(form.gameStartTime).toISOString() : null,
        fastDropPrice,
        fastDropAmount,
        finalDropPrice,
        finalDropAmount,
        dropIntervalSeconds,
        fastDropIntervalSeconds,
        finalDropIntervalSeconds,
        operatorNickname: operatorNickname.trim() || DEFAULT_CONFIG.operatorNickname,
        operatorMessages,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "저장에 실패했습니다");
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      })
      .catch((e: Error) => setZoneError(e.message));
  }

  function handleReset() {
    if (!confirm("게임을 리셋할까요?")) return;
    // Server-side (service-role, admin-session-gated), single atomic RPC —
    // see app/api/admin/reset-game/route.ts and admin_reset_game() in
    // supabase/migrations/20260910140000_admin_security.sql.
    fetch("/api/admin/reset-game", { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (!data.ok) alert(data.error || "리셋에 실패했습니다");
      })
      .catch(() => alert("리셋에 실패했습니다"));
  }

  function handleForceStart() {
    if (!confirm("전략 회의를 건너뛰고 지금 바로 경매를 시작할까요?")) return;
    // Server-side (service-role, admin-session-gated), no time gate — see
    // app/api/admin/force-start-game/route.ts and admin_force_start_game()
    // in supabase/migrations/20260910150000_game_transition_security.sql.
    // Replaces the old public "바로시작" button that used to live on
    // /strategy with zero gating at all.
    fetch("/api/admin/force-start-game", { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (!data.ok) alert(data.error || "시작에 실패했습니다");
        else if (!data.started) alert("지금은 전략 회의 단계가 아니라 시작할 수 없습니다");
      })
      .catch(() => alert("시작에 실패했습니다"));
  }

  function handleClearStorage() {
    if (!confirm("저장된 설정을 모두 초기화하고 기본값으로 되돌릴까요?\n(페이지가 새로고침됩니다)")) return;
    try {
      // Clear all Drop The Bid keys
      Object.keys(localStorage)
        .filter((k) => k.startsWith("dtb_") || k.toLowerCase().includes("rabbit"))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore if localStorage is unavailable
    }
    window.location.reload();
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
            <Image
              src="/dtblogo.png"
              alt="Rabbit"
              width={48}
              height={48}
              style={{ width: 48, height: "auto" }}
              className="mb-2"
            />
            <h1 className="text-xl font-black text-gray-900">관리자 설정</h1>
            <p className="text-gray-400 text-sm">Rabbit</p>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <button
              onClick={() => router.push("/")}
              className="text-gray-400 hover:text-orange-500 border border-gray-200 rounded-xl px-3 py-1.5 text-sm transition-colors bg-white shadow-sm"
            >
              ← 홈
            </button>
            <button
              onClick={async () => {
                await fetch("/api/admin/logout", { method: "POST" });
                router.push("/admin/login");
              }}
              className="text-gray-400 hover:text-red-500 border border-gray-200 rounded-xl px-3 py-1.5 text-sm transition-colors bg-white shadow-sm"
            >
              로그아웃
            </button>
          </div>
        </div>

        <MonitoringPanel />

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
            label="초당 하락 금액 — NORMAL (원/초)"
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
            label="하락 주기 — NORMAL (초)"
            hint="몇 초에 한 번씩 계단식으로 떨어질지 — 1이면 매초 부드럽게, 0.5처럼 1보다 작게 잡으면 더 자주, 크게 잡으면 그 초마다 한 번에 뚝뚝 떨어져요"
          >
            <input
              type="number"
              value={form.dropIntervalSeconds}
              onChange={(e) => set("dropIntervalSeconds", e.target.value)}
              className={INPUT + " font-mono"}
              min={0.1}
              step={0.1}
            />
          </Field>

          {/* Drop zones — optional. Leaving FAST blank keeps the legacy
              single-rate NORMAL-only behavior; FINAL is only usable once
              FAST is set (validateDropZones enforces this, matching the
              DB CHECK constraints). */}
          <div className="pt-2 pb-1">
            <p className="text-xs font-bold uppercase tracking-wider text-orange-500">Drop Zone 설정</p>
            <p className="text-gray-400 text-xs mt-1">비워두면 NORMAL 속도로만 끝까지 진행돼요</p>
          </div>

          <Field label="FAST DROP ZONE 시작가 (원)">
            <input
              type="number"
              value={form.fastDropPrice}
              onChange={(e) => set("fastDropPrice", e.target.value)}
              placeholder="예: 700000"
              className={INPUT + " font-mono"}
              min={0}
            />
          </Field>

          <Field label="초당 하락 금액 — FAST DROP (원/초)">
            <input
              type="number"
              value={form.fastDropAmount}
              onChange={(e) => set("fastDropAmount", e.target.value)}
              placeholder="예: 2000"
              className={INPUT + " font-mono"}
              min={0}
            />
          </Field>

          <Field label="하락 주기 — FAST DROP (초)">
            <input
              type="number"
              value={form.fastDropIntervalSeconds}
              onChange={(e) => set("fastDropIntervalSeconds", e.target.value)}
              className={INPUT + " font-mono"}
              min={0.1}
              step={0.1}
            />
          </Field>

          <Field label="FINAL DROP ZONE 시작가 (원)">
            <input
              type="number"
              value={form.finalDropPrice}
              onChange={(e) => set("finalDropPrice", e.target.value)}
              placeholder="예: 600000"
              className={INPUT + " font-mono"}
              min={0}
            />
          </Field>

          <Field label="초당 하락 금액 — FINAL DROP (원/초)">
            <input
              type="number"
              value={form.finalDropAmount}
              onChange={(e) => set("finalDropAmount", e.target.value)}
              placeholder="예: 3000"
              className={INPUT + " font-mono"}
              min={0}
            />
          </Field>

          <Field label="하락 주기 — FINAL DROP (초)">
            <input
              type="number"
              value={form.finalDropIntervalSeconds}
              onChange={(e) => set("finalDropIntervalSeconds", e.target.value)}
              className={INPUT + " font-mono"}
              min={0.1}
              step={0.1}
            />
          </Field>

          {zoneError && (
            <p className="text-red-500 text-sm font-semibold bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {zoneError}
            </p>
          )}

          {/* Operator chat messages — a free list of {%, message} pairs, not
              fixed to 10%-steps, so the admin can add/remove/re-space
              thresholds without a code change. */}
          <div className="pt-2 pb-1">
            <p className="text-xs font-bold uppercase tracking-wider text-orange-500">운영자 메시지</p>
            <p className="text-gray-400 text-xs mt-1">가격이 시작가 대비 설정한 % 이하로 내려가는 순간, 채팅창에 운영자 닉네임으로 한 번씩 표시돼요. 메시지를 비워두면 해당 구간은 표시되지 않아요.</p>
          </div>

          <Field label="운영자 닉네임">
            <input
              type="text"
              value={operatorNickname}
              onChange={(e) => { setOperatorNickname(e.target.value); setSaved(false); }}
              placeholder={DEFAULT_CONFIG.operatorNickname}
              className={INPUT}
            />
          </Field>

          <div className="space-y-3">
            {operatorMessages.map((row, idx) => (
              <div key={idx} className="border-2 border-gray-200 rounded-2xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={row.threshold}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setOperatorMessages((list) => list.map((r, i) => (i === idx ? { ...r, threshold: Number.isNaN(v) ? 0 : v } : r)));
                      setSaved(false);
                    }}
                    className={INPUT + " font-mono w-20 flex-shrink-0 text-center px-2"}
                    min={0}
                    max={100}
                  />
                  <span className="text-gray-400 text-sm flex-shrink-0">%</span>
                  <button
                    type="button"
                    onClick={() => { setOperatorMessages((list) => list.filter((_, i) => i !== idx)); setSaved(false); }}
                    className="ml-auto flex-shrink-0 w-9 h-9 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"
                    aria-label="메시지 삭제"
                  >
                    ✕
                  </button>
                </div>
                <input
                  type="text"
                  value={row.message}
                  onChange={(e) => {
                    const v = e.target.value;
                    setOperatorMessages((list) => list.map((r, i) => (i === idx ? { ...r, message: v } : r)));
                    setSaved(false);
                  }}
                  placeholder="이 구간에서 보여줄 메시지"
                  className={INPUT + " w-full"}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => { setOperatorMessages((list) => [...list, { threshold: 0, message: "" }]); setSaved(false); }}
              className="w-full border-2 border-dashed border-gray-200 hover:border-orange-300 text-gray-400 hover:text-orange-500 font-semibold py-3 rounded-2xl text-sm transition-colors"
            >
              + 메시지 추가
            </button>
          </div>

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

          {state.phase === "strategy" && (
            <button
              onClick={handleForceStart}
              className="w-full bg-white border-2 border-gray-200 hover:border-orange-300 hover:text-orange-500 text-gray-500 font-semibold py-4 rounded-2xl text-base transition-all active:scale-[0.98]"
            >
              바로 시작 (전략 회의 건너뛰기)
            </button>
          )}

          <button
            onClick={handleReset}
            className="w-full bg-white border-2 border-gray-200 hover:border-red-300 hover:text-red-500 text-gray-500 font-semibold py-4 rounded-2xl text-base transition-all active:scale-[0.98]"
          >
            게임 리셋
          </button>

          <button
            onClick={handleClearStorage}
            className="w-full bg-white border-2 border-amber-200 hover:border-amber-400 text-amber-500 hover:text-amber-600 font-semibold py-4 rounded-2xl text-base transition-all active:scale-[0.98]"
          >
            저장값 초기화
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
              ["시작가", formatKRW(state.config.startPrice)],
              ["목표 하한가", formatKRW(state.config.floorPrice)],
              ["하락 금액 (NORMAL)", `${formatKRW(state.config.dropAmount)}/초 · ${state.config.dropIntervalSeconds}초마다`],
              ...(state.config.fastDropPrice != null && state.config.fastDropAmount != null
                ? [
                    ["FAST DROP ZONE", `${formatKRW(state.config.fastDropPrice)} 이하 · ${formatKRW(state.config.fastDropAmount)}/초 · ${state.config.fastDropIntervalSeconds}초마다`],
                  ]
                : [["FAST DROP ZONE", "미설정 (NORMAL 속도만 사용)"]]),
              ...(state.config.finalDropPrice != null && state.config.finalDropAmount != null
                ? [
                    ["FINAL DROP ZONE", `${formatKRW(state.config.finalDropPrice)} 이하 · ${formatKRW(state.config.finalDropAmount)}/초 · ${state.config.finalDropIntervalSeconds}초마다`],
                  ]
                : []),
              ["전략 시간", `${state.config.strategyDuration}초`],
              [
                "운영자 메시지",
                `${state.config.operatorMessages.filter((m) => m.message.trim()).length}개 등록됨 · 닉네임 "${state.config.operatorNickname}"`,
              ],
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
