// Runs the REAL supabase/migrations/20261028150000_auction_wins.sql (M1) and
// its emergency rollback (supabase/rollbacks/) on PGlite, on top of a fresh
// replay of every earlier migration — i.e. the schema that is live in
// Production — in both privilege environments:
//   - pre1030:  the project's old default ACL (new public tables are
//               granted to anon/authenticated/service_role) — like Production
//   - post1030: no default grants
//
// auth.uid()/auth.jwt() read request.jwt.claims like Supabase's. A browser
// session — anonymous sign-in included — runs as the `authenticated` DB role;
// `anon` is only the bare anon key with no session.
//
// PGlite is a single connection, so "simultaneous" claims run one after the
// other; the atomicity under real concurrency comes from game_state
// FOR UPDATE + the round_key UNIQUE.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "supabase", "migrations");
const M1_FILE = "20261028150000_auction_wins.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE_M1 = FILES.filter((f) => f < M1_FILE);
const M1 = readFileSync(join(DIR, M1_FILE), "utf8");
const ROLLBACK = readFileSync(join(__dirname, "..", "supabase", "rollbacks", "20261028150000_auction_wins.rollback.sql"), "utf8");

const PROD_CLAIM_WINNER_MD5 = "e3acb73770e04ed160902af75732ae93";
const M1_CLAIM_WINNER_MD5 = "3b84dfd5ca929a55d5c093209693d225";
const WINDOW_SECONDS = 1800;

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
    // The SQL Editor rolls an aborted transaction back; PGlite leaves it open.
    await db.exec("rollback").catch(() => {});
    return (e as Error).message;
  }
}

async function rows<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

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

async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return (e as Error).message; }
}

const claim = async (db: PGlite, uid: string, session: string) =>
  (await as<{ won: boolean }>(db, "authenticated", uid, "select claim_winner() as won", session))[0].won;

const claimMd5 = async (db: PGlite) =>
  (await rows<{ h: string }>(db, `select md5(regexp_replace(prosrc, '\\s+', '', 'g')) h from pg_proc
                                  where oid = 'public.claim_winner()'::regprocedure`))[0].h;

// Two signed-in participants holding the round's session guard, a live
// health lease, and a round that started 10 s ago.
async function startRound(db: PGlite) {
  await db.exec(`
    insert into auth.users (id) values ('${A}'), ('${B}') on conflict do nothing;
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

const gameState = (db: PGlite) =>
  rows<Record<string, unknown>>(db, `select phase, winner_id, winner_nickname, winner_price, winner_claimed_at, is_paused
                                     from game_state where id = 1`).then((r) => r[0]);
const winCount = async (db: PGlite) => (await rows<{ n: number }>(db, "select count(*)::int n from auction_wins"))[0].n;
const winChatCount = async (db: PGlite) =>
  (await rows<{ n: number }>(db, "select count(*)::int n from chat_messages where kind = 'system' and message like '%낙찰받았습니다%'"))[0].n;

// Catalog fingerprint used to show M1 is all-or-nothing and that the
// rollback restores the pre-M1 schema exactly.
async function catalog(db: PGlite) {
  return {
    tables: await rows(db, `select c.relname, c.relacl::text acl, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relkind = 'r' order by 1`),
    columns: await rows(db, `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
                             where table_schema = 'public' order by table_name, ordinal_position`),
    indexes: await rows(db, `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
    constraints: await rows(db, `select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) d from pg_constraint
                                 where connamespace = 'public'::regnamespace order by 1, 2`),
    policies: await rows(db, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
    claimWinner: await rows(db, `select prosecdef, proconfig, pg_get_userbyid(proowner) owner, proacl::text acl,
                                        md5(regexp_replace(prosrc, '\\s+', '', 'g')) h
                                 from pg_proc where oid = 'public.claim_winner()'::regprocedure`),
  };
}

for (const env of ["pre1030", "post1030"] as const) {
  describe(`auction_wins M1 (${env})`, () => {
    let base: PGlite;   // the 30 migrations before M1 == Production
    let m1: PGlite;     // base + M1
    const fresh = () => m1.clone() as Promise<PGlite>;

    beforeAll(async () => {
      base = new PGlite();
      await base.exec(SUPABASE);
      if (env === "pre1030") await base.exec(OLD_DEFAULT_ACL);
      for (const f of BEFORE_M1) {
        const r = await run(base, readFileSync(join(DIR, f), "utf8"));
        if (r !== "ok") throw new Error(`${f}: ${r}`);
      }
      m1 = (await base.clone()) as PGlite;
      const r = await run(m1, M1);
      if (r !== "ok") throw new Error(`M1: ${r}`);
    }, 180_000);

    it("sits after the 30 pre-M1 migrations; only M2, M3 and M4-A follow it", () => {
      expect(BEFORE_M1).toHaveLength(30);
      expect(BEFORE_M1.at(-1)).toBe("20261027110000_explicit_data_api_grants.sql");
      expect(FILES.filter((f) => f > M1_FILE)).toEqual([
        "20261029100000_reset_game_uses_auction_wins.sql", "20261030100000_scheduled_start_join_window.sql", "20261030200000_payment_confirm_safety.sql",
      ]);
    });

    it("the base is Production's claim_winner; M1 replaces it with the expected body", async () => {
      expect(await claimMd5(base)).toBe(PROD_CLAIM_WINNER_MD5);
      expect(await claimMd5(m1)).toBe(M1_CLAIM_WINNER_MD5);
    });

    // ── Schema ────────────────────────────────────────────────────────────────
    describe("schema", () => {
      it("1-2. creates auction_wins with the expected columns, types, nullability and defaults", async () => {
        expect(await rows(m1, `select column_name, data_type, is_nullable, column_default from information_schema.columns
                               where table_schema = 'public' and table_name = 'auction_wins' order by ordinal_position`)).toEqual([
          { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
          { column_name: "round_key", data_type: "uuid", is_nullable: "NO", column_default: null },
          { column_name: "winner_id", data_type: "uuid", is_nullable: "NO", column_default: null },
          { column_name: "winner_nickname", data_type: "text", is_nullable: "NO", column_default: null },
          { column_name: "product_name", data_type: "text", is_nullable: "NO", column_default: null },
          { column_name: "start_price", data_type: "integer", is_nullable: "NO", column_default: null },
          { column_name: "minimum_price", data_type: "integer", is_nullable: "NO", column_default: null },
          { column_name: "winning_price", data_type: "integer", is_nullable: "NO", column_default: null },
          { column_name: "price_inputs", data_type: "jsonb", is_nullable: "NO", column_default: null },
          { column_name: "claimed_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: null },
          { column_name: "payment_deadline", data_type: "timestamp with time zone", is_nullable: "NO", column_default: null },
          { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
        ]);
        expect(await rows(m1, `select conname, pg_get_constraintdef(oid) d from pg_constraint
                               where conrelid = 'public.auction_wins'::regclass and contype <> 'n' order by 1`)).toEqual([
          { conname: "auction_wins_deadline", d: "CHECK ((payment_deadline > claimed_at))" },
          { conname: "auction_wins_pkey", d: "PRIMARY KEY (id)" },
          { conname: "auction_wins_price_range", d: "CHECK (((winning_price > 0) AND ((winning_price >= minimum_price) AND (winning_price <= start_price))))" },
          { conname: "auction_wins_round_key_key", d: "UNIQUE (round_key)" },
        ]);
        expect(await rows(m1, "select indexdef from pg_indexes where indexname = 'auction_wins_winner_id_claimed_at_idx'")).toEqual([
          { indexdef: "CREATE INDEX auction_wins_winner_id_claimed_at_idx ON public.auction_wins USING btree (winner_id, claimed_at DESC)" },
        ]);
      });

      const insertWin = (db: PGlite, over: Record<string, string> = {}) => {
        const v = {
          round_key: "gen_random_uuid()", winner_id: `'${A}'`, start_price: "900000", minimum_price: "500000",
          winning_price: "700000", claimed_at: "now()", payment_deadline: "now() + interval '1800 seconds'", ...over,
        };
        return db.exec(`insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price,
                                                  winning_price, price_inputs, claimed_at, payment_deadline)
                        values (${v.round_key}, ${v.winner_id}, 'n', 'p', ${v.start_price}, ${v.minimum_price},
                                ${v.winning_price}, '{}', ${v.claimed_at}, ${v.payment_deadline})`);
      };

      it("3/11. round_key is UNIQUE (a second win for the same round fails)", async () => {
        const db = await fresh();
        await insertWin(db, { round_key: "'00000000-0000-4000-8000-0000000000aa'" });
        expect(await errorOf(insertWin(db, { round_key: "'00000000-0000-4000-8000-0000000000aa'" })))
          .toMatch(/auction_wins_round_key_key/);
        expect(await winCount(db)).toBe(1);
      });

      it("4. price CHECK: > 0 and between minimum_price and start_price", async () => {
        const db = await fresh();
        for (const p of ["0", "-1", "499999", "900001"]) {
          expect(await errorOf(insertWin(db, { winning_price: p, ...(p === "0" || p === "-1" ? { minimum_price: "-5" } : {}) })))
            .toMatch(/auction_wins_price_range/);
        }
        await insertWin(db, { winning_price: "500000" });
        await insertWin(db, { winning_price: "900000" });
        expect(await winCount(db)).toBe(2);
      });

      it("5. deadline CHECK: payment_deadline must be after claimed_at", async () => {
        const db = await fresh();
        expect(await errorOf(insertWin(db, { payment_deadline: "now()" }))).toMatch(/auction_wins_deadline/);
        expect(await errorOf(insertWin(db, { payment_deadline: "now() - interval '1 second'" }))).toMatch(/auction_wins_deadline/);
      });

      it("winner_id has no FK (a win survives account deletion)", async () => {
        expect(await rows(m1, "select conname from pg_constraint where conrelid = 'public.auction_wins'::regclass and contype = 'f'")).toEqual([]);
      });

      it("6. payment_attempts.win_id and orders.win_id: nullable uuid FKs to auction_wins(id)", async () => {
        expect(await rows(m1, `select table_name, data_type, is_nullable from information_schema.columns
                               where table_schema = 'public' and column_name = 'win_id' order by 1`)).toEqual([
          { table_name: "orders", data_type: "uuid", is_nullable: "YES" },
          { table_name: "payment_attempts", data_type: "uuid", is_nullable: "YES" },
        ]);
        expect(await rows(m1, `select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint
                               where contype = 'f' and confrelid = 'public.auction_wins'::regclass order by 1`)).toEqual([
          { t: "orders", d: "FOREIGN KEY (win_id) REFERENCES auction_wins(id)" },
          { t: "payment_attempts", d: "FOREIGN KEY (win_id) REFERENCES auction_wins(id)" },
        ]);
        const db = await fresh();
        expect(await errorOf(db.exec(`insert into orders (user_id, winner_id, product_name, amount, order_id, win_id)
                                      values (null, '${A}', 'p', 1, 'o-fk', gen_random_uuid())`))).toMatch(/orders_win_id_fkey/);
      });

      it("7. the two win_id partial unique indexes", async () => {
        expect(await rows(m1, `select indexname, indexdef from pg_indexes
                               where indexname in ('payment_attempts_one_active_per_win_id', 'orders_one_per_win') order by 1`)).toEqual([
          { indexname: "orders_one_per_win", indexdef: "CREATE UNIQUE INDEX orders_one_per_win ON public.orders USING btree (win_id) WHERE (win_id IS NOT NULL)" },
          { indexname: "payment_attempts_one_active_per_win_id", indexdef: "CREATE UNIQUE INDEX payment_attempts_one_active_per_win_id ON public.payment_attempts USING btree (win_id) WHERE ((win_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'paid'::text, 'reconciliation_required'::text])))" },
        ]);
      });

      it("is not published to Realtime", async () => {
        expect((await rows<{ tablename: string }>(m1, "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1"))
          .map((r) => r.tablename)).toEqual(["chat_messages", "game_state", "participants"]);
      });
    });

    // ── Atomic claim ──────────────────────────────────────────────────────────
    describe("atomic claim", () => {
      it("8. a claim writes game_state and exactly one matching auction_wins row", async () => {
        const db = await fresh();
        await startRound(db);
        const [gsBefore] = await rows<Record<string, unknown>>(db, "select * from game_state where id = 1");
        expect(await claim(db, A, S_A)).toBe(true);

        const gs = await gameState(db);
        expect(gs).toMatchObject({ phase: "ended", winner_id: A, winner_nickname: "에이" });
        const w = await rows<Record<string, unknown>>(db, "select * from auction_wins");
        expect(w).toHaveLength(1);
        expect(w[0]).toMatchObject({
          round_key: gsBefore.round_key, winner_id: A, winner_nickname: "에이",
          product_name: gsBefore.product_name, start_price: gsBefore.start_price, minimum_price: gsBefore.minimum_price,
          winning_price: gs.winner_price,
        });
        expect((w[0].claimed_at as Date).getTime()).toBe((gs.winner_claimed_at as Date).getTime());
        const [{ exact }] = await rows<{ exact: boolean }>(db, `
          select w.claimed_at = g.winner_claimed_at and w.payment_deadline = w.claimed_at + interval '${WINDOW_SECONDS} seconds' exact
          from auction_wins w, game_state g`);
        expect(exact).toBe(true);
        expect(await winChatCount(db)).toBe(1);
      });

      it("price_inputs holds the locked row's calc inputs and reproduces the winning price", async () => {
        const db = await fresh();
        await startRound(db);
        await db.exec(`update game_state set fast_drop_price = 895000, fast_drop_amount = 2000, drop_interval_seconds = 0.5,
                                             paused_total_ms = 1500 where id = 1`);
        const [gsBefore] = await rows<Record<string, unknown>>(db, "select * from game_state where id = 1");
        expect(await claim(db, A, S_A)).toBe(true);
        const [w] = await rows<{ price_inputs: Record<string, unknown>; winning_price: number }>(db, "select price_inputs, winning_price from auction_wins");
        expect(Object.keys(w.price_inputs).sort()).toEqual([
          "drop_amount", "drop_interval_seconds", "elapsed_seconds", "fast_drop_amount", "fast_drop_interval_seconds",
          "fast_drop_price", "final_drop_amount", "final_drop_interval_seconds", "final_drop_price", "game_started_at",
          "minimum_price", "paused_total_ms", "start_price",
        ]);
        expect(w.price_inputs).toMatchObject({
          start_price: gsBefore.start_price, minimum_price: gsBefore.minimum_price, drop_amount: gsBefore.drop_amount,
          fast_drop_price: 895000, fast_drop_amount: 2000, final_drop_price: null, final_drop_amount: null,
          drop_interval_seconds: 0.5, paused_total_ms: 1500,
        });
        expect(new Date(w.price_inputs.game_started_at as string).getTime()).toBe((gsBefore.game_started_at as Date).getTime());
        const [{ p }] = await rows<{ p: number }>(db, `
          select calc_drop_price((i->>'elapsed_seconds')::numeric, (i->>'start_price')::int, (i->>'minimum_price')::int,
                                 (i->>'drop_amount')::int, (i->>'fast_drop_price')::int, (i->>'fast_drop_amount')::int,
                                 (i->>'final_drop_price')::int, (i->>'final_drop_amount')::int,
                                 (i->>'drop_interval_seconds')::numeric, (i->>'fast_drop_interval_seconds')::numeric,
                                 (i->>'final_drop_interval_seconds')::numeric) p
          from (select price_inputs i from auction_wins) s`);
        expect(p).toBe(w.winning_price);
        // elapsed = claimed_at - game_started_at - paused_total_ms
        const [{ ok }] = await rows<{ ok: boolean }>(db, `
          select (price_inputs->>'elapsed_seconds')::numeric
                 = extract(epoch from (claimed_at - (price_inputs->>'game_started_at')::timestamptz)) - 1.5 ok from auction_wins`);
        expect(ok).toBe(true);
      });

      it("9. duplicate / back-to-back claims: one winner, one auction_wins row", async () => {
        const db = await fresh();
        await startRound(db);
        const results = [await claim(db, A, S_A), await claim(db, B, S_B), await claim(db, A, S_A)];
        expect(results).toEqual([true, false, false]);
        expect(await winCount(db)).toBe(1);
        expect((await gameState(db)).winner_id).toBe(A);
        expect(await winChatCount(db)).toBe(1);
      });

      it("10. a failing auction_wins INSERT rolls the whole claim back", async () => {
        const db = await fresh();
        await startRound(db);
        await db.exec(`
          create function test_fail_win() returns trigger language plpgsql as $f$ begin raise exception 'forced auction_wins failure'; end $f$;
          create trigger test_fail_win before insert on auction_wins for each row execute function test_fail_win();`);
        expect(await errorOf(claim(db, A, S_A))).toMatch(/forced auction_wins failure/);
        expect(await gameState(db)).toMatchObject({ phase: "game", winner_id: null, winner_nickname: null, winner_price: null, winner_claimed_at: null });
        expect(await winCount(db)).toBe(0);
        expect(await winChatCount(db)).toBe(0);
        // Once the cause is gone the round can still be won normally.
        await db.exec("drop trigger test_fail_win on auction_wins");
        expect(await claim(db, B, S_B)).toBe(true);
        expect(await winCount(db)).toBe(1);
      });

      it("11. a round that already has an auction_wins row cannot be claimed (round_key backstop)", async () => {
        const db = await fresh();
        await startRound(db);
        await db.exec(`insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price,
                                                 winning_price, price_inputs, claimed_at, payment_deadline)
                       select round_key, '${B}', 'x', 'p', 900000, 500000, 600000, '{}', now(), now() + interval '1 hour'
                       from game_state where id = 1`);
        expect(await errorOf(claim(db, A, S_A))).toMatch(/auction_wins_round_key_key/);
        expect(await gameState(db)).toMatchObject({ phase: "game", winner_id: null, winner_claimed_at: null });
        expect(await winCount(db)).toBe(1);
        expect(await winChatCount(db)).toBe(0);
      });

      it("refused claims (not participant / no guard session / paused / stale lease) write nothing", async () => {
        const db = await fresh();
        await startRound(db);
        expect(await claim(db, A, S_B)).toBe(false);                 // wrong session
        await db.exec(`update participants set role = 'spectator' where guest_id = '${B}'`);
        expect(await claim(db, B, S_B)).toBe(false);                 // not a participant
        await db.exec("update game_state set is_paused = true where id = 1");
        expect(await claim(db, A, S_A)).toBe(false);                 // paused
        await db.exec("update game_state set is_paused = false where id = 1; update service_health set lease_until = now() - interval '1 second'");
        expect(await claim(db, A, S_A)).toBe(false);                 // stale lease: auto-pauses, as before
        expect(await gameState(db)).toMatchObject({ phase: "game", winner_id: null, is_paused: true });
        expect(await winCount(db)).toBe(0);
      });

      it("12. next round after reset: a new win row, the old one kept", async () => {
        const db = await fresh();
        await startRound(db);
        expect(await claim(db, A, S_A)).toBe(true);
        // Window expired with no payment -> reset is allowed and rotates round_key.
        await db.exec("update game_state set winner_claimed_at = winner_claimed_at - interval '31 minutes' where id = 1");
        await as(db, "service_role", null, "select admin_reset_game()");
        expect(await winCount(db)).toBe(1);
        await db.exec("delete from account_round_guard");
        await startRound(db);
        expect(await claim(db, B, S_B)).toBe(true);
        const w = await rows<{ winner_id: string }>(db, "select winner_id from auction_wins order by claimed_at");
        expect(w.map((r) => r.winner_id)).toEqual([A, B]);
        expect(await rows(db, "select count(distinct round_key)::int n from auction_wins")).toEqual([{ n: 2 }]);
      });
    });

    // ── Permissions ───────────────────────────────────────────────────────────
    describe("permissions", () => {
      let db: PGlite;
      beforeAll(async () => {
        db = await fresh();
        await startRound(db);
        await claim(db, A, S_A);
      });

      const WRITES = [
        "insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price, winning_price, price_inputs, claimed_at, payment_deadline) values (gen_random_uuid(), auth.uid(), 'n', 'p', 2, 1, 1, '{}', now(), now() + interval '1 hour')",
        "update auction_wins set winning_price = 1",
        "delete from auction_wins",
        "truncate auction_wins",
      ];

      it("13. anon: no access at all", async () => {
        for (const sql of [...WRITES, "select id from auction_wins"]) {
          expect(await errorOf(as(db, "anon", null, sql))).toMatch(/permission denied/);
        }
      });

      it("14. authenticated (incl. anonymous sign-in): no writes", async () => {
        for (const uid of [A, B]) {
          for (const sql of WRITES) expect(await errorOf(as(db, "authenticated", uid, sql))).toMatch(/permission denied/);
        }
        expect(await winCount(db)).toBe(1);
      });

      it("15. authenticated: own win readable through the granted columns", async () => {
        const r = await as(db, "authenticated", A,
          "select id, round_key, winner_nickname, product_name, start_price, winning_price, claimed_at, payment_deadline from auction_wins");
        expect(r).toHaveLength(1);
        expect(r[0].winner_nickname).toBe("에이");
      });

      it("16. authenticated: other people's wins invisible; ungranted columns refused", async () => {
        expect(await as(db, "authenticated", B, "select id from auction_wins")).toEqual([]);
        expect(await as(db, "authenticated", "eeeeeeee-0000-4000-8000-000000000005", "select id from auction_wins")).toEqual([]);
        for (const col of ["winner_id", "minimum_price", "price_inputs", "created_at", "*"]) {
          expect(await errorOf(as(db, "authenticated", A, `select ${col} from auction_wins`))).toMatch(/permission denied/);
        }
      });

      it("17. service_role: reads every row, cannot write", async () => {
        expect(await as(db, "service_role", null, "select * from auction_wins")).toHaveLength(1);
        for (const sql of WRITES) expect(await errorOf(as(db, "service_role", null, sql))).toMatch(/permission denied/);
        expect(await winCount(db)).toBe(1);
      });

      it("18. the row was written through claim_winner() (SECURITY DEFINER, owner postgres)", async () => {
        expect(await rows(db, `select prosecdef, proconfig, pg_get_userbyid(proowner) owner, pg_get_userbyid(c.relowner) table_owner
                               from pg_proc, pg_class c where pg_proc.oid = 'public.claim_winner()'::regprocedure
                                 and c.oid = 'public.auction_wins'::regclass`)).toEqual([
          { prosecdef: true, proconfig: ["search_path=public"], owner: "postgres", table_owner: "postgres" },
        ]);
      });

      it("service_role can reference a win from payment_attempts / orders; win_id uniqueness holds", async () => {
        const d = await db.clone() as PGlite;
        const [{ id }] = await rows<{ id: string }>(d, "select id from auction_wins");
        const attempt = (order: string, status: string) => as(d, "service_role", null,
          `insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status, win_id)
           values ('${order}', '${A}', '${A}', 1, 'pk-${order}', '${status}', '${id}')`);
        await attempt("o-failed", "failed");
        await attempt("o-1", "pending");
        expect(await errorOf(attempt("o-2", "pending"))).toMatch(/payment_attempts_one_active_per_win_id/);
        expect(await errorOf(attempt("o-3", "paid"))).toMatch(/payment_attempts_one_active_per_win_id/);
        await attempt("o-4", "failed");
        const order = (o: string) => as(d, "service_role", null,
          `insert into orders (user_id, winner_id, product_name, amount, order_id, win_id) values ('${A}', '${A}', 'p', 1, '${o}', '${id}')`);
        await order("o-1");
        expect(await errorOf(order("o-x"))).toMatch(/orders_one_per_win/);
        // Referenced wins can't be deleted, even by the owner.
        expect(await errorOf(d.exec("delete from auction_wins"))).toMatch(/foreign key/);
      });
    });

    // ── Compatibility ─────────────────────────────────────────────────────────
    describe("compatibility", () => {
      it("19. existing payment_attempts / orders rows survive with win_id NULL", async () => {
        const db = (await base.clone()) as PGlite;
        await db.exec(`
          insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status, win_claimed_at)
          values ('legacy-paid', '${A}', '${A}', 500000, 'pk1', 'paid', now() - interval '3 days'),
                 ('legacy-failed', '${A}', '${A}', 500000, 'pk2', 'failed', null),
                 ('legacy-old', '${B}', '${B}', 600000, 'pk3', 'paid', null);
          insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key)
          values (null, '${A}', 'p', 500000, 'legacy-paid', 'pk1'), (null, '${B}', 'p', 600000, 'legacy-old', 'pk3');`);
        const before = await rows(db, "select * from payment_attempts order by order_id");
        expect(await run(db, M1)).toBe("ok");
        const after = await rows<Record<string, unknown>>(db, "select * from payment_attempts order by order_id");
        expect(after.map(({ win_id, ...r }) => r)).toEqual(before);
        expect(after.every((r) => r.win_id === null)).toBe(true);
        expect(await rows(db, "select count(*)::int n from orders where win_id is null")).toEqual([{ n: 2 }]);
      });

      it("20. game_state shape, row and grants are untouched", async () => {
        const shape = (db: PGlite) => rows(db, `select column_name, data_type, is_nullable, column_default from information_schema.columns
                                                where table_schema = 'public' and table_name = 'game_state' order by ordinal_position`);
        const grants = (db: PGlite) => rows(db, "select relacl::text from pg_class where oid = 'public.game_state'::regclass");
        expect(await shape(m1)).toEqual(await shape(base));
        expect(await grants(m1)).toEqual(await grants(base));
        expect(await rows(m1, "select * from game_state")).toEqual(await rows(base, "select * from game_state"));
      });

      it("21. the existing (winner_id, win_claimed_at) index is kept and still enforced", async () => {
        const db = await fresh();
        expect(await rows(db, "select indexdef from pg_indexes where indexname = 'payment_attempts_one_active_per_win'"))
          .toEqual(await rows(base, "select indexdef from pg_indexes where indexname = 'payment_attempts_one_active_per_win'"));
        const legacy = (o: string) => db.exec(`insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status, win_claimed_at)
                                               values ('${o}', '${A}', '${A}', 1, 'pk', 'pending', '2026-10-28T00:00:00Z')`);
        await legacy("l1");
        expect(await errorOf(legacy("l2"))).toMatch(/payment_attempts_one_active_per_win/);
      });

      it("claim_winner keeps its owner, EXECUTE grants and config", async () => {
        const meta = (db: PGlite) => rows(db, `select prosecdef, proconfig, proowner, proacl::text from pg_proc
                                               where oid = 'public.claim_winner()'::regprocedure`);
        expect(await meta(m1)).toEqual(await meta(base));
      });
    });

    // ── Preconditions ─────────────────────────────────────────────────────────
    describe("preconditions (abort, nothing changes)", () => {
      const cases: [string, string, RegExp][] = [
        ["round in progress", "update game_state set phase = 'game', game_started_at = now() where id = 1", /a round is in progress/],
        ["ended with a winner", `update game_state set phase = 'ended', winner_id = '${A}', winner_price = 1, winner_claimed_at = now() where id = 1`, /a round is in progress or has a winner/],
        ["winner on a waiting row", `update game_state set winner_id = '${A}' where id = 1`, /has a winner/],
        ["pending attempt", `insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status) values ('p', '${A}', '${A}', 1, 'k', 'pending')`, /pending \/ reconciliation_required/],
        ["reconciliation_required attempt", `insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status) values ('r', '${A}', '${A}', 1, 'k', 'reconciliation_required')`, /pending \/ reconciliation_required/],
        ["claim_winner drifted", "create or replace function public.claim_winner() returns boolean language plpgsql security definer set search_path = public as $f$ begin return false; end $f$", /claim_winner\(\) is not the/],
        ["auction_wins exists", "create table public.auction_wins (id uuid)", /auction_wins already exists/],
        ["orders.win_id exists", "alter table public.orders add column win_id uuid", /win_id already exists/],
        ["payment_attempts.win_id exists", "alter table public.payment_attempts add column win_id uuid", /win_id already exists/],
        ["game_state row missing", "delete from game_state", /expected exactly 1 game_state row/],
      ];
      for (const [name, setup, expected] of cases) {
        it(`refuses: ${name}`, async () => {
          const db = (await base.clone()) as PGlite;
          await db.exec(setup);
          const before = await catalog(db);
          expect(await run(db, M1)).toMatch(expected);
          expect(await catalog(db)).toEqual(before);
        });
      }

      it("accepts strategy phase; refuses to run twice", async () => {
        const db = (await base.clone()) as PGlite;
        await db.exec("update game_state set phase = 'strategy', strategy_started_at = now() where id = 1");
        expect(await run(db, M1)).toBe("ok");
        const after = await catalog(db);
        expect(await run(db, M1)).toMatch(/auction_wins already exists/);
        expect(await catalog(db)).toEqual(after);
      });
    });

    // ── Emergency rollback ────────────────────────────────────────────────────
    describe("emergency rollback (supabase/rollbacks, not a migration)", () => {
      it("is not in supabase/migrations", () => {
        expect(FILES.some((f) => f.includes("rollback"))).toBe(false);
      });

      it("restores the pre-M1 schema exactly, and M1 can be re-applied", async () => {
        const db = await fresh();
        expect(await run(db, ROLLBACK)).toBe("ok");
        expect(await catalog(db)).toEqual(await catalog(base));
        expect(await claimMd5(db)).toBe(PROD_CLAIM_WINNER_MD5);
        expect(await run(db, M1)).toBe("ok");
        expect(await catalog(db)).toEqual(await catalog(m1));
      });

      it("refuses once a win is recorded (would destroy the ledger)", async () => {
        const db = await fresh();
        await startRound(db);
        expect(await claim(db, A, S_A)).toBe(true);
        await db.exec("update game_state set winner_claimed_at = winner_claimed_at - interval '31 minutes' where id = 1");
        await as(db, "service_role", null, "select admin_reset_game()");
        const before = await catalog(db);
        expect(await run(db, ROLLBACK)).toMatch(/auction_wins has 1 row/);
        expect(await catalog(db)).toEqual(before);
      });

      it("refuses during a round, and on a database without M1", async () => {
        const db = await fresh();
        await db.exec("update game_state set phase = 'game', game_started_at = now() where id = 1");
        expect(await run(db, ROLLBACK)).toMatch(/a round is in progress/);
        expect(await run((await base.clone()) as PGlite, ROLLBACK)).toMatch(/auction_wins does not exist/);
      });
    });
  });
}
