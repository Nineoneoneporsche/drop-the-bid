// Runs the REAL migration SQL (supabase/migrations/20261008100000_block_reset_of_payable_win.sql)
// against an in-process Postgres (PGlite) and exercises admin_reset_game().
// The tables below are minimal stand-ins with just the columns the function
// touches — not the production schema.
//
// The reset itself must stay byte-for-byte the definition that is live in
// production (the 20260921100000_anti_multi_account.sql version, confirmed
// against prod's pg_get_functiondef) — see PRODUCTION_RESET_BODY.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WINNER_PAYMENT_WINDOW_SECONDS } from "../app/lib/paymentWindow";

const MIGRATION = readFileSync(
  join(__dirname, "../supabase/migrations/20261008100000_block_reset_of_payable_win.sql"),
  "utf8",
);

// The body of public.admin_reset_game() as currently deployed in production.
const PRODUCTION_RESET_BODY = `
  delete from chat_messages where true;
  delete from participants where true;
  delete from device_round_guard where true;
  update game_state set
    phase = 'waiting',
    strategy_started_at = null,
    game_started_at = null,
    winner_id = null,
    winner_nickname = null,
    winner_price = null,
    winner_claimed_at = null,
    round_key = gen_random_uuid()
  where id = 1;
end;`;

const WINNER = "11111111-1111-1111-1111-111111111111";
const PRICE = 412000;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table game_state (
      id int primary key, phase text, strategy_started_at timestamptz, game_started_at timestamptz,
      winner_id uuid, winner_nickname text, winner_price int, winner_claimed_at timestamptz,
      is_paused boolean, paused_at timestamptz, paused_total_ms bigint, pause_reason text,
      round_key uuid not null default gen_random_uuid()
    );
    create table device_round_guard (round_key uuid not null, device_hash text not null, guest_id uuid, primary key (round_key, device_hash));
    create table payment_attempts (
      order_id text primary key, user_id uuid, winner_id uuid not null, amount int not null,
      payment_key text, status text not null, win_claimed_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table orders (order_id text, winner_id uuid, amount int, created_at timestamptz not null default now());
    create table chat_messages (id serial primary key, message text);
    create table participants (guest_id uuid primary key, nickname text);
  `);
  await db.exec(MIGRATION);
}, 60_000);

// Sets up an ended win claimed `minutesAgo` minutes ago (relative to the DB's now()).
async function endedWin(minutesAgo: number) {
  await db.query(
    `update game_state set phase = 'ended', winner_id = $1, winner_nickname = 'w', winner_price = $2,
       winner_claimed_at = now() - make_interval(mins => $3), game_started_at = now() - interval '1 hour'
     where id = 1`,
    [WINNER, PRICE, minutesAgo],
  );
}

async function attempt(status: string, opts: { stamped?: boolean; order?: string } = {}) {
  const stamped = opts.stamped ?? true;
  await db.query(
    `insert into payment_attempts (order_id, user_id, winner_id, amount, status, win_claimed_at, created_at)
     select $1, $2, $2, $3, $4, case when $5 then winner_claimed_at end, winner_claimed_at + interval '1 minute'
     from game_state where id = 1`,
    [opts.order ?? `DTB-${status}-${Math.random()}`, WINNER, PRICE, status, stamped],
  );
}

async function reset(): Promise<{ ok: true } | { ok: false; message: string; detail?: string; code?: string }> {
  try {
    await db.query("select admin_reset_game()");
    return { ok: true };
  } catch (e) {
    const err = e as { message: string; detail?: string; code?: string };
    return { ok: false, message: err.message, detail: err.detail, code: err.code };
  }
}

async function gameState() {
  return (await db.query<{ phase: string; winner_id: string | null }>("select phase, winner_id from game_state where id = 1")).rows[0];
}

beforeEach(async () => {
  await db.exec(`
    delete from payment_attempts; delete from orders; delete from chat_messages; delete from participants;
    delete from game_state;
    delete from device_round_guard;
    insert into game_state (id, phase, is_paused, paused_total_ms) values (1, 'waiting', false, 0);
    insert into device_round_guard (round_key, device_hash, guest_id) select round_key, 'dev-hash', '${WINNER}' from game_state where id = 1;
    insert into chat_messages (message) values ('hello');
    insert into participants (guest_id, nickname) values ('${WINNER}', 'w');
  `);
});

describe("admin_reset_game() payable-win guard (real SQL on PGlite)", () => {
  it("keeps the production reset body verbatim (device_round_guard + round_key, no pause fields)", () => {
    const fnStart = MIGRATION.indexOf("create or replace function public.admin_reset_game()");
    const resetSection = MIGRATION.slice(MIGRATION.indexOf("  delete from chat_messages where true;", fnStart));
    const body = resetSection.slice(0, resetSection.indexOf("$$;"));
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    expect(norm(body)).toBe(norm(PRODUCTION_RESET_BODY));
    expect(MIGRATION).not.toMatch(/paused_total_ms\s*=/);
  });

  it("creates a function whose normalized body hash equals production's (98d7f243…)", async () => {
    // Same expression used against production:
    // md5(regexp_replace(prosrc, '\s+', '', 'g'))
    const r = (await db.query<{ h: string; secdef: boolean; cfg: string[] | null }>(`
      select md5(regexp_replace(p.prosrc, '\\s+', '', 'g')) as h, p.prosecdef as secdef, p.proconfig as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_reset_game'`)).rows[0];
    expect(r.h).toBe("98d7f243bc610c9d071c638bab7b8116");
    expect(r.secdef).toBe(true);
    expect(r.cfg).toEqual(["search_path=public"]);
  });

  it("the function body carries no comments (production's stored body has none)", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("as $$", MIGRATION.indexOf("create or replace function public.admin_reset_game()")));
    expect(fn.slice(0, fn.indexOf("$$;")).includes("--")).toBe(false);
  });

  it("uses the same 1800s window as the app constant", () => {
    expect(WINNER_PAYMENT_WINDOW_SECONDS).toBe(1800);
    expect(MIGRATION).toContain("interval '1800 seconds'");
  });

  it("unpaid win inside the payment window -> reset refused, nothing changed", async () => {
    await endedWin(10);
    const before = (await db.query<{ round_key: string }>("select round_key from game_state where id = 1")).rows[0].round_key;
    const r = await reset();
    expect((await db.query<{ round_key: string }>("select round_key from game_state where id = 1")).rows[0].round_key).toBe(before);
    expect((await db.query("select count(*)::int as n from device_round_guard")).rows[0]).toEqual({ n: 1 });
    expect(r).toMatchObject({ ok: false, code: "P0001", message: "reset_blocked:unpaid_win_in_payment_window" });
    expect((r as { detail?: string }).detail).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(await gameState()).toMatchObject({ phase: "ended", winner_id: WINNER });
    expect((await db.query("select count(*)::int as n from chat_messages")).rows[0]).toEqual({ n: 1 });
    expect((await db.query("select count(*)::int as n from participants")).rows[0]).toEqual({ n: 1 });
  });

  it("unpaid win with only a failed attempt inside the window -> refused", async () => {
    await endedWin(10);
    await attempt("failed");
    expect(await reset()).toMatchObject({ ok: false, message: "reset_blocked:unpaid_win_in_payment_window" });
  });

  it("paid win (paid attempt) -> reset allowed, even inside the window", async () => {
    await endedWin(5);
    await attempt("paid");
    const before = (await db.query<{ round_key: string }>("select round_key from game_state where id = 1")).rows[0].round_key;
    expect(await reset()).toEqual({ ok: true });
    const after = (await db.query<{ round_key: string }>("select round_key from game_state where id = 1")).rows[0].round_key;
    expect(after).not.toBe(before);
    expect((await db.query("select count(*)::int as n from device_round_guard")).rows[0]).toEqual({ n: 0 });
    expect(await gameState()).toEqual({ phase: "waiting", winner_id: null });
    expect((await db.query("select count(*)::int as n from chat_messages")).rows[0]).toEqual({ n: 0 });
    expect((await db.query("select count(*)::int as n from participants")).rows[0]).toEqual({ n: 0 });
  });

  it("paid win evidenced by a matching order -> reset allowed", async () => {
    await endedWin(5);
    await db.query(
      "insert into orders (order_id, winner_id, amount, created_at) select 'DTB-O', winner_id, winner_price, winner_claimed_at + interval '2 minutes' from game_state where id = 1",
    );
    expect(await reset()).toEqual({ ok: true });
  });

  it("window expired with no payment attempt -> reset allowed", async () => {
    await endedWin(31);
    expect(await reset()).toEqual({ ok: true });
    expect(await gameState()).toEqual({ phase: "waiting", winner_id: null });
  });

  it("window expired with only failed attempts -> reset allowed", async () => {
    await endedWin(31);
    await attempt("failed");
    expect(await reset()).toEqual({ ok: true });
  });

  it("pending attempt -> refused (inside the window)", async () => {
    await endedWin(10);
    await attempt("pending");
    expect(await reset()).toMatchObject({ ok: false, message: "reset_blocked:payment_in_progress" });
    expect((await gameState()).phase).toBe("ended");
  });

  it("pending attempt -> refused even after the window expired", async () => {
    await endedWin(45);
    await attempt("pending");
    expect(await reset()).toMatchObject({ ok: false, message: "reset_blocked:payment_in_progress" });
  });

  it("reconciliation_required attempt -> refused (inside and after the window)", async () => {
    await endedWin(10);
    await attempt("reconciliation_required");
    expect(await reset()).toMatchObject({ ok: false, message: "reset_blocked:payment_needs_review" });
    await db.exec("update game_state set winner_claimed_at = now() - interval '2 hours' where id = 1");
    await db.exec("update payment_attempts set win_claimed_at = (select winner_claimed_at from game_state where id = 1)");
    expect(await reset()).toMatchObject({ ok: false, message: "reset_blocked:payment_needs_review" });
  });

  it("legacy (unstamped) pending attempt for this win is still recognised -> refused", async () => {
    await endedWin(40);
    await attempt("pending", { stamped: false });
    expect(await reset()).toMatchObject({ ok: false, message: "reset_blocked:payment_in_progress" });
  });

  it("live attempts of a DIFFERENT (earlier) win don't block resetting an expired current win", async () => {
    await endedWin(31);
    await db.query(
      `insert into payment_attempts (order_id, winner_id, amount, status, win_claimed_at, created_at)
       values ('DTB-OLDWIN', $1, $2, 'reconciliation_required', now() - interval '3 days', now() - interval '3 days')`,
      [WINNER, PRICE],
    );
    expect(await reset()).toEqual({ ok: true });
  });

  it("leaves pause fields untouched, exactly like the production reset", async () => {
    await db.exec("update game_state set phase = 'game', is_paused = true, paused_total_ms = 12345, pause_reason = 'x' where id = 1");
    expect(await reset()).toEqual({ ok: true });
    expect((await db.query("select phase, is_paused, paused_total_ms::int as ms, pause_reason from game_state where id = 1")).rows[0])
      .toEqual({ phase: "waiting", is_paused: true, ms: 12345, pause_reason: "x" });
  });

  it("no winner (waiting phase) -> reset allowed as before", async () => {
    expect(await reset()).toEqual({ ok: true });
    expect(await gameState()).toEqual({ phase: "waiting", winner_id: null });
  });

  it("game phase without a winner -> reset allowed as before", async () => {
    await db.exec("update game_state set phase = 'game', game_started_at = now() where id = 1");
    expect(await reset()).toEqual({ ok: true });
  });

  it("client roles still cannot execute it; service_role can", async () => {
    const r = (await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(`
      select has_function_privilege('anon', 'public.admin_reset_game()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute') as auth,
             has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') as svc`)).rows[0];
    expect(r).toEqual({ anon: false, auth: false, svc: true });
  });
});
