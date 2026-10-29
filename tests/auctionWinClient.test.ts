// Client side of code deploy 1: where the browser gets a win's id, price,
// product and deadline from (auction_wins), how winId is carried through
// the pending-confirm recovery, the deadline-based recovery CTA rule, My
// Page savings, and that no browser code selects("*") from auction_wins.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUCTION_WIN_CLIENT_COLUMNS, fetchMyCurrentWin, isWinId, type WinLookupClient } from "../app/lib/auctionWin";
import { PENDING_CONFIRM_KEY, readPendingConfirm, resumeConfirmUrl, savePendingConfirm } from "../app/lib/pendingConfirm";
import { isPendingWin, pendingSecondsLeft, type PendingWinInput } from "../app/lib/pendingWinRule";
import { checkPaymentDeadline, secondsUntilDeadline, WINNER_PAYMENT_WINDOW_SECONDS } from "../app/lib/paymentWindow";
import { buildOrderStats } from "../app/lib/orderStats";

const WIN_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ROUND = "11111111-2222-4333-8444-555555555555";
const CLAIMED = "2026-10-29T03:00:00.000Z";
const DEADLINE = "2026-10-29T03:30:00.000Z";
const WIN = {
  id: WIN_ID, round_key: ROUND, winner_nickname: "me", product_name: "라운드 상품", start_price: 899_000,
  winning_price: 512_000, claimed_at: CLAIMED, payment_deadline: DEADLINE,
};

type Call = { table: string; columns: string; filter: [string, unknown] };
function fakeClient(opts: { roundKey?: string | null; gsError?: boolean; win?: Record<string, unknown> | null; winError?: boolean }) {
  const calls: Call[] = [];
  const client: WinLookupClient = {
    from: (table) => ({
      select: (columns) => ({
        eq: (col, val) => {
          calls.push({ table, columns, filter: [col, val] });
          return {
            single: async () => opts.gsError ? { data: null, error: { message: "down" } } : { data: { round_key: opts.roundKey ?? null }, error: null },
            maybeSingle: async () => opts.winError ? { data: null, error: { message: "down" } } : { data: opts.win ?? null, error: null },
          };
        },
      }),
    }),
  };
  return { client, calls };
}

describe("payment page win lookup (fetchMyCurrentWin)", () => {
  it("normal new win: current game_state.round_key -> the user's auction_wins row -> winId", async () => {
    const { client, calls } = fakeClient({ roundKey: ROUND, win: WIN });
    expect(await fetchMyCurrentWin(client)).toEqual({ status: "ok", win: WIN });
    expect(calls).toEqual([
      { table: "game_state", columns: "round_key", filter: ["id", 1] },
      { table: "auction_wins", columns: AUCTION_WIN_CLIENT_COLUMNS, filter: ["round_key", ROUND] },
    ]);
  });

  it("selects exactly the 8 columns authenticated may read (no *, winner_id or price_inputs)", () => {
    expect(AUCTION_WIN_CLIENT_COLUMNS.split(",").map((c) => c.trim()).sort()).toEqual(
      ["claimed_at", "id", "payment_deadline", "product_name", "round_key", "start_price", "winner_nickname", "winning_price"]);
  });

  it("no row for this user (RLS hides other winners' rows) -> none", async () => {
    expect(await fetchMyCurrentWin(fakeClient({ roundKey: ROUND, win: null }).client)).toEqual({ status: "none" });
  });

  it("no round_key yet -> none, without querying auction_wins", async () => {
    const { client, calls } = fakeClient({ roundKey: null });
    expect(await fetchMyCurrentWin(client)).toEqual({ status: "none" });
    expect(calls).toHaveLength(1);
  });

  it("lookup failures are 'error', not 'none'", async () => {
    expect(await fetchMyCurrentWin(fakeClient({ gsError: true }).client)).toEqual({ status: "error" });
    expect(await fetchMyCurrentWin(fakeClient({ roundKey: ROUND, winError: true }).client)).toEqual({ status: "error" });
  });

  it("a row without a valid id is not a usable win", async () => {
    expect(await fetchMyCurrentWin(fakeClient({ roundKey: ROUND, win: { ...WIN, id: "x" } }).client)).toEqual({ status: "none" });
  });
});

describe("winId validation", () => {
  it("accepts UUIDs only", () => {
    expect(isWinId(WIN_ID)).toBe(true);
    expect(isWinId(WIN_ID.toUpperCase())).toBe(true);
    for (const bad of ["", "x", WIN_ID.replace(/-/g, ""), `${WIN_ID}x`, ` ${WIN_ID}`, null, undefined, 1]) expect(isWinId(bad)).toBe(false);
  });
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, raw: m };
}

describe("pending confirm keeps winId", () => {
  const NOW = Date.parse("2026-10-29T03:05:00Z");
  const BODY = { paymentKey: "tgen_20261029abc-1", orderId: "DTB-1791267637417-WXJQ2", amount: 512_000, winId: WIN_ID };

  it("saves and reads back winId", () => {
    const s = memoryStorage();
    expect(savePendingConfirm(BODY, NOW, s)).toBe(true);
    expect(readPendingConfirm(NOW + 1000, s)).toEqual({ ...BODY, savedAt: NOW });
  });

  it("resume URL carries winId (fixed path, URL-encoded)", () => {
    expect(resumeConfirmUrl(BODY)).toBe(`/payment/success?paymentKey=tgen_20261029abc-1&orderId=DTB-1791267637417-WXJQ2&amount=512000&winId=${WIN_ID}`);
  });

  it("a malformed stored winId invalidates the entry (removed)", () => {
    const s = memoryStorage();
    s.setItem(PENDING_CONFIRM_KEY, JSON.stringify({ ...BODY, winId: "javascript:alert(1)", savedAt: NOW }));
    expect(readPendingConfirm(NOW + 1000, s)).toBeNull();
    expect(s.raw.has(PENDING_CONFIRM_KEY)).toBe(false);
    expect(savePendingConfirm({ ...BODY, winId: "nope" }, NOW, s)).toBe(false);
  });

  it("a pre-M1 entry without winId still parses (the server refuses it as a new approval)", () => {
    const s = memoryStorage();
    const { winId: _, ...legacy } = BODY;
    savePendingConfirm(legacy, NOW, s);
    expect(readPendingConfirm(NOW + 1000, s)).toEqual({ ...legacy, savedAt: NOW });
    expect(resumeConfirmUrl(legacy)).not.toContain("winId");
  });
});

describe("payment deadline helpers", () => {
  const at = (s: number) => new Date(Date.parse(CLAIMED) + s * 1000).toISOString();
  it("checkPaymentDeadline refuses from the stored deadline on", () => {
    expect(checkPaymentDeadline(DEADLINE, at(1799))).toMatchObject({ ok: true });
    expect(checkPaymentDeadline(DEADLINE, DEADLINE)).toMatchObject({ ok: false, reason: "expired" });
    expect(checkPaymentDeadline(null, at(1))).toMatchObject({ ok: false });
    expect(checkPaymentDeadline(DEADLINE, "garbage")).toMatchObject({ ok: false, reason: "invalid_time" });
  });
  it("secondsUntilDeadline counts down to 0 exactly at the deadline", () => {
    const d = Date.parse(DEADLINE);
    expect(secondsUntilDeadline(d, d - 1800_000)).toBe(WINNER_PAYMENT_WINDOW_SECONDS);
    expect(secondsUntilDeadline(d, d - 500)).toBe(1);
    expect(secondsUntilDeadline(d, d)).toBe(0);
    expect(secondsUntilDeadline(d, d + 5000)).toBe(0);
  });
});

describe("recovery CTA uses auction_wins.payment_deadline", () => {
  const claimed = Date.parse(CLAIMED);
  const base: PendingWinInput = {
    userId: "me", phase: "ended", winner: { id: "me", claimedAt: claimed },
    win: { id: WIN_ID, deadlineMs: claimed + 600_000 }, hasOrder: false, nowMs: claimed + 60_000,
  };
  it("counts down to the stored deadline, not claimedAt + the constant", () => {
    expect(pendingSecondsLeft(base)).toBe(540);
    expect(isPendingWin({ ...base, nowMs: claimed + 600_000 })).toBe(false);
    // Without a win row (legacy) the same moment is still inside the window.
    expect(isPendingWin({ ...base, win: null, nowMs: claimed + 600_000 })).toBe(true);
  });
  it("hidden once the win has an order", () => {
    expect(isPendingWin({ ...base, hasOrder: true })).toBe(false);
    expect(isPendingWin({ ...base, hasOrder: null })).toBe(false);
  });
});

describe("My Page savings (orderStats)", () => {
  const wins = [{ id: WIN_ID, product_name: "그 라운드 상품", start_price: 1_200_000, winning_price: 700_000 }];
  it("new order: product / start price / price from its auction_wins row", () => {
    const r = buildOrderStats(
      [{ product_name: "orders 컬럼 값", amount: 700_000, created_at: CLAIMED, win_id: WIN_ID }], wins, 899_000);
    expect(r.orders[0]).toEqual({ product_name: "그 라운드 상품", amount: 700_000, created_at: CLAIMED, start_price: 1_200_000 });
    expect(r.savings).toBe(500_000);
    expect(r.wins).toBe(1);
  });
  it("legacy order (win_id null) keeps the current game_state.start_price fallback", () => {
    const r = buildOrderStats([{ product_name: "옛 상품", amount: 600_000, created_at: CLAIMED, win_id: null }], [], 899_000);
    expect(r.orders[0]).toMatchObject({ product_name: "옛 상품", start_price: 899_000 });
    expect(r.savings).toBe(299_000);
  });
  it("mixed, and a win row RLS did not return falls back too", () => {
    const r = buildOrderStats([
      { product_name: "a", amount: 700_000, created_at: CLAIMED, win_id: WIN_ID },
      { product_name: "b", amount: 900_000, created_at: CLAIMED, win_id: null },
      { product_name: "c", amount: 800_000, created_at: CLAIMED, win_id: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f" },
    ], wins, 899_000);
    expect(r.savings).toBe(500_000 + 0 + 99_000);
    expect(r.wins).toBe(3);
  });
});

describe("browser code never selects * from auction_wins", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(__dirname, "..", "app"));

  it("every auction_wins query names its columns", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/from\(\s*["']auction_wins["']\s*\)\s*\.select\(\s*([^)]*)\)/g)) {
        if (/\*|^\s*\)?$/.test(m[1]) || m[1].trim() === "") offenders.push(`${f}: ${m[0]}`);
      }
      if (/["']use client["']/.test(src) && /auction_wins[\s\S]{0,200}?(winner_id|price_inputs)/.test(src.replace(/\/\/.*$/gm, ""))) {
        offenders.push(`${f}: client code names winner_id/price_inputs near auction_wins`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan actually sees the auction_wins queries", () => {
    const hits = files.filter((f) => /from\(\s*["']auction_wins["']/.test(readFileSync(f, "utf8")));
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });
});
