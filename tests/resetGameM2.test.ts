// M2 (supabase/migrations/20261029100000_reset_game_uses_auction_wins.sql):
// admin_reset_game() judges the current win from auction_wins + win_id +
// payment_deadline. Runs the REAL migration chain on PGlite (Supabase stub
// roles/auth), in both default-ACL environments, then the M2 file itself
// and its rollback.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "supabase", "migrations");
const M2_FILE = "20261029100000_reset_game_uses_auction_wins.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE_M2 = FILES.filter((f) => f < M2_FILE);
const M2 = readFileSync(join(DIR, M2_FILE), "utf8");
const ROLLBACK = readFileSync(join(__dirname, "..", "supabase", "rollbacks", "20261029100000_reset_game_uses_auction_wins.rollback.sql"), "utf8");

const PRE_M2_MD5 = "aa6bedbe02fd7b8563a87a0aca2f7a42";
const M2_MD5 = "e74405580db4c4694302f25e9d9d1e37";

const SUPABASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create function auth.jwt() returns jsonb language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(auth.jwt() ->> 'sub', '')::uuid $f$;
  create publication supabase_realtime;
`;
const OLD_DEFAULT_ACL = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const S_A = "a1a1a1a1-1111-4111-8111-111111111111";
const S_B = "b2b2b2b2-2222-4222-8222-222222222222";

async function run(db: PGlite, sql: string): Promise<string> {
  try {
    await db.exec(sql);
    return "ok";
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return (e as Error).message;
  }
}
const rows = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

type Role = "anon" | "authenticated" | "service_role";
async function as<T = Record<string, unknown>>(db: PGlite, role: Role, uid: string | null, sql: string, session?: string): Promise<T[]> {
  const claims = uid ? { sub: uid, role, ...(session ? { session_id: session } : {}) } : { role };
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

// admin_reset_game() as the app calls it (service_role). null = reset done.
async function reset(db: PGlite): Promise<{ message: string; detail: string | null } | null> {
  try {
    await as(db, "service_role", null, "select admin_reset_game()");
    return null;
  } catch (e) {
    const err = e as { message: string; detail?: string };
    return { message: err.message, detail: err.detail ?? null };
  }
}

const claim = async (db: PGlite, uid: string, session: string) =>
  (await as<{ won: boolean }>(db, "authenticated", uid, "select claim_winner() as won", session))[0].won;

const bodyMd5 = async (db: PGlite) =>
  (await rows<{ h: string }>(db, `select md5(regexp_replace(prosrc, '\\s+', '', 'g')) h from pg_proc
                                  where oid = 'public.admin_reset_game()'::regprocedure`))[0].h;

// Two signed-in participants holding this round's session guard, a live
// health lease, and a round that started 10 s ago.
async function startRound(db: PGlite) {
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}') on conflict do nothing;
    delete from account_round_guard;
    insert into participants (guest_id, nickname, role) values ('${A}', '에이', 'participant'), ('${B}', '비비', 'participant')
      on conflict (guest_id) do update set role = 'participant';
    insert into account_round_guard (round_key, user_id, session_id)
      select round_key, '${A}'::uuid, '${S_A}'::uuid from game_state where id = 1
      union all select round_key, '${B}'::uuid, '${S_B}'::uuid from game_state where id = 1;
    update service_health set lease_until = now() + interval '1 hour' where service_name = 'auction_api';
    update game_state set phase = 'game', strategy_started_at = now() - interval '70 seconds',
                          game_started_at = now() - interval '10 seconds' where id = 1;
  `);
}

// A claimed (ended) round won by `uid`; returns its auction_wins row.
async function endedWin(db: PGlite, uid = A, session = S_A) {
  await startRound(db);
  expect(await claim(db, uid, session)).toBe(true);
  return (await rows<{ id: string; round_key: string; winning_price: number; claimed_at: string; payment_deadline: string }>(db,
    `select w.id, w.round_key, w.winning_price, w.claimed_at::text, w.payment_deadline::text
     from auction_wins w join game_state g on g.round_key = w.round_key where g.id = 1`))[0];
}

// Move the current win 31 minutes into the past: deadline passed.
const expire = (db: PGlite, winId: string) =>
  db.exec(`update auction_wins set claimed_at = claimed_at - interval '31 minutes',
                                   payment_deadline = payment_deadline - interval '31 minutes' where id = '${winId}';
           update game_state set winner_claimed_at = winner_claimed_at - interval '31 minutes' where id = 1;
           update payment_attempts set win_claimed_at = win_claimed_at - interval '31 minutes' where win_id = '${winId}' or win_id is null;`);

// payment_attempts / orders rows shaped exactly like code deploy 1 writes
// them (the Production smoke-test win: attempt paid with win_id, order with
// the same win_id). `legacy` = the pre-deploy shape (no win_id, stamped
// with the win's winner_id + win_claimed_at).
async function attempt(db: PGlite, winId: string, status: string, opts: { legacy?: boolean; order?: string } = {}) {
  await db.query(
    `insert into payment_attempts (order_id, user_id, winner_id, win_id, win_claimed_at, amount, payment_key, status)
     select $1, w.winner_id, w.winner_id, case when $3 then null else w.id end, w.claimed_at, w.winning_price, 'pk_' || $1, $2
     from auction_wins w where w.id = $4`,
    [opts.order ?? `DTB-${status}-${Math.random().toString(36).slice(2)}`, status, !!opts.legacy, winId],
  );
}
async function order(db: PGlite, winId: string | null, extra: { winner?: string; amount?: number; orderId?: string } = {}) {
  await db.query(
    `insert into orders (user_id, winner_id, win_id, product_name, amount, order_id, payment_key)
     values ($1, $1, $2, '상품', $3, $4, 'pk_x')`,
    [extra.winner ?? A, winId, extra.amount ?? 0, extra.orderId ?? `DTB-O-${Math.random().toString(36).slice(2)}`],
  );
}
// Paid exactly like the smoke-test win.
async function pay(db: PGlite, win: { id: string; winning_price: number }) {
  const oid = `DTB-PAID-${Math.random().toString(36).slice(2)}`;
  await attempt(db, win.id, "paid", { order: oid });
  await order(db, win.id, { amount: win.winning_price, orderId: oid });
}

const gs = async (db: PGlite) => (await rows<Record<string, unknown>>(db,
  `select phase, winner_id, winner_price, winner_claimed_at, is_paused, paused_at, paused_total_ms, pause_reason,
          strategy_started_at, game_started_at, round_key::text from game_state where id = 1`))[0];
const count = async (db: PGlite, t: string) => (await rows<{ n: number }>(db, `select count(*)::int n from ${t}`))[0].n;

const fnMeta = (db: PGlite) => rows(db, `select prosecdef, proconfig, pg_get_userbyid(proowner) owner, proacl::text acl
                                         from pg_proc where oid = 'public.admin_reset_game()'::regprocedure`);

for (const env of ["pre1030", "post1030"] as const) {
  describe(`admin_reset_game M2 (${env})`, () => {
    let base: PGlite; // the 31 migrations before M2 == Production after M1
    let m2: PGlite;   // base + M2
    const fresh = () => m2.clone() as Promise<PGlite>;

    beforeAll(async () => {
      base = new PGlite();
      await base.exec(SUPABASE);
      if (env === "pre1030") await base.exec(OLD_DEFAULT_ACL);
      for (const f of BEFORE_M2) {
        const r = await run(base, readFileSync(join(DIR, f), "utf8"));
        if (r !== "ok") throw new Error(`${f}: ${r}`);
      }
      m2 = (await base.clone()) as PGlite;
      const r = await run(m2, M2);
      if (r !== "ok") throw new Error(`M2: ${r}`);
    }, 180_000);

    it("20. fresh replay: M2 is the 32nd migration (M3 follows), replaces the pre-M2 body", async () => {
      expect(BEFORE_M2).toHaveLength(31);
      expect(BEFORE_M2.at(-1)).toBe("20261028150000_auction_wins.sql");
      expect(FILES).toHaveLength(33);
      expect(FILES.at(-2)).toBe(M2_FILE);
      expect(FILES.at(-1)).toBe("20261030100000_scheduled_start_join_window.sql");
      expect(await bodyMd5(base)).toBe(PRE_M2_MD5);
      expect(await bodyMd5(m2)).toBe(M2_MD5);
      expect(M2).not.toMatch(/^\s*(begin|commit)\s*;/im);
    });

    it("19. owner / SECURITY DEFINER / search_path / EXECUTE grants unchanged; service_role only", async () => {
      expect(await fnMeta(m2)).toEqual(await fnMeta(base));
      expect((await fnMeta(m2))[0]).toMatchObject({ prosecdef: true, proconfig: ["search_path=public"] });
      const priv = await rows(m2, `select has_function_privilege('anon', 'public.admin_reset_game()', 'execute') anon,
                                          has_function_privilege('authenticated', 'public.admin_reset_game()', 'execute') auth,
                                          has_function_privilege('service_role', 'public.admin_reset_game()', 'execute') svc`);
      expect(priv).toEqual([{ anon: false, auth: false, svc: true }]);
      const db = await fresh();
      for (const role of ["anon", "authenticated"] as const) {
        await expect(as(db, role, A, "select admin_reset_game()")).rejects.toThrow(/permission denied/);
      }
    });

    describe("phases other than ended + winner (unchanged policy: always allowed)", () => {
      it("1. waiting -> reset", async () => {
        const db = await fresh();
        const before = (await gs(db)).round_key;
        expect(await reset(db)).toBeNull();
        expect(await gs(db)).toMatchObject({ phase: "waiting" });
        expect((await gs(db)).round_key).not.toBe(before);
      });
      it("2. strategy -> reset", async () => {
        const db = await fresh();
        await db.exec("update game_state set phase = 'strategy', strategy_started_at = now() where id = 1");
        expect(await reset(db)).toBeNull();
        expect(await gs(db)).toMatchObject({ phase: "waiting", strategy_started_at: null });
      });
      it("3. game in progress -> reset (as before M2)", async () => {
        const db = await fresh();
        await startRound(db);
        expect(await reset(db)).toBeNull();
        expect(await gs(db)).toMatchObject({ phase: "waiting", game_started_at: null });
        expect(await count(db, "auction_wins")).toBe(0);
      });
    });

    describe("ended + new win (auction_wins)", () => {
      it("4. unpaid, before payment_deadline -> blocked, DETAIL = auction_wins.payment_deadline; nothing changes", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        // Make the stored deadline differ from claimed_at + 1800 s: the stored one decides.
        await db.exec(`update auction_wins set payment_deadline = claimed_at + interval '45 minutes' where id = '${win.id}'`);
        const before = await gs(db);
        const err = await reset(db);
        expect(err?.message).toBe("reset_blocked:unpaid_win_in_payment_window");
        const deadline = (await rows<{ d: string }>(db,
          `select to_char(payment_deadline at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') d from auction_wins where id = '${win.id}'`))[0].d;
        expect(err?.detail).toBe(deadline);
        expect(await gs(db)).toEqual(before);
        expect(await count(db, "participants")).toBe(2);
      });

      it("4b. the stored deadline, not claimed_at + 30 min, decides (deadline moved earlier -> allowed)", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await db.exec(`update auction_wins set payment_deadline = claimed_at + interval '1 microsecond' where id = '${win.id}'`);
        expect(await reset(db)).toBeNull();
      });

      it("5. unpaid, after payment_deadline, no attempts -> reset", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await expire(db, win.id);
        expect(await reset(db)).toBeNull();
        expect(await gs(db)).toMatchObject({ phase: "waiting", winner_id: null });
      });

      it("5b. a failed attempt does not block after the deadline", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await attempt(db, win.id, "failed");
        await expire(db, win.id);
        expect(await reset(db)).toBeNull();
      });

      for (const [status, code] of [["pending", "reset_blocked:payment_in_progress"], ["reconciliation_required", "reset_blocked:payment_needs_review"]] as const) {
        it(`${status === "pending" ? 6 : 7}. ${status} (win_id) -> blocked before AND after the deadline`, async () => {
          const db = await fresh();
          const win = await endedWin(db);
          await attempt(db, win.id, status);
          expect((await reset(db))?.message).toBe(code);
          await expire(db, win.id);
          expect((await reset(db))?.message).toBe(code);
          expect(await gs(db)).toMatchObject({ phase: "ended", winner_id: A });
        });
      }

      it("7b. reconciliation_required wins over pending when both exist", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await attempt(db, win.id, "failed");
        await attempt(db, win.id, "reconciliation_required");
        expect((await reset(db))?.message).toBe("reset_blocked:payment_needs_review");
      });

      it("8 / 12 / 13. paid like the Production smoke test (attempt paid + order, same win_id) -> reset; ledger kept; new round_key", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await pay(db, win);
        await db.exec(`insert into chat_messages (guest_id, nickname, message, kind) values ('${A}', '에이', 'hi', 'user')`).catch(() => {});
        const ledgerBefore = {
          wins: await rows(db, "select * from auction_wins order by id"),
          attempts: await rows(db, "select * from payment_attempts order by order_id"),
          orders: await rows(db, "select * from orders order by order_id"),
        };
        const oldRound = (await gs(db)).round_key;
        expect(await reset(db)).toBeNull(); // before the deadline: paid is enough

        expect({
          wins: await rows(db, "select * from auction_wins order by id"),
          attempts: await rows(db, "select * from payment_attempts order by order_id"),
          orders: await rows(db, "select * from orders order by order_id"),
        }).toEqual(ledgerBefore);
        expect((await rows<{ r: string }>(db, `select round_key::text r from auction_wins where id = '${win.id}'`))[0].r).toBe(oldRound);
        const after = await gs(db);
        expect(after).toMatchObject({ phase: "waiting", winner_id: null, winner_price: null, winner_claimed_at: null });
        expect(after.round_key).not.toBe(oldRound);
        expect(await count(db, "auction_wins where round_key = (select round_key from game_state where id = 1)")).toBe(0);
      });

      it("8b. an order with the win_id alone counts as paid; a paid attempt alone counts as paid", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await order(db, win.id, { amount: win.winning_price });
        expect(await reset(db)).toBeNull();

        const db2 = await fresh();
        const win2 = await endedWin(db2);
        await attempt(db2, win2.id, "paid");
        expect(await reset(db2)).toBeNull();
      });

      it("10. a paid order of ANOTHER win does not make the current win paid", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        // An earlier, paid win of the same user (its own round_key), and its order.
        const [old] = await rows<{ id: string }>(db, `
          insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price, winning_price,
                                    price_inputs, claimed_at, payment_deadline)
          values (gen_random_uuid(), '${A}', '에이', '상품', 899000, 0, ${win.winning_price}, '{}'::jsonb,
                  now() - interval '2 days', now() - interval '2 days' + interval '1800 seconds')
          returning id`);
        await attempt(db, old.id, "paid", { order: "DTB-OLD-WIN" });
        await order(db, old.id, { amount: win.winning_price, orderId: "DTB-OLD-WIN" });
        expect((await reset(db))?.message).toBe("reset_blocked:unpaid_win_in_payment_window");
      });

      it("11. same user, same price, win_id NULL order / attempt after the claim (old heuristics) -> ignored", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await order(db, null, { amount: win.winning_price });  // old orders rule: winner + amount + created_at >= claim
        await db.query(
          `insert into payment_attempts (order_id, user_id, winner_id, win_id, win_claimed_at, amount, payment_key, status)
           values ('DTB-HEUR', $1, $1, null, null, $2, 'pk_h', 'paid')`, [A, win.winning_price]); // old (amount, created_at) rule
        expect((await reset(db))?.message).toBe("reset_blocked:unpaid_win_in_payment_window");
        // Proof these are exactly what the pre-M2 function would have accepted:
        const pre = (await base.clone()) as PGlite;
        const w = await endedWin(pre);
        await order(pre, null, { amount: w.winning_price });
        expect(await reset(pre)).toBeNull();
      });

      it("16. deploy-gap rows (no win_id, stamped with the win's winner_id + win_claimed_at) are still the win's", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await attempt(db, win.id, "pending", { legacy: true });
        expect((await reset(db))?.message).toBe("reset_blocked:payment_in_progress");

        const db2 = await fresh();
        const win2 = await endedWin(db2);
        await attempt(db2, win2.id, "reconciliation_required", { legacy: true });
        await expire(db2, win2.id);
        expect((await reset(db2))?.message).toBe("reset_blocked:payment_needs_review");

        const db3 = await fresh();
        const win3 = await endedWin(db3);
        await attempt(db3, win3.id, "paid", { legacy: true });
        expect(await reset(db3)).toBeNull();
      });

      it("16b. a no-win_id row of the same winner at a DIFFERENT instant is not the win's", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await attempt(db, win.id, "pending", { legacy: true });
        await db.exec(`update payment_attempts set win_claimed_at = win_claimed_at - interval '1 day' where win_id is null`);
        expect((await reset(db))?.message).toBe("reset_blocked:unpaid_win_in_payment_window");
      });
    });

    describe("ledger corruption is fail-closed", () => {
      it("9. ended + winner but no auction_wins row for the round -> win_record_missing; nothing changes", async () => {
        const db = await fresh();
        await endedWin(db);
        await db.exec("delete from auction_wins");
        const before = await gs(db);
        const err = await reset(db);
        expect(err).toEqual({ message: "reset_blocked:win_record_missing", detail: null });
        expect(await gs(db)).toEqual(before);
        expect(await count(db, "participants")).toBe(2);
      });

      it("9b. also when the row exists but under another round_key (game_state.round_key changed)", async () => {
        const db = await fresh();
        await endedWin(db);
        await db.exec("update game_state set round_key = gen_random_uuid() where id = 1");
        expect((await reset(db))?.message).toBe("reset_blocked:win_record_missing");
      });

      it("9c. the round's row names another winner -> win_record_mismatch", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await expire(db, win.id);
        await db.exec(`update game_state set winner_id = '${B}' where id = 1`);
        expect((await reset(db))?.message).toBe("reset_blocked:win_record_mismatch");
      });

      it("9d. winner set but winner_claimed_at null (the old guard skipped this) -> still judged from the ledger", async () => {
        const db = await fresh();
        await endedWin(db);
        await db.exec("update game_state set winner_claimed_at = null where id = 1");
        expect((await reset(db))?.message).toBe("reset_blocked:unpaid_win_in_payment_window");
        await db.exec("delete from auction_wins");
        expect((await reset(db))?.message).toBe("reset_blocked:win_record_missing");
      });
    });

    describe("next rounds", () => {
      it("14 / 15. after a reset the next round can be claimed; the second win keeps the first", async () => {
        const db = await fresh();
        const first = await endedWin(db, A, S_A);
        await pay(db, first);
        expect(await reset(db)).toBeNull();
        const second = await endedWin(db, B, S_B);
        expect(second.id).not.toBe(first.id);
        expect(second.round_key).not.toBe(first.round_key);
        expect(await rows(db, "select winner_id::text w from auction_wins order by claimed_at")).toEqual([{ w: A }, { w: B }]);
        // The first win's paid order does not cover the second win.
        expect((await reset(db))?.message).toBe("reset_blocked:unpaid_win_in_payment_window");
        await pay(db, second);
        expect(await reset(db)).toBeNull();
        expect(await count(db, "auction_wins")).toBe(2);
        expect(await count(db, "orders")).toBe(2);
      });
    });

    describe("reset statements unchanged", () => {
      it("17. pause fields are cleared", async () => {
        const db = await fresh();
        await startRound(db);
        await db.exec(`update game_state set is_paused = true, paused_at = now(), paused_total_ms = 12345,
                         pause_reason = 'health_lease_expired' where id = 1`);
        expect(await reset(db)).toBeNull();
        expect(await gs(db)).toMatchObject({ is_paused: false, paused_at: null, paused_total_ms: 0, pause_reason: null });
      });

      it("18. chat / participants / device_round_guard cleared; account_round_guard left as before M2", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await pay(db, win);
        await db.exec(`insert into device_round_guard (round_key, device_hash, guest_id)
                       select round_key, 'dev-1', '${A}' from game_state where id = 1`);
        const pre = (await base.clone()) as PGlite; // same scenario on the pre-M2 function
        const w = await endedWin(pre);
        await pay(pre, w);
        await pre.exec(`insert into device_round_guard (round_key, device_hash, guest_id)
                        select round_key, 'dev-1', '${A}' from game_state where id = 1`);
        expect(await count(db, "chat_messages")).toBeGreaterThan(0);
        expect(await reset(db)).toBeNull();
        expect(await reset(pre)).toBeNull();
        for (const t of ["chat_messages", "participants", "device_round_guard", "account_round_guard"]) {
          expect(await count(db, t)).toBe(await count(pre, t));
        }
        expect(await count(db, "chat_messages")).toBe(0);
        expect(await count(db, "participants")).toBe(0);
        expect(await count(db, "device_round_guard")).toBe(0);
      });
    });

    describe("migration preconditions (abort, nothing changes)", () => {
      const cases: [string, string, RegExp][] = [
        ["admin_reset_game drifted", "create or replace function public.admin_reset_game() returns void language plpgsql security definer set search_path = public as $f$ begin end $f$",
          /admin_reset_game body md5 is/],
        ["claim_winner not the M1 version", "create or replace function public.claim_winner() returns boolean language plpgsql security definer set search_path = public as $f$ begin return false; end $f$",
          /claim_winner body md5 is/],
        ["ended winner without its auction_wins row", "update game_state set phase = 'ended', winner_id = 'aaaaaaaa-0000-4000-8000-000000000001', winner_claimed_at = now() where id = 1",
          /ended winner with no matching auction_wins row/],
        ["no game_state row", "delete from game_state", /expected exactly 1 game_state row, found 0/],
      ];
      for (const [name, setup, expected] of cases) {
        it(name, async () => {
          const db = (await base.clone()) as PGlite;
          await db.exec(setup);
          const before = { md5: await bodyMd5(db), meta: await fnMeta(db) };
          expect(await run(db, M2)).toMatch(expected);
          expect({ md5: await bodyMd5(db), meta: await fnMeta(db) }).toEqual(before);
        });
      }

      it("applies with a current paid win that has its row; running it twice is refused", async () => {
        const db = (await base.clone()) as PGlite;
        const win = await endedWin(db);
        await pay(db, win);
        expect(await run(db, M2)).toBe("ok");
        expect(await bodyMd5(db)).toBe(M2_MD5);
        expect(await run(db, M2)).toMatch(/admin_reset_game body md5 is e74405580db4c4694302f25e9d9d1e37/);
      });
    });

    describe("rollback (supabase/rollbacks, manual)", () => {
      it("is not in the migrations folder and never touches supabase_migrations", () => {
        expect(FILES.some((f) => f.includes("rollback"))).toBe(false);
        expect(ROLLBACK.replace(/--[^\n]*/g, "")).not.toMatch(/supabase_migrations/);
      });

      it("restores the pre-M2 body with the same owner / grants / config; M2 re-applies afterwards", async () => {
        const db = await fresh();
        const win = await endedWin(db);
        await pay(db, win);
        expect(await run(db, ROLLBACK)).toBe("ok");
        expect(await bodyMd5(db)).toBe(PRE_M2_MD5);
        expect(await fnMeta(db)).toEqual(await fnMeta(base));
        expect(await count(db, "auction_wins")).toBe(1);
        expect(await run(db, M2)).toBe("ok");
        expect(await bodyMd5(db)).toBe(M2_MD5);
      });

      it("refuses unless the M2 body is live", async () => {
        const db = (await base.clone()) as PGlite;
        expect(await run(db, ROLLBACK)).toMatch(/not the M2 definition/);
        expect(await bodyMd5(db)).toBe(PRE_M2_MD5);
      });
    });
  });
}
