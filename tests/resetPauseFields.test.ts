// Runs the REAL SQL of supabase/migrations/20261022100000_reset_clears_pause_fields.sql
// (and its rollback) against an in-process Postgres (PGlite), on top of the
// production base — supabase/migrations/20261008100000_block_reset_of_payable_win.sql.
// The tables below are minimal stand-ins with just the columns the function
// touches; the pause columns match 20260917100000_fail_closed_pause.sql.
//
// The fix may only ADD the four pause assignments: the payable-win / payment
// guard, the device_round_guard delete and the round_key rotation must
// behave exactly as in production.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const BASE = read("supabase/migrations/20261008100000_block_reset_of_payable_win.sql");
const MIGRATION = read("supabase/migrations/20261022100000_reset_clears_pause_fields.sql");
const ROLLBACK = read("supabase/rollbacks/20261022100000_reset_clears_pause_fields.rollback.sql");

const PROD_MD5 = "98d7f243bc610c9d071c638bab7b8116";
const FIXED_MD5 = "aa6bedbe02fd7b8563a87a0aca2f7a42";

const WINNER = "11111111-1111-1111-1111-111111111111";
const PRICE = 412000;
let db: PGlite;

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create table game_state (
    id int primary key, phase text, strategy_started_at timestamptz, game_started_at timestamptz,
    winner_id uuid, winner_nickname text, winner_price int, winner_claimed_at timestamptz,
    is_paused boolean not null default false, paused_at timestamptz,
    paused_total_ms bigint not null default 0, pause_reason text,
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
`;

// The SQL Editor rolls an aborted transaction back; PGlite leaves it open.
async function run(sql: string): Promise<string> {
  try {
    await db.exec(sql);
    return "ok";
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return (e as Error).message;
  }
}

async function bodyMd5(): Promise<string> {
  const r = await db.query<{ h: string }>(
    `select md5(regexp_replace(p.prosrc, '\\s+', '', 'g')) as h
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'admin_reset_game'`,
  );
  return r.rows[0].h;
}

async function reset(): Promise<string> {
  try {
    await db.query("select admin_reset_game()");
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}

type Row = {
  phase: string; is_paused: boolean; paused_at: Date | null; ms: number; pause_reason: string | null;
  winner_id: string | null; round_key: string; guards: number; parts: number; chats: number;
};
async function row(): Promise<Row> {
  return (await db.query<Row>(`
    select phase, is_paused, paused_at, paused_total_ms::int as ms, pause_reason, winner_id, round_key::text,
           (select count(*)::int from device_round_guard) as guards,
           (select count(*)::int from participants) as parts,
           (select count(*)::int from chat_messages) as chats
    from game_state where id = 1`)).rows[0];
}

// An ended win claimed `minutesAgo` minutes ago, left carrying a pause from its round.
async function pausedEndedWin(minutesAgo: number) {
  await db.query(
    `update game_state set phase = 'ended', winner_id = $1, winner_nickname = 'w', winner_price = $2,
       winner_claimed_at = now() - make_interval(mins => $3), game_started_at = now() - interval '1 hour',
       is_paused = true, paused_at = now() - interval '2 hours', paused_total_ms = 999, pause_reason = 'manual'
     where id = 1`,
    [WINNER, PRICE, minutesAgo],
  );
}

async function attempt(status: string) {
  await db.query(
    `insert into payment_attempts (order_id, user_id, winner_id, amount, status, win_claimed_at, created_at)
     select $1, $2, $2, $3, $4, winner_claimed_at, winner_claimed_at + interval '1 minute'
     from game_state where id = 1`,
    [`DTB-${status}-${Math.random()}`, WINNER, PRICE, status],
  );
}

async function expectResetClearedEverything(before: Row) {
  expect(await reset()).toBe("ok");
  const after = await row();
  expect(after).toMatchObject({
    phase: "waiting", is_paused: false, paused_at: null, ms: 0, pause_reason: null,
    winner_id: null, guards: 0, parts: 0, chats: 0,
  });
  expect(after.round_key).not.toBe(before.round_key);
}

describe("migration file", () => {
  it("is the production reset with exactly the four pause assignments added", () => {
    const fn = (sql: string) => sql.slice(sql.indexOf("create or replace function public.admin_reset_game()"), sql.indexOf("$$;", sql.indexOf("as $$")) + 3);
    const added = `    is_paused = false,
    paused_at = null,
    paused_total_ms = 0,
    pause_reason = null,
`;
    expect(fn(MIGRATION)).toBe(fn(BASE).replace("    round_key = gen_random_uuid()", `${added}    round_key = gen_random_uuid()`));
  });

  it("the function body carries no comments (like production's stored body)", () => {
    const start = MIGRATION.indexOf("as $$", MIGRATION.indexOf("create or replace function public.admin_reset_game()"));
    expect(MIGRATION.slice(start, MIGRATION.indexOf("$$;", start))).not.toContain("--");
  });

  it("changes no data outside the function", () => {
    const outside = MIGRATION.replace(/as \$\$[\s\S]*?\$\$;/, "").replace(/do \$\$[\s\S]*?end \$\$;/g, "");
    expect(outside).not.toMatch(/^\s*(update|insert|delete)\b/im);
  });
});

describe("admin_reset_game() clears pause state (real SQL on PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(BASE);
  }, 60_000);

  beforeEach(async () => {
    await db.exec(`
      delete from payment_attempts; delete from orders; delete from chat_messages; delete from participants;
      delete from game_state; delete from device_round_guard;
      insert into game_state (id, phase) values (1, 'waiting');
      insert into device_round_guard (round_key, device_hash, guest_id) select round_key, 'dev-hash', '${WINNER}' from game_state where id = 1;
      insert into chat_messages (message) values ('hello');
      insert into participants (guest_id, nickname) values ('${WINNER}', 'w');
    `);
  });

  it("starts from the production body", async () => {
    expect(await bodyMd5()).toBe(PROD_MD5);
  });

  it("rollback refuses to run while production's version is live", async () => {
    expect(await run(ROLLBACK)).toContain(`admin_reset_game body md5 is ${PROD_MD5}`);
    expect(await bodyMd5()).toBe(PROD_MD5);
  });

  it("applies on the production body and yields the expected md5", async () => {
    expect(await run(MIGRATION)).toBe("ok");
    expect(await bodyMd5()).toBe(FIXED_MD5);
    const r = (await db.query<{ secdef: boolean; cfg: string[] }>(
      `select p.prosecdef as secdef, p.proconfig as cfg from pg_proc p where p.proname = 'admin_reset_game'`)).rows[0];
    expect(r).toEqual({ secdef: true, cfg: ["search_path=public"] });
  });

  it("refuses to run a second time (pre-condition md5 no longer matches)", async () => {
    expect(await run(MIGRATION)).toContain(`admin_reset_game body md5 is ${FIXED_MD5}`);
    expect(await bodyMd5()).toBe(FIXED_MD5);
  });

  it("the production incident: paused live round carried over -> reset clears the pause", async () => {
    await db.exec(`update game_state set phase = 'game', game_started_at = now(),
      is_paused = true, paused_at = now() - interval '40 minutes', paused_total_ms = 0,
      pause_reason = 'health_lease_expired' where id = 1`);
    await expectResetClearedEverything(await row());
  });

  it("a stale paused_total_ms from a resumed round is zeroed", async () => {
    await db.exec("update game_state set phase = 'game', game_started_at = now(), paused_total_ms = 7200000 where id = 1");
    await expectResetClearedEverything(await row());
  });

  it("paid win -> reset allowed and pause cleared", async () => {
    await pausedEndedWin(5);
    await attempt("paid");
    await expectResetClearedEverything(await row());
  });

  it("expired window without attempts -> reset allowed and pause cleared", async () => {
    await pausedEndedWin(40);
    await expectResetClearedEverything(await row());
  });

  it("waiting phase, nothing paused -> unchanged behaviour", async () => {
    await expectResetClearedEverything(await row());
  });

  for (const [name, setup, message] of [
    ["unpaid win inside the payment window", () => pausedEndedWin(5), "reset_blocked:unpaid_win_in_payment_window"],
    ["pending attempt after the window", async () => { await pausedEndedWin(40); await attempt("pending"); }, "reset_blocked:payment_in_progress"],
    ["reconciliation_required attempt", async () => { await pausedEndedWin(5); await attempt("reconciliation_required"); }, "reset_blocked:payment_needs_review"],
  ] as const) {
    it(`${name} -> still refused, nothing changed (pause state included)`, async () => {
      await setup();
      const before = await row();
      expect(await reset()).toBe(message);
      expect(await row()).toEqual(before);
    });
  }

  it("client roles still cannot execute it; service_role can", async () => {
    const r = (await db.query<{ anon: boolean; auth: boolean; svc: boolean }>(`
      select has_function_privilege('anon', 'public.admin_reset_game()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute') as auth,
             has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') as svc`)).rows[0];
    expect(r).toEqual({ anon: false, auth: false, svc: true });
  });

  it("rollback restores the production body and behaviour; a second rollback refuses", async () => {
    expect(await run(ROLLBACK)).toBe("ok");
    expect(await bodyMd5()).toBe(PROD_MD5);
    await db.exec("update game_state set phase = 'game', is_paused = true, paused_total_ms = 5, pause_reason = 'x' where id = 1");
    expect(await reset()).toBe("ok");
    expect(await row()).toMatchObject({ phase: "waiting", is_paused: true, ms: 5, pause_reason: "x", guards: 0 });
    expect(await run(ROLLBACK)).toContain(`admin_reset_game body md5 is ${PROD_MD5}`);
  });
});

describe("pre-condition on the pause columns", () => {
  it("aborts if a pause column differs from the expected schema", async () => {
    db = new PGlite();
    await db.exec(SCHEMA.replace("paused_total_ms bigint not null default 0", "paused_total_ms integer not null default 0"));
    await db.exec(BASE);
    expect(await run(MIGRATION)).toContain("game_state pause columns differ from expected (found 3 of 4)");
    expect(await bodyMd5()).toBe(PROD_MD5);
  }, 60_000);
});
