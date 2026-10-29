// Client side of M3: the derived schedule status (app/lib/auctionSchedule.ts)
// the home / join / strategy pages render from, the home button per status,
// the T countdown, LIVE only in game, and that those pages take their time
// from the server-synced clock. Plus the force-start route.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  canJoinAsParticipant, formatCountdown, homeCta, isValidJoinLeadMinutes, joinOpensAtMs, joinWindowRemaining,
  parseScheduledStart, scheduleStatus, secondsUntil, showLive, type ScheduleInput,
} from "../app/lib/auctionSchedule";

const T = Date.parse("2026-10-30T11:00:00.000Z");
const MIN = 60_000;
const at = (nowMs: number, extra: Partial<ScheduleInput> = {}): ScheduleInput =>
  ({ phase: "home", scheduledStartMs: T, leadMinutes: 30, nowMs, participantCount: 0, ...extra });

describe("scheduleStatus", () => {
  it("noSchedule: no T (any pre-game phase)", () => {
    expect(scheduleStatus(at(T, { scheduledStartMs: null }))).toBe("noSchedule");
    expect(scheduleStatus(at(T, { scheduledStartMs: null, phase: "strategy" }))).toBe("noSchedule");
  });
  it("beforeJoinWindow until T - N; joinOpen from exactly T - N (1 ms boundary)", () => {
    expect(scheduleStatus(at(T - 30 * MIN - 1))).toBe("beforeJoinWindow");
    expect(scheduleStatus(at(T - 30 * MIN))).toBe("joinOpen");
    expect(scheduleStatus(at(T - 30 * MIN, { leadMinutes: 5 }))).toBe("beforeJoinWindow");
    expect(scheduleStatus(at(T - 5 * MIN, { leadMinutes: 5 }))).toBe("joinOpen");
  });
  it("joinOpen until 1 ms before T, waiting or strategy", () => {
    expect(scheduleStatus(at(T - 1))).toBe("joinOpen");
    expect(scheduleStatus(at(T - 1, { phase: "strategy", participantCount: 3 }))).toBe("joinOpen");
  });
  it("at T: participants waiting -> starting; nobody -> missedNoParticipants", () => {
    expect(scheduleStatus(at(T, { phase: "strategy", participantCount: 2 }))).toBe("starting");
    expect(scheduleStatus(at(T))).toBe("missedNoParticipants");
    expect(scheduleStatus(at(T + 3_600_000))).toBe("missedNoParticipants");
    expect(scheduleStatus(at(T, { phase: "strategy", participantCount: 0 }))).toBe("missedNoParticipants");
  });
  it("game / ended win over the clock", () => {
    expect(scheduleStatus(at(T - 60 * MIN, { phase: "game" }))).toBe("game");
    expect(scheduleStatus(at(T, { phase: "ended" }))).toBe("ended");
  });
  it("only joinOpen admits a participant", () => {
    for (const s of ["noSchedule", "beforeJoinWindow", "starting", "missedNoParticipants", "game", "ended"] as const) {
      expect(canJoinAsParticipant(s)).toBe(false);
    }
    expect(canJoinAsParticipant("joinOpen")).toBe(true);
  });
});

describe("countdown to T", () => {
  it("every participant counts down to the same T, whenever they joined", () => {
    expect(formatCountdown(secondsUntil(T, T - (23 * 60 + 14) * 1000))).toBe("23:14");
    expect(formatCountdown(secondsUntil(T, T - (2 * 60 + 7) * 1000))).toBe("02:07");
    expect(formatCountdown(secondsUntil(T, T - 10_000))).toBe("00:10");
  });
  it("rounds up: 00:01 until the last ms, 00:00 at T and after", () => {
    expect(secondsUntil(T, T - 1)).toBe(1);
    expect(secondsUntil(T, T)).toBe(0);
    expect(secondsUntil(T, T + 5000)).toBe(0);
  });
  it("HH:MM:SS from one hour on (N up to 180 min)", () => {
    expect(formatCountdown(3599)).toBe("59:59");
    expect(formatCountdown(3600)).toBe("01:00:00");
    expect(formatCountdown(180 * 60)).toBe("03:00:00");
  });
  it("progress bar: the whole T - N -> T window, the same for early and late joiners", () => {
    expect(joinWindowRemaining(T, 30, T - 30 * MIN)).toBe(1);
    expect(joinWindowRemaining(T, 30, T - 15 * MIN)).toBe(0.5);
    expect(joinWindowRemaining(T, 30, T)).toBe(0);
    expect(joinWindowRemaining(T, 30, T - 90 * MIN)).toBe(1);
  });
  it("join opens at T - N", () => {
    expect(joinOpensAtMs(T, 30)).toBe(T - 30 * MIN);
    expect(parseScheduledStart("2026-10-30T11:00:00.000Z")).toBe(T);
    expect(parseScheduledStart(null)).toBeNull();
    expect(parseScheduledStart("garbage")).toBeNull();
  });
});

describe("home button per status", () => {
  const cta = (nowMs: number, extra: Partial<ScheduleInput> = {}) => {
    const i = at(nowMs, extra);
    return homeCta(scheduleStatus(i), i);
  };
  it("before the window: disabled, '참가 오픈까지 12:34'", () => {
    expect(cta(T - 30 * MIN - (12 * 60 + 34) * 1000)).toMatchObject({ kind: "disabled", label: "참가 오픈까지 12:34" });
  });
  it("window open: enabled join, with the T countdown", () => {
    expect(cta(T - 20 * MIN)).toEqual({ kind: "join", label: "경매 참여하기", sub: "경매 시작까지 20:00" });
  });
  it("no T / missed / starting / ended: disabled; game: watch", () => {
    expect(cta(T, { scheduledStartMs: null })).toMatchObject({ kind: "disabled", label: "예정된 경매가 없습니다" });
    expect(cta(T)).toMatchObject({ kind: "disabled", sub: "참가자가 없어 경매가 시작되지 않았습니다" });
    expect(cta(T, { phase: "strategy", participantCount: 1 })).toMatchObject({ kind: "disabled" });
    expect(cta(T, { phase: "ended" })).toMatchObject({ kind: "disabled" });
    expect(cta(T, { phase: "game" })).toMatchObject({ kind: "watch", label: "관전하기" });
  });
  it("LIVE only in game", () => {
    expect(["home", "strategy", "ended"].map(showLive)).toEqual([false, false, false]);
    expect(showLive("game")).toBe(true);
  });
});

describe("admin N validation", () => {
  it("integers 1..180 only", () => {
    for (const ok of [1, 5, 30, 60, 180]) expect(isValidJoinLeadMinutes(ok)).toBe(true);
    for (const bad of [0, -1, 181, 1.5, NaN, "30", null, undefined]) expect(isValidJoinLeadMinutes(bad)).toBe(false);
  });
});

describe("pages: server-synced clock, schedule status, LIVE gated", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", "app", p), "utf8").replace(/\/\/.*$/gm, "");
  it("home and join never read raw Date.now(); both use getServerNow + scheduleStatus", () => {
    for (const p of ["page.tsx", "join/page.tsx"]) {
      const s = src(p);
      expect(s).not.toMatch(/Date\.now\(\)/);
      expect(s).toMatch(/getServerNow\(\)/);
      expect(s).toMatch(/scheduleStatus\(/);
    }
  });
  it("every LIVE badge is behind showLive(phase)", () => {
    for (const p of ["page.tsx", "strategy/page.tsx"]) {
      const s = src(p);
      const badges = [...s.matchAll(/^\s*LIVE\s*$/gm)].length;
      expect(badges).toBe(1);
      expect(s).toMatch(/\{showLive\((state\.)?phase\) && \([\s\S]{0,400}?LIVE/);
    }
  });
  it("strategy countdown is T - getServerNow(), no fixed strategy duration anywhere", () => {
    const s = src("strategy/page.tsx");
    expect(s).toMatch(/secondsUntil\(startAtMs, now\)/);
    for (const p of ["page.tsx", "strategy/page.tsx", "join/page.tsx", "context/GameContext.tsx", "admin/(protected)/page.tsx"]) {
      expect(src(p)).not.toMatch(/strategyDuration|strategy_duration/);
    }
  });
  it("auto start fires start_game at T (scheduled start), not after strategy_started_at", () => {
    const s = src("context/GameContext.tsx");
    expect(s).toMatch(/const wait = startAtMs - getServerNow\(\);/);
    expect(s).toMatch(/supabase\.rpc\("start_game"\)/);
  });
});

// ── POST /api/admin/force-start-game ─────────────────────────────────────────
const fs = vi.hoisted(() => ({ data: true as unknown, error: null as null | { message: string }, calls: [] as string[] }));
vi.mock("../app/lib/adminAuth", () => ({
  requireAdminSession: async () => true,
  isSameOrigin: () => true,
  getSupabaseAdmin: () => ({ rpc: async (fn: string) => { fs.calls.push(fn); return { data: fs.data, error: fs.error }; } }),
}));
const { POST: forceStart } = await import("../app/api/admin/force-start-game/route");

describe("force-start route", () => {
  beforeEach(() => { fs.data = true; fs.error = null; fs.calls = []; });
  const call = async () => {
    const res = await forceStart(new NextRequest("http://localhost/api/admin/force-start-game", { method: "POST" }));
    return { status: res.status, json: await res.json() };
  };
  it("started -> { started: true } via admin_force_start_game", async () => {
    expect(await call()).toEqual({ status: 200, json: { ok: true, started: true } });
    expect(fs.calls).toEqual(["admin_force_start_game"]);
  });
  it("refused by the DB (no participant / not pre-game) -> started false, not an error", async () => {
    fs.data = false;
    expect(await call()).toEqual({ status: 200, json: { ok: true, started: false } });
  });
  it("RPC error -> 500", async () => {
    fs.error = { message: "boom" };
    expect((await call()).status).toBe(500);
  });
});
