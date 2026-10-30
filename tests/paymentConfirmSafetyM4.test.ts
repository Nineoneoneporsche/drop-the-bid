// M4-A (supabase/migrations/20261030200000_payment_confirm_safety.sql) on
// the REAL migration chain (PGlite, Supabase stub roles/auth), in both
// default-ACL environments: the reservation / finalization RPCs, the
// payment_attempts transition guard, the recovery columns, orders.payment_key
// and the narrowed orders privileges; the preconditions; the rollback.
//
// Boundary cases run inside one transaction, where now() is fixed. PGlite
// has a single connection: concurrent callers are serialized, so races are
// checked as orderings plus the row locks the functions take.
import { readFileSync, readdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = pathJoin(__dirname, "..", "supabase", "migrations");
const M4_FILE = "20261030200000_payment_confirm_safety.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE_M4 = FILES.filter((f) => f < M4_FILE);
const M4 = readFileSync(pathJoin(DIR, M4_FILE), "utf8");
const ROLLBACK_PATH = pathJoin(__dirname, "..", "supabase", "rollbacks", "20261030200000_payment_confirm_safety.rollback.sql");
const ROLLBACK = readFileSync(ROLLBACK_PATH, "utf8");

const SIG = {
  reserve: "public.payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)",
  finalize: "public.payment_finalize_paid(text,jsonb,text,timestamptz)",
  guard: "public.payment_attempts_guard_transition()",
};
const MD5 = { reserve: "3b0840ae43dd5807a074816a8ca03fdf", finalize: "e4d02c5b0c445e83965b585bc4ff6a12", guard: "3b910dd20de5c3e8f61398caf1d8b28e" };
const UNCHANGED_MD5: Record<string, string> = {
  "public.claim_winner()": "3b84dfd5ca929a55d5c093209693d225",
  "public.admin_reset_game()": "e74405580db4c4694302f25e9d9d1e37",
  "public.join_game_participant(uuid,text,text,uuid)": "b8d03a4d9dcc5e349d9a30b6d349511d",
  "public.start_game()": "8f8cba95b88422c9c717bb804faa6da9",
  "public.admin_force_start_game()": "0251520809f95fa35f1c010dd6deeade",
  "public.admin_update_schedule(timestamptz,integer)": "fadb9870e7de7dbd0a6ce3591cfd73b0",
};

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
const PRICE = 412000;

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
const one = async <T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0];
type Role = "anon" | "authenticated" | "service_role";
async function as<T = Record<string, unknown>>(db: PGlite, role: Role, claims: Record<string, unknown> | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims ?? { role })]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}
const errorOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as Error).message; } };
const md5 = async (db: PGlite, sig: string) =>
  (await one<{ h: string | null }>(db, `select md5(regexp_replace(prosrc, '\\s+', '', 'g')) h from pg_proc where oid = to_regprocedure($1)`, [sig]))?.h ?? null;

// A claimed win of `uid` (deadline as an SQL expression); returns its id.
async function win(db: PGlite, uid = A, deadline = "now() + interval '30 minutes'", price = PRICE, product = "아이패드 라운드") {
  await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [uid]);
  return (await one<{ id: string }>(db, `
    insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price, winning_price, price_inputs, claimed_at, payment_deadline)
    values (gen_random_uuid(), $1, 'nick', $2, 899000, 1, $3, '{}', now() - interval '1 minute', ${deadline}) returning id`, [uid, product, price])).id;
}
type Reserve = { order?: string; user?: string; win: string; amount?: number; key?: string; name?: string | null; phone?: string | null; post?: string | null; addr?: string | null; detail?: string | null };
const reserveArgs = (r: Reserve) => [r.order ?? "DTB-1", r.user ?? A, r.win, r.amount ?? PRICE, r.key ?? "pk_1",
  r.name === undefined ? " 홍길동 " : r.name, r.phone === undefined ? "010-1234-5678" : r.phone, r.post === undefined ? "06236" : r.post,
  r.addr === undefined ? "서울 강남구" : r.addr, r.detail === undefined ? "" : r.detail];
const RESERVE_SQL = "select payment_reserve_attempt($1, $2::uuid, $3::uuid, $4::integer, $5, $6, $7, $8, $9, $10) as k";
const reserve = async (db: PGlite, r: Reserve) => (await as<{ k: string }>(db, "service_role", null, RESERVE_SQL, reserveArgs(r)))[0].k;
const TOSS = { status: "DONE", orderId: "DTB-1", totalAmount: PRICE, method: "카드" };
const finalize = async (db: PGlite, order = "DTB-1", status = "DONE") =>
  (await as<{ r: string }>(db, "service_role", null, "select payment_finalize_paid($1, $2::jsonb, $3, $4::timestamptz) as r",
    [order, JSON.stringify(TOSS), status, "2026-10-30T12:01:00+09:00"]))[0].r;
const attempt = (db: PGlite, order = "DTB-1") => one(db, "select * from payment_attempts where order_id = $1", [order]);
// The pre-M4 app's direct writes (service_role REST): insert pending, update.
const oldInsert = (db: PGlite, order: string, winId: string | null, key = `pk_${order}`, uid = A) =>
  as(db, "service_role", null, `insert into payment_attempts (order_id, user_id, winner_id, win_id, win_claimed_at, amount, payment_key, status)
     values ($1, $2, $2, $3, case when $3::uuid is null then null else now() end, $4, $5, 'pending')`, [order, uid, winId, PRICE, key]);
const setStatus = (db: PGlite, order: string, status: string) =>
  as(db, "service_role", null, "update payment_attempts set status = $2 where order_id = $1", [order, status]);

for (const env of ["pre1030", "post1030"] as const) {
  describe(`M4-A payment confirm safety (${env})`, () => {
    let base: PGlite; // the 33 migrations before M4-A == Production after M3
    let m4: PGlite;
    const fresh = () => m4.clone() as Promise<PGlite>;
    const freshBase = () => base.clone() as Promise<PGlite>;

    beforeAll(async () => {
      base = new PGlite();
      await base.exec(SUPABASE);
      if (env === "pre1030") await base.exec(OLD_DEFAULT_ACL);
      for (const f of BEFORE_M4) {
        const r = await run(base, readFileSync(pathJoin(DIR, f), "utf8"));
        if (r !== "ok") throw new Error(`${f}: ${r}`);
      }
      m4 = (await base.clone()) as PGlite;
      const r = await run(m4, M4);
      if (r !== "ok") throw new Error(`M4-A: ${r}`);
    }, 180_000);

    it("fresh replay: 34 migrations, M4-A last, no explicit BEGIN/COMMIT; bodies pinned; M1 / M2 / M3 bodies untouched", async () => {
      expect(BEFORE_M4).toHaveLength(33);
      expect(BEFORE_M4.at(-1)).toBe("20261030100000_scheduled_start_join_window.sql");
      expect(FILES).toHaveLength(34);
      expect(FILES.at(-1)).toBe(M4_FILE);
      expect(M4).not.toMatch(/^\s*(begin|commit)\s*;/im);
      expect(M4).toMatch(/^set local lock_timeout = '5s';$/m);
      for (const k of ["reserve", "finalize", "guard"] as const) {
        expect(await md5(base, SIG[k])).toBeNull();
        expect(await md5(m4, SIG[k])).toBe(MD5[k]);
      }
      for (const [sig, h] of Object.entries(UNCHANGED_MD5)) {
        expect(await md5(base, sig), sig).toBe(h);
        expect(await md5(m4, sig), sig).toBe(h);
      }
    });

    describe("columns / constraints", () => {
      it("new payment_attempts columns are nullable, no default; pre-M4 rows keep NULLs (no backfill)", async () => {
        const db = await freshBase();
        const w = await win(db);
        await oldInsert(db, "DTB-OLD", w);
        expect(await run(db, M4)).toBe("ok");
        const c = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(db, `
          select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_name = 'payment_attempts' and column_name in ('toss_idempotency_key','toss_status','approved_at','last_checked_at',
            'shipping_recipient_name','shipping_phone','shipping_postcode','shipping_address','shipping_address_detail') order by 1`);
        expect(c).toHaveLength(9);
        expect(c.every((x) => x.is_nullable === "YES" && x.column_default === null)).toBe(true);
        expect(await attempt(db, "DTB-OLD")).toMatchObject({ status: "pending", toss_idempotency_key: null, shipping_recipient_name: null });
      });
      it("shipping snapshot: all four required present, or none", async () => {
        const db = await fresh();
        const w = await win(db);
        await reserve(db, { win: w });
        expect(await run(db, "update payment_attempts set shipping_phone = null where order_id = 'DTB-1'")).toMatch(/payment_attempts_shipping_snapshot_complete/);
        expect(await run(db, "update payment_attempts set shipping_address_detail = null where order_id = 'DTB-1'")).toBe("ok");
      });
      it("toss_idempotency_key is UNIQUE and at most 300 chars", async () => {
        const db = await fresh();
        const w1 = await win(db, A);
        const w2 = await win(db, B);
        const k = await reserve(db, { win: w1 });
        await reserve(db, { win: w2, user: B, order: "DTB-2", key: "pk_2" });
        expect(await run(db, `update payment_attempts set toss_idempotency_key = '${k}' where order_id = 'DTB-2'`)).toMatch(/idempotency_key/);
        await oldInsert(db, "DTB-3", null, "pk_3");
        expect(await run(db, `update payment_attempts set toss_idempotency_key = repeat('x', 301) where order_id = 'DTB-3'`)).toMatch(/payment_attempts_toss_idempotency_key_length/);
      });
      it("orders.payment_key is NOT NULL and UNIQUE", async () => {
        const db = await fresh();
        const w = await win(db);
        const ins = (order: string, key: string | null) => run(db, `insert into orders (user_id, winner_id, win_id, product_name, amount, order_id, payment_key)
          values ('${A}', '${A}', ${order === "o1" ? `'${w}'` : "null"}, 'p', 1, '${order}', ${key === null ? "null" : `'${key}'`})`);
        expect(await ins("o1", "pk_same")).toBe("ok");
        expect(await ins("o2", "pk_same")).toMatch(/orders_payment_key_key/);
        expect(await ins("o3", null)).toMatch(/null value|not-null/);
      });
    });

    describe("payment_attempts transition guard", () => {
      it("INSERT must be 'pending'", async () => {
        const db = await fresh();
        for (const status of ["paid", "failed", "reconciliation_required"]) {
          expect(await run(db, `insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status)
                                values ('x-${status}', '${A}', '${A}', 1, 'pk_${status}', '${status}')`)).toBe(`payment_attempt_transition_forbidden:insert_${status}`);
        }
      });
      it("the allowed status moves, and nothing else", async () => {
        const allowed: Record<string, string[]> = {
          pending: ["pending", "paid", "failed", "reconciliation_required"],
          failed: ["failed", "pending"],
          reconciliation_required: ["reconciliation_required", "paid", "failed"],
          paid: ["paid"],
        };
        const db = await fresh();
        const STATUSES = Object.keys(allowed);
        let n = 0;
        for (const from of STATUSES) {
          for (const to of STATUSES) {
            const order = `T-${n++}`;
            await oldInsert(db, order, null, `pk_${order}`);
            const path = { pending: [], failed: ["failed"], reconciliation_required: ["reconciliation_required"], paid: ["paid"] }[from]!;
            for (const s of path) await setStatus(db, order, s);
            const r = await errorOf(setStatus(db, order, to));
            if (allowed[from].includes(to)) expect(r, `${from} -> ${to}`).toBeNull();
            else expect(r, `${from} -> ${to}`).toBe(`payment_attempt_transition_forbidden:${from}_to_${to}`);
          }
        }
      });
      it("identity columns never change; a set idempotency key never changes; win_id only on failed -> pending", async () => {
        const db = await fresh();
        const w = await win(db);
        await reserve(db, { win: w });
        for (const set of ["amount = 1", "payment_key = 'pk_x'", `user_id = '${B}'`, `winner_id = '${B}'`, "order_id = 'DTB-X'"]) {
          expect(await run(db, `update payment_attempts set ${set} where order_id = 'DTB-1'`), set).toBe("payment_attempt_transition_forbidden:identity");
        }
        expect(await run(db, "update payment_attempts set toss_idempotency_key = 'confirm-other' where order_id = 'DTB-1'")).toBe("payment_attempt_transition_forbidden:idempotency_key");
        expect(await run(db, "update payment_attempts set toss_idempotency_key = null where order_id = 'DTB-1'")).toBe("payment_attempt_transition_forbidden:idempotency_key");
        expect(await run(db, "update payment_attempts set win_id = null where order_id = 'DTB-1'")).toBe("payment_attempt_transition_forbidden:win_id");
      });
      it("the pre-M4 app's writes all still pass (insert pending, -> paid / failed / recon, failed -> pending with win_id)", async () => {
        const db = await fresh();
        const w = await win(db);
        await oldInsert(db, "OLD-1", null, "pk_o1");
        await setStatus(db, "OLD-1", "failed");
        expect(await errorOf(as(db, "service_role", null, `update payment_attempts set status = 'pending', win_id = $1, win_claimed_at = now(), error_detail = null where order_id = 'OLD-1' and status = 'failed'`, [w]))).toBeNull();
        expect(await errorOf(as(db, "service_role", null, `update payment_attempts set status = 'paid', toss_response = '{}' where order_id = 'OLD-1'`))).toBeNull();
        expect(await errorOf(as(db, "service_role", null, `update payment_attempts set status = 'paid', toss_response = '{"x":1}' where order_id = 'OLD-1'`))).toBeNull();
        await oldInsert(db, "OLD-2", null, "pk_o2");
        expect(await errorOf(setStatus(db, "OLD-2", "reconciliation_required"))).toBeNull();
      });
    });

    describe("payment_reserve_attempt()", () => {
      it("reserves 'pending' with the trimmed snapshot and a server-generated idempotency key", async () => {
        const db = await fresh();
        const w = await win(db);
        const k = await reserve(db, { win: w });
        expect(k).toMatch(/^confirm-[0-9a-f-]{36}$/);
        expect(await attempt(db)).toMatchObject({
          order_id: "DTB-1", user_id: A, winner_id: A, win_id: w, amount: PRICE, payment_key: "pk_1", status: "pending",
          toss_idempotency_key: k, shipping_recipient_name: "홍길동", shipping_phone: "010-1234-5678", shipping_postcode: "06236",
          shipping_address: "서울 강남구", shipping_address_detail: null, toss_status: null,
        });
        const a = await one<{ same: boolean }>(db, `select pa.win_claimed_at = w.claimed_at same from payment_attempts pa join auction_wins w on w.id = pa.win_id`);
        expect(a.same).toBe(true);
      });
      it("32 / 33 / 35. deadline in DB time, in the reserving transaction: 1 µs before -> reserved; at the deadline -> window_expired, nothing written", async () => {
        const db = await fresh();
        await db.query("insert into auth.users (id) values ($1)", [A]);
        const tx = (deadline: string, order: string) => run(db, `begin;
          insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price, winning_price, price_inputs, claimed_at, payment_deadline)
          values (gen_random_uuid(), '${A}', 'n', 'p', 899000, 1, ${PRICE}, '{}', now() - interval '29 minutes', ${deadline});
          set local role service_role;
          select payment_reserve_attempt('${order}', '${A}', (select id from auction_wins order by created_at desc, id limit 1), ${PRICE}, 'pk_${order}', 'n', '01012345678', '1', 'a', null);
          commit;`);
        expect(await tx("now() + interval '1 microsecond'", "DTB-OK")).toBe("ok");
        expect(await tx("now()", "DTB-LATE")).toBe("reserve:window_expired");
        expect(await rows(db, "select order_id from payment_attempts order by 1")).toEqual([{ order_id: "DTB-OK" }]);
      });
      it("refusals: not the winner, another amount, no such win, missing shipping, invalid input", async () => {
        const db = await fresh();
        const w = await win(db);
        expect(await errorOf(reserve(db, { win: w, user: B }))).toBe("reserve:not_winner");
        expect(await errorOf(reserve(db, { win: w, amount: PRICE - 1 }))).toBe("reserve:amount_mismatch");
        expect(await errorOf(reserve(db, { win: B }))).toBe("reserve:no_win");
        for (const miss of [{ name: "  " }, { phone: null }, { post: "" }, { addr: null }]) {
          expect(await errorOf(reserve(db, { win: w, ...miss }))).toBe("reserve:shipping_required");
        }
        expect(await errorOf(reserve(db, { win: w, key: "" }))).toBe("reserve:invalid");
        expect(await errorOf(reserve(db, { win: w, order: "x".repeat(65) }))).toBe("reserve:invalid");
        expect(await errorOf(reserve(db, { win: w, amount: 0 }))).toBe("reserve:invalid");
        expect(await rows(db, "select 1 from payment_attempts")).toEqual([]);
      });
      it("one active attempt per win: a second order for the same win -> 23505 on the active index", async () => {
        const db = await fresh();
        const w = await win(db);
        await reserve(db, { win: w });
        expect(await errorOf(reserve(db, { win: w, order: "DTB-2", key: "pk_2" }))).toMatch(/payment_attempts_one_active_per_win/);
      });
      it("same order: pending / paid / recon -> busy; mismatched identity -> order_in_use", async () => {
        const db = await fresh();
        const w = await win(db);
        await reserve(db, { win: w });
        expect(await errorOf(reserve(db, { win: w }))).toBe("reserve:busy");
        await setStatus(db, "DTB-1", "reconciliation_required");
        expect(await errorOf(reserve(db, { win: w }))).toBe("reserve:busy");
        expect(await errorOf(reserve(db, { win: w, key: "pk_other" }))).toBe("reserve:order_in_use");
        await db.query("insert into auth.users (id) values ($1)", [B]);
        expect(await errorOf(reserve(db, { win: w, user: B }))).toBe("reserve:not_winner");
      });
      it("3. retry of the same failed attempt: back to pending with the SAME idempotency key and a fresh snapshot", async () => {
        const db = await fresh();
        const w = await win(db);
        const k = await reserve(db, { win: w });
        await setStatus(db, "DTB-1", "failed");
        expect(await reserve(db, { win: w, addr: "새 주소" })).toBe(k);
        expect(await attempt(db)).toMatchObject({ status: "pending", toss_idempotency_key: k, shipping_address: "새 주소", error_detail: null });
      });
      it("a pre-M4 failed attempt (no key, no win_id) gets a key and the win when retried", async () => {
        const db = await fresh();
        const w = await win(db);
        await oldInsert(db, "DTB-1", null, "pk_1");
        await setStatus(db, "DTB-1", "failed");
        const k = await reserve(db, { win: w });
        expect(k).toMatch(/^confirm-/);
        expect(await attempt(db)).toMatchObject({ status: "pending", win_id: w, toss_idempotency_key: k });
      });
      it("locks the win row and then the attempt row (static check of the body)", async () => {
        const db = await fresh();
        const src = (await one<{ s: string }>(db, "select prosrc s from pg_proc where oid = to_regprocedure($1)", [SIG.reserve])).s;
        expect(src).toMatch(/from auction_wins where id = p_win_id for update;/);
        expect(src).toMatch(/from payment_attempts where order_id = p_order_id for update;/);
        expect(src.indexOf("from auction_wins where id = p_win_id for update")).toBeLessThan(src.indexOf("now() >= v_win.payment_deadline"));
      });
    });

    describe("payment_finalize_paid()", () => {
      async function reserved() {
        const db = await fresh();
        const w = await win(db);
        await reserve(db, { win: w, detail: " 12층 " });
        return { db, w };
      }
      it("26. order INSERT + attempt 'paid' in one call; the order is built from the attempt's snapshot and the win", async () => {
        const { db, w } = await reserved();
        expect(await finalize(db)).toBe("paid");
        expect(await one(db, "select user_id, winner_id, win_id, product_name, amount, order_id, payment_key, shipping_recipient_name, shipping_address_detail from orders")).toEqual({
          user_id: A, winner_id: A, win_id: w, product_name: "아이패드 라운드", amount: PRICE, order_id: "DTB-1", payment_key: "pk_1",
          shipping_recipient_name: "홍길동", shipping_address_detail: "12층",
        });
        const a = await attempt(db);
        expect(a).toMatchObject({ status: "paid", toss_status: "DONE", error_detail: null, toss_response: TOSS });
        expect(a.approved_at).not.toBeNull();
        expect(a.last_checked_at).not.toBeNull();
      });
      it("28. replay of a paid attempt -> already_paid, no second order", async () => {
        const { db } = await reserved();
        await finalize(db);
        expect(await finalize(db)).toBe("already_paid");
        expect(await rows(db, "select 1 from orders")).toHaveLength(1);
      });
      it("recovery: a reconciliation_required attempt that Toss shows DONE can be finalized", async () => {
        const { db } = await reserved();
        await setStatus(db, "DTB-1", "reconciliation_required");
        expect(await finalize(db)).toBe("paid");
        expect((await attempt(db)).status).toBe("paid");
      });
      it("29. the win already has another order -> duplicate_win, attempt reconciliation_required, no order", async () => {
        const { db, w } = await reserved();
        await db.exec(`insert into orders (user_id, winner_id, win_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', '${w}', 'p', ${PRICE}, 'DTB-EARLIER', 'pk_earlier')`);
        expect(await finalize(db)).toBe("duplicate_win");
        expect(await attempt(db)).toMatchObject({ status: "reconciliation_required", error_detail: "finalize:duplicate_win", toss_status: "DONE" });
        expect(await rows(db, "select order_id from orders")).toEqual([{ order_id: "DTB-EARLIER" }]);
      });
      it("an existing order under the same order_id: same payment -> paid; different -> order_mismatch", async () => {
        const { db, w } = await reserved();
        await db.exec(`insert into orders (user_id, winner_id, win_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', '${w}', 'p', ${PRICE}, 'DTB-1', 'pk_1')`);
        expect(await finalize(db)).toBe("paid");
        const r2 = await reserved();
        await r2.db.exec(`insert into orders (user_id, winner_id, win_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', null, 'p', 1, 'DTB-1', 'pk_zz')`);
        expect(await finalize(r2.db)).toBe("order_mismatch");
        expect((await attempt(r2.db)).status).toBe("reconciliation_required");
      });
      it("the paymentKey is already on another order -> duplicate_payment_key", async () => {
        const { db } = await reserved();
        await db.exec(`insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'DTB-OTHER', 'pk_1')`);
        expect(await finalize(db)).toBe("duplicate_payment_key");
      });
      it("30. an attempt without a snapshot (reserved by the pre-M4 app) -> no_shipping_snapshot, never an order without an address", async () => {
        const db = await fresh();
        const w = await win(db);
        await oldInsert(db, "DTB-1", w, "pk_1");
        expect(await finalize(db)).toBe("no_shipping_snapshot");
        expect(await rows(db, "select 1 from orders")).toEqual([]);
        expect((await attempt(db)).status).toBe("reconciliation_required");
      });
      it("refuses outright (nothing written): status not DONE, no attempt, legacy attempt, failed attempt, paid without order", async () => {
        const { db } = await reserved();
        expect(await errorOf(finalize(db, "DTB-1", "IN_PROGRESS"))).toBe("finalize:not_done");
        expect(await errorOf(finalize(db, "NOPE"))).toBe("finalize:no_attempt");
        await oldInsert(db, "LEG", null, "pk_leg");
        expect(await errorOf(finalize(db, "LEG"))).toBe("finalize:legacy_attempt");
        await setStatus(db, "DTB-1", "failed");
        expect(await errorOf(finalize(db))).toBe("finalize:status_failed");
        expect((await attempt(db)).status).toBe("failed");
        expect(await rows(db, "select 1 from orders")).toEqual([]);
      });
      it("the account deleted since the reservation: the order is still written, user_id NULL, winner_id kept", async () => {
        const { db } = await reserved();
        await db.exec(`delete from auth.users where id = '${A}'`);
        expect(await finalize(db)).toBe("paid");
        expect(await one(db, "select user_id, winner_id from orders")).toEqual({ user_id: null, winner_id: A });
      });
      it("atomic: if the order INSERT fails, the attempt is NOT paid (both or neither)", async () => {
        const { db } = await reserved();
        await db.exec(`create function boom() returns trigger language plpgsql as $f$ begin raise exception 'orders down'; end $f$;
                       create trigger boom before insert on orders for each row execute function boom();`);
        expect(await errorOf(finalize(db))).toBe("orders down");
        expect((await attempt(db)).status).toBe("pending");
        expect(await rows(db, "select 1 from orders")).toEqual([]);
      });
      it("locks the attempt row (static check)", async () => {
        const db = await fresh();
        const src = (await one<{ s: string }>(db, "select prosrc s from pg_proc where oid = to_regprocedure($1)", [SIG.finalize])).s;
        expect(src).toMatch(/from payment_attempts where order_id = p_order_id for update;/);
      });
    });

    describe("privileges", () => {
      it("RPCs: service_role only; the trigger function: nobody; owner like claim_winner, security definer, search_path=public", async () => {
        const db = await fresh();
        const w = await win(db);
        for (const role of ["anon", "authenticated"] as const) {
          expect(await errorOf(as(db, role, { role, sub: A }, RESERVE_SQL, reserveArgs({ win: w })))).toMatch(/permission denied/);
          expect(await errorOf(as(db, role, { role, sub: A }, "select payment_finalize_paid('x', '{}', 'DONE', now())"))).toMatch(/permission denied/);
        }
        const meta = await rows<{ sig: string; prosecdef: boolean; proconfig: string[]; same_owner: boolean; svc: boolean; anon: boolean; auth: boolean }>(db, `
          select p.oid::regprocedure::text sig, p.prosecdef, p.proconfig,
                 p.proowner = (select proowner from pg_proc where oid = 'public.claim_winner()'::regprocedure) same_owner,
                 has_function_privilege('service_role', p.oid, 'execute') svc,
                 has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth
          from pg_proc p where p.proname in ('payment_reserve_attempt', 'payment_finalize_paid', 'payment_attempts_guard_transition') order by 1`);
        expect(meta.map((m) => [m.sig.split("(")[0], m.prosecdef, m.proconfig, m.same_owner, m.svc, m.anon, m.auth])).toEqual([
          ["payment_attempts_guard_transition", false, ["search_path=public"], true, false, false, false],
          ["payment_finalize_paid", true, ["search_path=public"], true, true, false, false],
          ["payment_reserve_attempt", true, ["search_path=public"], true, true, false, false],
        ]);
      });

      async function withOrders() {
        const db = await fresh();
        const w = await win(db, A);
        await reserve(db, { win: w });
        await finalize(db);
        const wb = await win(db, B);
        await reserve(db, { win: wb, user: B, order: "DTB-B", key: "pk_b" });
        await finalize(db, "DTB-B");
        return db;
      }
      const asA = { role: "authenticated", sub: A };

      it("50 / 51. anon: no SELECT / UPDATE / DELETE / TRUNCATE / INSERT on orders", async () => {
        const db = await withOrders();
        for (const sql of ["select order_id from orders", "update orders set amount = 1", "delete from orders", "truncate orders",
                           `insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'x', 'y')`]) {
          expect(await errorOf(as(db, "anon", null, sql)), sql).toMatch(/permission denied/);
        }
      });
      it("52 / 53. authenticated: payment_key, winner_id, id and the shipping snapshot are not readable", async () => {
        const db = await withOrders();
        for (const col of ["payment_key", "winner_id", "id", "shipping_recipient_name", "shipping_phone", "shipping_postcode", "shipping_address", "shipping_address_detail", "*"]) {
          expect(await errorOf(as(db, "authenticated", asA, `select ${col} from orders`)), col).toMatch(/permission denied/);
        }
      });
      it("54. authenticated: the My Page / winOrder.ts columns are readable, own rows only (RLS kept)", async () => {
        const db = await withOrders();
        const mine = await as(db, "authenticated", asA, `select order_id, user_id, win_id, product_name, amount, created_at is not null as has_created from orders where user_id = $1`, [A]);
        expect(mine).toEqual([{ order_id: "DTB-1", user_id: A, win_id: expect.any(String), product_name: "아이패드 라운드", amount: PRICE, has_created: true }]);
        expect(await as(db, "authenticated", asA, "select order_id from orders order by 1")).toEqual([{ order_id: "DTB-1" }]);
        expect(await as(db, "authenticated", asA, "select order_id from orders where win_id = (select win_id from orders limit 1)")).toHaveLength(1);
        expect(await as(db, "authenticated", asA, "select order_id from orders where user_id = $1 and win_id is null and amount = 1", [A])).toEqual([]);
      });
      it("55. authenticated: no UPDATE / DELETE / TRUNCATE / INSERT on orders", async () => {
        const db = await withOrders();
        for (const sql of ["update orders set amount = 1", "delete from orders", "truncate orders",
                           `insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'x', 'y')`]) {
          expect(await errorOf(as(db, "authenticated", asA, sql)), sql).toMatch(/permission denied/);
        }
        expect(await rows(db, "select 1 from orders")).toHaveLength(2);
      });
      it("TRUNCATE is not subject to RLS: before M4-A an authenticated caller could empty orders; after, it is denied", async () => {
        const db = await freshBase();
        await db.query("insert into auth.users (id) values ($1)", [A]);
        await db.exec(`insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'o1', 'k1')`);
        expect(await errorOf(as(db, "authenticated", { role: "authenticated", sub: B }, "truncate orders"))).toBeNull();
        expect(await rows(db, "select 1 from orders")).toEqual([]);
      });
      it("56. service_role keeps what the server needs on orders / payment_attempts", async () => {
        const db = await withOrders();
        expect(await errorOf(as(db, "service_role", null, "select payment_key, shipping_address from orders"))).toBeNull();
        expect(await errorOf(as(db, "service_role", null, "update orders set product_name = product_name"))).toBeNull();
        expect(await errorOf(as(db, "service_role", null, "select toss_idempotency_key, shipping_address from payment_attempts"))).toBeNull();
        expect(await errorOf(as(db, "service_role", null, "select id, winner_id from auction_wins"))).toBeNull();
      });
      it("57. RLS on, orders policy unchanged, payment_attempts without policies; payment_attempts / auction_wins privileges unchanged", async () => {
        const acl = async (db: PGlite) => rows(db, `
          select c.relname, c.relrowsecurity, c.relacl::text acl,
                 (select string_agg(a.attname || '=' || a.attacl::text, ';' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attacl is not null) cols,
                 (select string_agg(policyname || ':' || cmd || ':' || coalesce(qual, ''), ';') from pg_policies p where p.tablename = c.relname) pol
          from pg_class c where c.relname in ('payment_attempts', 'auction_wins', 'orders') and c.relnamespace = 'public'::regnamespace order by 1`);
        const before = await acl(base);
        const after = await acl(m4);
        for (const t of ["auction_wins", "payment_attempts"]) expect(after.find((r) => r.relname === t)).toEqual(before.find((r) => r.relname === t));
        const o = after.find((r) => r.relname === "orders")!;
        expect(o.relrowsecurity).toBe(true);
        expect(o.pol).toBe("본인 주문만 조회:SELECT:(auth.uid() = user_id)");
        expect(o.pol).toBe(before.find((r) => r.relname === "orders")!.pol);
        expect(after.every((r) => r.relrowsecurity)).toBe(true);
      });
    });

    describe("preconditions (nothing changes on refusal)", () => {
      const untouched = async (db: PGlite) => {
        expect(await md5(db, SIG.reserve)).toBeNull();
        expect(await rows(db, "select 1 from information_schema.columns where table_name = 'payment_attempts' and column_name = 'toss_idempotency_key'")).toEqual([]);
      };
      it("orders.payment_key NULL -> refused (no backfill)", async () => {
        const db = await freshBase();
        await db.query("insert into auth.users (id) values ($1)", [A]);
        await db.exec(`insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'o1', null)`);
        expect(await run(db, M4)).toMatch(/precondition failed: 1 orders row\(s\) have payment_key NULL/);
        await untouched(db);
      });
      it("a payment_key on two orders -> refused", async () => {
        const db = await freshBase();
        await db.query("insert into auth.users (id) values ($1)", [A]);
        await db.exec(`insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'o1', 'k'), ('${A}', '${A}', 'p', 1, 'o2', 'k')`);
        expect(await run(db, M4)).toMatch(/payment_key value\(s\) appear on more than one order/);
        await untouched(db);
      });
      it("a payment_key on two paid attempts -> refused", async () => {
        const db = await freshBase();
        await db.exec(`insert into payment_attempts (order_id, user_id, winner_id, amount, payment_key, status) values ('a1', '${A}', '${A}', 1, 'k', 'paid'), ('a2', '${A}', '${A}', 1, 'k', 'paid')`);
        expect(await run(db, M4)).toMatch(/more than one paid payment_attempts row/);
        await untouched(db);
      });
      it("an unexpected client privilege (INSERT on orders, anything on payment_attempts) -> refused", async () => {
        const db1 = await freshBase();
        await db1.exec("grant insert on orders to authenticated");
        expect(await run(db1, M4)).toMatch(/unexpected client privilege\(s\) on orders: authenticated:INSERT/);
        await untouched(db1);
        const db2 = await freshBase();
        await db2.exec("grant select on payment_attempts to anon");
        expect(await run(db2, M4)).toMatch(/a client role has privileges on payment_attempts/);
        await untouched(db2);
        const db3 = await freshBase();
        await db3.exec("grant update (amount) on orders to authenticated");
        expect(await run(db3, M4)).toMatch(/column-level write grant on orders/);
      });
      it("an existing M4-A function, an extra orders policy, a wrong-shaped leftover column -> refused", async () => {
        const db1 = await freshBase();
        await db1.exec("create function public.payment_finalize_paid() returns int language sql as 'select 1'");
        expect(await run(db1, M4)).toMatch(/an M4-A function or a payment_attempts trigger already exists/);
        const db2 = await freshBase();
        await db2.exec("create policy extra on orders for update using (true)");
        expect(await run(db2, M4)).toMatch(/orders \/ payment_attempts policies differ/);
        const db3 = await freshBase();
        await db3.exec("alter table payment_attempts add column toss_status integer");
        expect(await run(db3, M4)).toMatch(/column\(s\) toss_status exist with an unexpected shape/);
      });
      it("a late failure rolls everything back (columns, constraint, grants, functions)", async () => {
        const db = await freshBase();
        const grantsBefore = await rows(db, "select relacl::text a from pg_class where relname = 'orders'");
        expect(await run(db, `begin; ${M4.replace("-- ── Post-conditions", () => "do $$ begin raise exception 'forced late failure'; end $$;\n-- ── Post-conditions")}; commit;`)).toBe("forced late failure");
        await untouched(db);
        expect(await rows(db, "select relacl::text a from pg_class where relname = 'orders'")).toEqual(grantsBefore);
        expect(await rows(db, "select 1 from pg_constraint where conname = 'orders_payment_key_key'")).toEqual([]);
      });
    });

    describe("rollback (supabase/rollbacks, manual)", () => {
      it("lives outside supabase/migrations, wraps itself in BEGIN/COMMIT, carries the migration-history warning", () => {
        expect(FILES.some((f) => f.includes("rollback"))).toBe(false);
        expect(ROLLBACK).toMatch(/^begin;$/m);
        expect(ROLLBACK).toMatch(/^commit;$/m);
        expect(ROLLBACK).toContain("MIGRATION HISTORY WARNING");
        expect(ROLLBACK).toContain("migration repair --status reverted 20261030200000");
        expect(ROLLBACK).not.toMatch(/supabase_migrations\.\w+\s+(set|values)|delete from supabase_migrations|insert into supabase_migrations/i);
        expect(ROLLBACK).not.toMatch(/^\s*(drop table|delete from|truncate|update public\.(orders|payment_attempts))/im);
      });
      it("drops the functions / trigger only; payment data, columns, constraints and orders grants stay; the pre-M4 app's writes work", async () => {
        const db = await fresh();
        const w = await win(db);
        await reserve(db, { win: w });
        await finalize(db);
        const dataBefore = [await rows(db, "select * from payment_attempts"), await rows(db, "select * from orders")];
        const aclBefore = await rows(db, "select relacl::text a from pg_class where relname = 'orders'");
        expect(await run(db, ROLLBACK)).toBe("ok");
        for (const k of ["reserve", "finalize", "guard"] as const) expect(await md5(db, SIG[k])).toBeNull();
        expect(await rows(db, "select 1 from pg_trigger where tgname = 'payment_attempts_guard_transition'")).toEqual([]);
        expect([await rows(db, "select * from payment_attempts"), await rows(db, "select * from orders")]).toEqual(dataBefore);
        expect(await rows(db, "select relacl::text a from pg_class where relname = 'orders'")).toEqual(aclBefore);
        expect(await errorOf(as(db, "authenticated", { role: "authenticated", sub: A }, "select payment_key from orders"))).toMatch(/permission denied/);
        const w2 = await win(db, B);
        await oldInsert(db, "OLD", w2, "pk_old", B);
        expect(await errorOf(setStatus(db, "OLD", "paid"))).toBeNull();
        // M4-A applies again on top of what the rollback left.
        expect(await run(db, M4)).toBe("ok");
        expect(await md5(db, SIG.reserve)).toBe(MD5.reserve);
      });
      it("refuses (nothing changes) when a body is not the M4-A one", async () => {
        const db = await fresh();
        await db.exec(`create or replace function public.payment_finalize_paid(p_order_id text, p_toss_response jsonb, p_toss_status text, p_approved_at timestamptz)
                       returns text language plpgsql security definer set search_path = public as $f$ begin return 'x'; end $f$;`);
        expect(await run(db, ROLLBACK)).toMatch(/rollback refused: public\.payment_finalize_paid/);
        expect(await md5(db, SIG.reserve)).toBe(MD5.reserve);
        expect(await rows(db, "select 1 from pg_trigger where tgname = 'payment_attempts_guard_transition'")).toHaveLength(1);
      });
    });
  });
}
