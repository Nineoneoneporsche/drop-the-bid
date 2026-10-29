// Where the round stands relative to its scheduled start T
// (game_state.scheduled_start_at) and join lead N
// (game_state.participant_join_lead_minutes). Pure (no React/Supabase) so
// it can be unit-tested; pages feed it getServerNow() (app/lib/serverClock.ts),
// never a raw Date.now().
//
// UX only: the DB decides. join_game_participant() admits a participant iff
// T - N <= now() < T, start_game() starts at T with game_started_at = T, both
// by the DB's own clock (supabase/migrations/20261030100000_scheduled_start_join_window.sql).

export type ScheduleStatus =
  | "noSchedule"            // no T: no auction scheduled
  | "beforeJoinWindow"      // now < T - N
  | "joinOpen"              // T - N <= now < T
  | "starting"              // now >= T, participants waiting for start_game()
  | "missedNoParticipants"  // now >= T, nobody joined: start_game() won't start it
  | "game"
  | "ended";

export type ScheduleInput = {
  phase: string;                   // client phase: home (= waiting) | strategy | game | ended
  scheduledStartMs: number | null; // T
  leadMinutes: number;             // N
  nowMs: number;                   // server-synced clock
  participantCount: number;
};

export const DEFAULT_JOIN_LEAD_MINUTES = 30;
export const MIN_JOIN_LEAD_MINUTES = 1;
export const MAX_JOIN_LEAD_MINUTES = 180;

export function isValidJoinLeadMinutes(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_JOIN_LEAD_MINUTES && n <= MAX_JOIN_LEAD_MINUTES;
}

export function parseScheduledStart(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function joinOpensAtMs(scheduledStartMs: number, leadMinutes: number): number {
  return scheduledStartMs - leadMinutes * 60_000;
}

export function scheduleStatus(i: ScheduleInput): ScheduleStatus {
  if (i.phase === "game") return "game";
  if (i.phase === "ended") return "ended";
  if (i.scheduledStartMs == null) return "noSchedule";
  if (i.nowMs < joinOpensAtMs(i.scheduledStartMs, i.leadMinutes)) return "beforeJoinWindow";
  if (i.nowMs < i.scheduledStartMs) return "joinOpen";
  return i.phase === "strategy" && i.participantCount > 0 ? "starting" : "missedNoParticipants";
}

export const canJoinAsParticipant = (s: ScheduleStatus) => s === "joinOpen";

// LIVE only while the auction is actually running.
export const showLive = (phase: string) => phase === "game";

// Whole seconds left until `targetMs`, rounded up: "00:01" until the last
// millisecond, "00:00" exactly at the target.
export function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

// MM:SS, or HH:MM:SS from one hour on (N can be up to 180 minutes).
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const p = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${p(h)}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

// Fraction of the whole T - N -> T window still left (1 at T - N, 0 at T) —
// the same for everyone, however late they joined.
export function joinWindowRemaining(scheduledStartMs: number, leadMinutes: number, nowMs: number): number {
  const total = leadMinutes * 60_000;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (scheduledStartMs - nowMs) / total));
}

export type HomeCta =
  | { kind: "join"; label: string; sub: string }
  | { kind: "watch"; label: string; sub: string }
  | { kind: "disabled"; label: string; sub: string };

// The home page's main button for each status.
export function homeCta(status: ScheduleStatus, i: Pick<ScheduleInput, "scheduledStartMs" | "leadMinutes" | "nowMs">): HomeCta {
  const T = i.scheduledStartMs;
  switch (status) {
    case "joinOpen":
      return { kind: "join", label: "경매 참여하기", sub: `경매 시작까지 ${formatCountdown(secondsUntil(T!, i.nowMs))}` };
    case "beforeJoinWindow":
      return {
        kind: "disabled",
        label: `참가 오픈까지 ${formatCountdown(secondsUntil(joinOpensAtMs(T!, i.leadMinutes), i.nowMs))}`,
        sub: `경매 시작 ${i.leadMinutes}분 전부터 참가할 수 있어요`,
      };
    case "game":
      return { kind: "watch", label: "관전하기", sub: "경매가 진행 중입니다 · 관전만 가능합니다" };
    case "starting":
      return { kind: "disabled", label: "곧 경매가 시작됩니다", sub: "참가 접수가 마감되었습니다" };
    case "missedNoParticipants":
      return { kind: "disabled", label: "경매가 시작되지 않았습니다", sub: "참가자가 없어 경매가 시작되지 않았습니다" };
    case "ended":
      return { kind: "disabled", label: "경매가 종료되었습니다", sub: "다음 경매를 기다려주세요" };
    case "noSchedule":
      return { kind: "disabled", label: "예정된 경매가 없습니다", sub: "다음 경매 일정을 기다려주세요" };
  }
}
