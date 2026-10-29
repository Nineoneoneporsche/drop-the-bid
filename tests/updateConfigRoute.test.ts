// POST /api/admin/update-config after M3: the schedule (T, N) goes through
// admin_update_schedule() only when it changes; round inputs (product /
// prices / drop settings) are written by one conditional UPDATE
// `... .eq("id", 1).in("phase", ["waiting"])` — the DB decides
// atomically, 0 rows = locked. Admin auth and Supabase are faked; the
// fake applies the phase filter the way Postgres would.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  row: {} as Row,
  rpcCalls: [] as { fn: string; args: Row }[],
  rpcError: null as null | { message: string },
  updates: [] as { changes: Row; phases: string[] | null }[],
}));

vi.mock("../app/lib/adminAuth", () => ({
  requireAdminSession: async () => true,
  isSameOrigin: () => true,
  getSupabaseAdmin: () => ({
    rpc: async (fn: string, args: Row) => {
      db.rpcCalls.push({ fn, args });
      if (db.rpcError) return { error: db.rpcError };
      db.row.scheduled_start_at = args.p_start;
      db.row.participant_join_lead_minutes = args.p_lead_minutes;
      return { error: null };
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { ...db.row }, error: null }) }) }),
      update: (changes: Row) => {
        let phases: string[] | null = null;
        const apply = () => {
          db.updates.push({ changes, phases });
          if (phases && !phases.includes(db.row.phase as string)) return [];
          Object.assign(db.row, changes);
          return [{ id: 1 }];
        };
        const q = {
          eq: () => q,
          in: (_c: string, v: string[]) => { phases = v; return q; },
          select: async () => ({ data: apply(), error: null }),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: (apply(), null) }).then(res),
        };
        return q;
      },
    }),
  }),
}));

const { POST } = await import("../app/api/admin/update-config/route");
const post = async (body: Row) => {
  const res = await POST(new NextRequest("http://localhost/api/admin/update-config", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
};

const T = "2026-10-30T11:00:30.000Z"; // seconds the admin form can't show
const FORM = {
  productName: "상품", startPrice: 899000, dropAmount: 1000, floorPrice: 550000,
  fastDropPrice: null, fastDropAmount: null, finalDropPrice: null, finalDropAmount: null,
  dropIntervalSeconds: 1, fastDropIntervalSeconds: 1, finalDropIntervalSeconds: 1,
  operatorNickname: "운영자", operatorMessages: [],
};

beforeEach(() => {
  db.row = {
    phase: "waiting", product_name: "상품", start_price: 899000, drop_amount: 1000, minimum_price: 550000,
    fast_drop_price: null, fast_drop_amount: null, final_drop_price: null, final_drop_amount: null,
    drop_interval_seconds: 1, fast_drop_interval_seconds: 1, final_drop_interval_seconds: 1,
    operator_nickname: "운영자", operator_messages: [], scheduled_start_at: T, participant_join_lead_minutes: 30,
  };
  db.rpcCalls = []; db.rpcError = null; db.updates = [];
});

describe("schedule (T, N) via admin_update_schedule", () => {
  it("waiting: a new T and N go to the RPC together", async () => {
    const r = await post({ ...FORM, gameStartTime: "2026-10-30T12:00:00.000Z", joinLeadMinutes: 10 });
    expect(r).toEqual({ status: 200, json: { ok: true } });
    expect(db.rpcCalls).toEqual([{ fn: "admin_update_schedule", args: { p_start: "2026-10-30T12:00:00.000Z", p_lead_minutes: 10 } }]);
  });

  it("only N changed -> RPC keeps the stored T (with its seconds)", async () => {
    await post({ ...FORM, joinLeadMinutes: 45 });
    expect(db.rpcCalls[0].args).toEqual({ p_start: T, p_lead_minutes: 45 });
  });

  it("the same T to the minute (form precision) and same N -> no RPC, T keeps its seconds", async () => {
    await post({ ...FORM, gameStartTime: "2026-10-30T11:00:00.000Z", joinLeadMinutes: 30 });
    expect(db.rpcCalls).toEqual([]);
    expect(db.row.scheduled_start_at).toBe(T);
  });

  it("clearing T -> RPC with null", async () => {
    await post({ ...FORM, gameStartTime: null });
    expect(db.rpcCalls[0].args).toEqual({ p_start: null, p_lead_minutes: 30 });
  });

  it("N outside 1..180, fractional or not a number -> 400 before any write", async () => {
    for (const n of [0, 181, -1, 1.5, "30"]) {
      const r = await post({ ...FORM, joinLeadMinutes: n });
      expect(r.status).toBe(400);
      expect(r.json.code).toBe("SCHEDULE_INVALID_LEAD");
    }
    expect(db.rpcCalls).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it("a malformed T -> 400", async () => {
    expect((await post({ ...FORM, gameStartTime: "tomorrow-ish" })).status).toBe(400);
    expect(db.rpcCalls).toEqual([]);
  });

  it("7. strategy: a T / N change is still refused by admin_update_schedule (waiting only) -> 409 SCHEDULE_LOCKED", async () => {
    db.row.phase = "strategy";
    db.rpcError = { message: "schedule_locked:not_waiting" };
    const r = await post({ ...FORM, joinLeadMinutes: 10 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SCHEDULE_LOCKED");
    expect(db.rpcCalls).toHaveLength(1);
  });

  it("DB refusals map to stable codes, and nothing else is written", async () => {
    for (const [message, status, code] of [
      ["schedule_locked:not_waiting", 409, "SCHEDULE_LOCKED"],
      ["schedule_invalid:start_too_soon", 400, "SCHEDULE_START_TOO_SOON"],
      ["schedule_invalid:lead_minutes", 400, "SCHEDULE_INVALID_LEAD"],
    ] as const) {
      db.rpcError = { message };
      const r = await post({ ...FORM, startPrice: 700000, gameStartTime: "2026-10-30T12:00:00.000Z" });
      expect(r.status).toBe(status);
      expect(r.json.code).toBe(code);
    }
    expect(db.updates).toEqual([]);
    expect(db.row.start_price).toBe(899000);
  });
});

describe("round inputs: one conditional UPDATE, phase = waiting only", () => {
  it("1. waiting: price / drop / zone / product changes are written with the phase filter", async () => {
    for (const change of [
      { startPrice: 950000 }, { floorPrice: 500000 }, { dropAmount: 5 }, { dropIntervalSeconds: 2 },
      { fastDropPrice: 700000, fastDropAmount: 2000, fastDropIntervalSeconds: 0.5 },
      { fastDropPrice: 700000, fastDropAmount: 2000, finalDropPrice: 600000, finalDropAmount: 3000, finalDropIntervalSeconds: 3 },
      { productName: "다른 상품" },
    ]) {
      const r = await post({ ...FORM, ...change });
      expect(r).toEqual({ status: 200, json: { ok: true } });
      const last = db.updates.at(-1)!;
      expect(last.phases).toEqual(["waiting"]);
      expect(db.row).toMatchObject(last.changes); // applied
    }
  });

  it("2-4. strategy / game / ended: any product / price / drop / zone change -> 409 CONFIG_LOCKED, nothing written", async () => {
    for (const phase of ["strategy", "game", "ended"]) {
      db.row.phase = phase;
      for (const change of [
        { startPrice: 950000 }, { floorPrice: 500000 }, { dropAmount: 5 }, { dropIntervalSeconds: 2 },
        { fastDropPrice: 700000, fastDropAmount: 2000 }, { fastDropIntervalSeconds: 2 }, { finalDropIntervalSeconds: 2 },
        { productName: "다른 상품" },
      ]) {
        const r = await post({ ...FORM, ...change });
        expect(r.status).toBe(409);
        expect(r.json.code).toBe("CONFIG_LOCKED");
      }
      expect(db.row).toMatchObject({ start_price: 899000, minimum_price: 550000, drop_amount: 1000, product_name: "상품", fast_drop_price: null });
    }
  });

  it("5. strategy stays locked with no participant left (the route never looks at participants, only the phase)", async () => {
    db.row.phase = "strategy"; // every participant left; phase is not rolled back
    const r = await post({ ...FORM, startPrice: 950000 });
    expect(r.status).toBe(409);
    expect(db.updates.at(-1)).toEqual({ changes: { start_price: 950000 }, phases: ["waiting"] });
    expect(db.row.start_price).toBe(899000);
  });

  it("game: re-saving the unchanged form (as the admin page does) is a no-op, not an error", async () => {
    db.row.phase = "game";
    expect(await post({ ...FORM })).toEqual({ status: 200, json: { ok: true } });
    expect(db.updates).toEqual([]);
  });

  it("6. strategy / game: operator messages and nickname alone stay editable (no round input)", async () => {
    for (const phase of ["strategy", "game"]) {
      db.row.phase = phase;
      const msgs = [{ threshold: 50, message: `반값! ${phase}` }];
      const r = await post({ ...FORM, operatorNickname: `운영자-${phase}`, operatorMessages: msgs });
      expect(r.status).toBe(200);
      expect(db.updates.at(-1)).toEqual({ changes: { operator_nickname: `운영자-${phase}`, operator_messages: msgs }, phases: null });
    }
  });

  it("strategy: a price change bundled with operator messages is refused as a whole", async () => {
    db.row.phase = "strategy";
    const r = await post({ ...FORM, startPrice: 950000, operatorMessages: [{ threshold: 50, message: "x" }] });
    expect(r.status).toBe(409);
    expect(db.row.operator_messages).toEqual([]);
  });

  it("strategyDuration is no longer accepted (ignored)", async () => {
    await post({ ...FORM, strategyDuration: 5 });
    expect(db.updates).toEqual([]);
  });
});
