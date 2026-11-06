// M4-B1 (supabase/migrations/20261104100000_payment_cancellations.sql) on
// the REAL migration chain (PGlite, Supabase stub roles/auth), in both
// default-ACL environments: the payment_cancellations ledger, its guard,
// orders.refunded_at and its guard, the three refund RPCs, privileges, the
// preconditions and the rollback.
//
// PGlite has a single connection: concurrent callers are serialized, so the
// "two reservations at once" case is checked as an ordering plus the row
// locks the reservation takes, and the one-active index is checked directly.
import { readFileSync, readdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = pathJoin(__dirname, "..", "supabase", "migrations");
const B1_FILE = "20261104100000_payment_cancellations.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE_B1 = FILES.filter((f) => f < B1_FILE);
const B1 = readFileSync(pathJoin(DIR, B1_FILE), "utf8");
const ROLLBACK = readFileSync(pathJoin(__dirname, "..", "supabase", "rollbacks", "20261104100000_payment_cancellations.rollback.sql"), "utf8");

const SIG = {
  reserve: "public.payment_cancel_reserve(text,text,uuid)",
  record: "public.payment_cancel_record_post(uuid,text,integer,text)",
  mark: "public.payment_cancel_mark(uuid,text,text,text,jsonb,text)",
  finalize: "public.payment_cancel_finalize(uuid,text,text,timestamptz,jsonb)",
  guard: "public.payment_cancellations_guard_transition()",
  ordersGuard: "public.orders_guard_refunded_at()",
};
const MD5: Record<keyof typeof SIG, string> = {
  reserve: "9e3c4d40972a7ef7a56f2bb2b105382d",
  record: "a002cf826d9c383412fa03c9aff90f1a",
  mark: "8a10282e6588281821833dcd7c23648c",
  finalize: "cffac42874250be292dc5f823a6717ff",
  guard: "02185e30dad239701e18ff5de3063f8f",
  ordersGuard: "0845977dc26ace018ae0b5c8a78c83ce",
};
const UNCHANGED_MD5: Record<string, string> = {
  "public.claim_winner()": "3b84dfd5ca929a55d5c093209693d225",
  "public.admin_reset_game()": "e74405580db4c4694302f25e9d9d1e37",
  "public.payment_reserve_attempt(text,uuid,uuid,integer,text,text,text,text,text,text)": "3b0840ae43dd5807a074816a8ca03fdf",
  "public.payment_finalize_paid(text,jsonb,text,timestamptz)": "e4d02c5b0c445e83965b585bc4ff6a12",
  "public.payment_attempts_guard_transition()": "3b910dd20de5c3e8f61398caf1d8b28e",
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
const CANCELED_AT = "2026-11-04T15:30:00+09:00";

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
async function as<T = Record<string, unknown>>(db: PGlite, role: Role, sql: string, params: unknown[] = [], claims: Record<string, unknown> | null = null): Promise<T[]> {
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

// A paid order through the real M4-A RPCs: win -> reserve -> finalize paid.
async function paidOrder(db: PGlite, order = "DTB-1", uid = A, price = PRICE, key = `pk_${order}`) {
  await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [uid]);
  const w = (await one<{ id: string }>(db, `
    insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price, winning_price, price_inputs, claimed_at, payment_deadline)
    values (gen_random_uuid(), $1, 'nick', '아이패드 라운드', 899000, 1, $2, '{}', now() - interval '1 minute', now() + interval '30 minutes') returning id`, [uid, price])).id;
  await as(db, "service_role", "select payment_reserve_attempt($1, $2::uuid, $3::uuid, $4::integer, $5, '홍길동', '010-1234-5678', '06236', '서울 강남구', '')",
    [order, uid, w, price, key]);
  const r = await as<{ r: string }>(db, "service_role", "select payment_finalize_paid($1, $2::jsonb, 'DONE', now()) r",
    [order, JSON.stringify({ status: "DONE", orderId: order, totalAmount: price })]);
  expect(r[0].r).toBe("paid");
  return w;
}
const session = async (db: PGlite, extra = "") =>
  (await one<{ id: string }>(db, `insert into admin_sessions (token_hash, expires_at${extra ? ", revoked_at" : ""})
    values (md5(random()::text), now() + interval '1 day'${extra ? `, ${extra}` : ""}) returning id`)).id;
type Reserved = { cancellation_id: string; order_id: string; payment_key: string; amount: number; reason: string; toss_idempotency_key: string };
const reserve = async (db: PGlite, order: string, sid: string, reason: string | null = "고객 요청 전액 환불") =>
  (await as<{ r: Reserved }>(db, "service_role", "select payment_cancel_reserve($1, $2, $3::uuid) r", [order, reason, sid]))[0].r;
const recordPost = async (db: PGlite, id: string, outcome: string | null, http: number | null = null, code: string | null = null) =>
  (await as<{ r: boolean }>(db, "service_role", "select payment_cancel_record_post($1::uuid, $2, $3::integer, $4) r", [id, outcome, http, code]))[0].r;
const reject = (db: PGlite, id: string) => recordPost(db, id, "definite_rejection", 403, "API_KEY_ACCESS_DENIED");
const mark = async (db: PGlite, id: string, from: string, status: string, tossStatus: string | null = "DONE", detail = "x") =>
  (await as<{ r: boolean }>(db, "service_role", "select payment_cancel_mark($1::uuid, $2, $3, $4, $5::jsonb, $6) r",
    [id, from, status, tossStatus, JSON.stringify({ status: tossStatus }), detail]))[0].r;
const finalize = async (db: PGlite, id: string, tx = "tx_1", at = CANCELED_AT, status = "CANCELED") =>
  (await as<{ r: string }>(db, "service_role", "select payment_cancel_finalize($1::uuid, $2, $3, $4::timestamptz, $5::jsonb) r",
    [id, status, tx, at, JSON.stringify({ status, cancels: [{ transactionKey: tx }] })]))[0].r;
const cancellation = (db: PGlite, id: string) => one(db, "select * from payment_cancellations where id = $1", [id]);

for (const env of ["pre1030", "post1030"] as const) {
  describe(`M4-B1 payment cancellations (${env})`, () => {
    let base: PGlite; // the 34 migrations before M4-B1 == Production after M4-A
    let b1: PGlite;
    const fresh = () => b1.clone() as Promise<PGlite>;
    const freshBase = () => base.clone() as Promise<PGlite>;

    beforeAll(async () => {
      base = new PGlite();
      await base.exec(SUPABASE);
      if (env === "pre1030") await base.exec(OLD_DEFAULT_ACL);
      for (const f of BEFORE_B1) {
        const r = await run(base, readFileSync(pathJoin(DIR, f), "utf8"));
        if (r !== "ok") throw new Error(`${f}: ${r}`);
      }
      b1 = (await base.clone()) as PGlite;
      const r = await run(b1, B1);
      if (r !== "ok") throw new Error(`M4-B1: ${r}`);
    }, 180_000);

    it("fresh replay: 35 migrations, M4-B1 last, no explicit BEGIN/COMMIT; bodies pinned; M1 / M2 / M4-A bodies untouched", async () => {
      expect(BEFORE_B1).toHaveLength(34);
      expect(BEFORE_B1.at(-1)).toBe("20261030200000_payment_confirm_safety.sql");
      expect(FILES).toHaveLength(35);
      expect(FILES.at(-1)).toBe(B1_FILE);
      expect(B1).not.toMatch(/^\s*(begin|commit)\s*;/im);
      expect(B1).toMatch(/^set local lock_timeout = '5s';$/m);
      for (const k of Object.keys(SIG) as (keyof typeof SIG)[]) {
        expect(await md5(base, SIG[k])).toBeNull();
        expect(await md5(b1, SIG[k]), k).toBe(MD5[k]);
      }
      for (const [sig, h] of Object.entries(UNCHANGED_MD5)) {
        expect(await md5(base, sig), sig).toBe(h);
        expect(await md5(b1, sig), sig).toBe(h);
      }
    });

    describe("privileges / RLS", () => {
      it("RPCs: SECURITY DEFINER, search_path=public, EXECUTE service_role only; trigger functions: nobody", async () => {
        for (const k of ["reserve", "record", "mark", "finalize"] as const) {
          const p = await one<{ sd: boolean; cfg: string[]; svc: boolean; anon: boolean; auth: boolean }>(b1, `
            select prosecdef sd, proconfig cfg, has_function_privilege('service_role', oid, 'execute') svc,
                   has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') auth
            from pg_proc where oid = to_regprocedure($1)`, [SIG[k]]);
          expect(p, k).toEqual({ sd: true, cfg: ["search_path=public"], svc: true, anon: false, auth: false });
        }
        for (const k of ["guard", "ordersGuard"] as const) {
          const p = await one<{ sd: boolean; svc: boolean; anon: boolean; auth: boolean }>(b1, `
            select prosecdef sd, has_function_privilege('service_role', oid, 'execute') svc,
                   has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') auth
            from pg_proc where oid = to_regprocedure($1)`, [SIG[k]]);
          expect(p, k).toEqual({ sd: false, svc: false, anon: false, auth: false });
        }
      });
      it("payment_cancellations: RLS on, no policies; service_role SELECT only; anon / authenticated nothing; no PUBLIC", async () => {
        const t = await one<{ rls: boolean; pol: number }>(b1, `select relrowsecurity rls,
          (select count(*)::int from pg_policies where tablename = 'payment_cancellations') pol from pg_class where oid = 'public.payment_cancellations'::regclass`);
        expect(t).toEqual({ rls: true, pol: 0 });
        const acl = await rows<{ grantee: string; privs: string }>(b1, `
          select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end grantee, string_agg(x.privilege_type, ',' order by 1) privs
          from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
          where c.oid = 'public.payment_cancellations'::regclass
            and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role')) group by 1 order by 1`);
        expect(acl).toEqual([{ grantee: "service_role", privs: "SELECT" }]);
        const db = await fresh();
        await paidOrder(db);
        // Direct client access: nothing.
        for (const role of ["anon", "authenticated"] as const) {
          expect(await errorOf(as(db, role, "select * from payment_cancellations"))).toMatch(/permission denied/);
          expect(await errorOf(as(db, role, "select payment_cancel_reserve('DTB-1', 'x', gen_random_uuid())"))).toMatch(/permission denied/);
        }
        // service_role: read only — every write is an RPC.
        expect(await as(db, "service_role", "select count(*)::int n from payment_cancellations")).toEqual([{ n: 0 }]);
        expect(await errorOf(as(db, "service_role", `insert into payment_cancellations (order_id, win_id, payment_key, amount, reason, toss_idempotency_key)
          select 'DTB-1', win_id, payment_key, amount, 'x', 'k' from orders`))).toMatch(/permission denied/);
      });
      it("orders: refunded_at not readable by clients; the six column SELECTs and the policy unchanged", async () => {
        const db = await fresh();
        const c = await rows<{ col: string }>(db, `select a.attname col from pg_attribute a, aclexplode(a.attacl) x
          where a.attrelid = 'public.orders'::regclass and a.attacl is not null and pg_get_userbyid(x.grantee) = 'authenticated' order by 1`);
        expect(c.map((r) => r.col)).toEqual(["amount", "created_at", "order_id", "product_name", "user_id", "win_id"]);
        expect(await one(db, "select has_column_privilege('authenticated', 'public.orders', 'refunded_at', 'select') a, has_column_privilege('anon', 'public.orders', 'refunded_at', 'select') b"))
          .toEqual({ a: false, b: false });
        await paidOrder(db);
        expect(await errorOf(as(db, "authenticated", "select refunded_at from orders", [], { role: "authenticated", sub: A }))).toMatch(/permission denied/);
        expect(await as(db, "authenticated", "select order_id from orders", [], { role: "authenticated", sub: A })).toEqual([{ order_id: "DTB-1" }]);
      });
      it("payment_attempts / auction_wins / admin_sessions / orders table privileges are what they were", async () => {
        const acl = (db: PGlite) => rows(db, `select c.relname, c.relacl::text acl from pg_class c
          where c.oid in ('public.orders'::regclass, 'public.payment_attempts'::regclass, 'public.auction_wins'::regclass, 'public.admin_sessions'::regclass) order by 1`);
        expect(await acl(b1)).toEqual(await acl(base));
      });
    });

    describe("payment_cancel_reserve", () => {
      it("a paid order: one pending row with the attempt's identity and a DB-generated key; the caller sends only the order id", async () => {
        const db = await fresh();
        const w = await paidOrder(db);
        const sid = await session(db);
        const r = await reserve(db, "DTB-1", sid, "  고객 요청  ");
        expect(r).toEqual({
          cancellation_id: expect.any(String), order_id: "DTB-1", payment_key: "pk_DTB-1", amount: PRICE, reason: "고객 요청",
          toss_idempotency_key: expect.stringMatching(/^cancel-[0-9a-f-]{36}$/),
        });
        expect(await cancellation(db, r.cancellation_id)).toMatchObject({
          status: "pending", win_id: w, payment_key: "pk_DTB-1", amount: PRICE, requested_by_session: sid,
          toss_status: null, canceled_at: null, completed_at: null, last_checked_at: null,
        });
        // payment_attempts stays paid; the order is not touched.
        expect(await one(db, "select status from payment_attempts where order_id = 'DTB-1'")).toEqual({ status: "paid" });
        expect(await one(db, "select refunded_at from orders where order_id = 'DTB-1'")).toEqual({ refunded_at: null });
      });
      it("two reservations for one order (serialized by the order row lock): exactly one succeeds", async () => {
        const db = await fresh();
        await paidOrder(db);
        const sid = await session(db);
        const results = await Promise.allSettled([reserve(db, "DTB-1", sid), reserve(db, "DTB-1", sid)]);
        expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason.message)).toEqual(["cancel_reserve:in_progress"]);
        expect(await one(db, "select count(*)::int n from payment_cancellations")).toEqual({ n: 1 });
      });
      it("the one-active index refuses a second active row even past the RPC", async () => {
        const db = await fresh();
        await paidOrder(db);
        const r = await reserve(db, "DTB-1", await session(db));
        expect(await run(db, `insert into payment_cancellations (order_id, win_id, payment_key, amount, reason, toss_idempotency_key)
          select order_id, win_id, payment_key, amount, 'x', 'cancel-other' from payment_cancellations where id = '${r.cancellation_id}'`))
          .toMatch(/payment_cancellations_one_active_per_order/);
      });
      it("pending / reconciliation_required -> in_progress; done -> already_refunded; failed -> a new row with a NEW key", async () => {
        const db = await fresh();
        await paidOrder(db);
        const sid = await session(db);
        const r1 = await reserve(db, "DTB-1", sid);
        expect(await errorOf(reserve(db, "DTB-1", sid))).toBe("cancel_reserve:in_progress");
        expect(await mark(db, r1.cancellation_id, "pending", "reconciliation_required", null)).toBe(true);
        expect(await errorOf(reserve(db, "DTB-1", sid))).toBe("cancel_reserve:in_progress");
        expect(await reject(db, r1.cancellation_id)).toBe(false); // recorded only while pending
        await db.exec(`alter table payment_cancellations disable trigger payment_cancellations_guard_transition;
          update payment_cancellations set initial_post_outcome = 'definite_rejection', initial_post_http_status = 403, initial_post_error_code = 'API_KEY_ACCESS_DENIED';
          alter table payment_cancellations enable trigger payment_cancellations_guard_transition`);
        expect(await mark(db, r1.cancellation_id, "reconciliation_required", "failed", "DONE")).toBe(true);
        const r2 = await reserve(db, "DTB-1", sid);
        expect(r2.cancellation_id).not.toBe(r1.cancellation_id);
        expect(r2.toss_idempotency_key).not.toBe(r1.toss_idempotency_key);
        expect(await finalize(db, r2.cancellation_id)).toBe("done");
        expect(await errorOf(reserve(db, "DTB-1", sid))).toBe("cancel_reserve:already_refunded");
      });
      it("only a paid attempt with its order: pending / failed / reconciliation_required attempts and missing orders are refused", async () => {
        const db = await fresh();
        const sid = await session(db);
        await db.query("insert into auth.users (id) values ($1)", [A]);
        const w = (await one<{ id: string }>(db, `insert into auction_wins (round_key, winner_id, winner_nickname, product_name, start_price, minimum_price, winning_price, price_inputs, claimed_at, payment_deadline)
          values (gen_random_uuid(), $1, 'n', 'p', 899000, 1, $2, '{}', now(), now() + interval '30 minutes') returning id`, [A, PRICE])).id;
        await as(db, "service_role", "select payment_reserve_attempt('DTB-P', $1::uuid, $2::uuid, $3, 'pk_p', '홍', '010', '06236', '서울', '')", [A, w, PRICE]);
        expect(await errorOf(reserve(db, "DTB-P", sid))).toBe("cancel_reserve:no_order");
        expect(await errorOf(reserve(db, "DTB-NONE", sid))).toBe("cancel_reserve:no_order");
        // An order whose attempt is not paid (e.g. an order written by hand).
        await db.exec(`insert into orders (user_id, winner_id, win_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', '${w}', 'p', ${PRICE}, 'DTB-P', 'pk_p')`);
        for (const s of ["pending", "reconciliation_required", "failed"]) {
          if (s !== "pending") await db.exec(`update payment_attempts set status = '${s}' where order_id = 'DTB-P'`);
          expect(await errorOf(reserve(db, "DTB-P", sid)), s).toBe("cancel_reserve:not_paid");
        }
        await db.exec(`insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key) values ('${A}', '${A}', 'p', 1, 'DTB-NOATT', 'pk_noatt')`);
        expect(await errorOf(reserve(db, "DTB-NOATT", sid))).toBe("cancel_reserve:no_attempt");
        expect(await one(db, "select count(*)::int n from payment_cancellations")).toEqual({ n: 0 });
      });
      it("order / attempt identity mismatch (amount / payment_key / win_id) and legacy rows are refused", async () => {
        for (const [col, val] of [["amount", "1"], ["win_id", "null"]] as const) {
          const db = await fresh();
          await paidOrder(db);
          await db.exec(`update orders set ${col} = ${val} where order_id = 'DTB-1'`);
          expect(await errorOf(reserve(db, "DTB-1", await session(db))), col).toBe(col === "win_id" ? "cancel_reserve:legacy_order" : "cancel_reserve:identity_mismatch");
        }
        const db = await fresh();
        await paidOrder(db);
        await db.exec("update orders set payment_key = 'pk_other' where order_id = 'DTB-1'");
        expect(await errorOf(reserve(db, "DTB-1", await session(db)))).toBe("cancel_reserve:identity_mismatch");
      });
      it("reason 1..200 chars after trimming; an active admin session is required", async () => {
        const db = await fresh();
        await paidOrder(db);
        const sid = await session(db);
        for (const bad of [null, "", "   ", "x".repeat(201)]) expect(await errorOf(reserve(db, "DTB-1", sid, bad))).toBe("cancel_reserve:invalid_reason");
        expect(await errorOf(as(db, "service_role", "select payment_cancel_reserve('DTB-1', 'x', null)"))).toBe("cancel_reserve:no_session");
        expect(await errorOf(reserve(db, "DTB-1", "00000000-0000-4000-8000-000000000000"))).toBe("cancel_reserve:invalid_session");
        expect(await errorOf(reserve(db, "DTB-1", await session(db, "now()")))).toBe("cancel_reserve:invalid_session");
        const expired = (await one<{ id: string }>(db, "insert into admin_sessions (token_hash, expires_at) values ('h-exp', now() - interval '1 second') returning id")).id;
        expect(await errorOf(reserve(db, "DTB-1", expired))).toBe("cancel_reserve:invalid_session");
        expect((await reserve(db, "DTB-1", sid, "x".repeat(200))).reason).toHaveLength(200);
      });
    });

    describe("transition guard", () => {
      const setup = async () => {
        const db = await fresh();
        await paidOrder(db);
        const r = await reserve(db, "DTB-1", await session(db));
        return { db, id: r.cancellation_id };
      };
      it("INSERT must be pending; DELETE is refused", async () => {
        const { db, id } = await setup();
        for (const s of ["done", "failed", "reconciliation_required"]) {
          expect(await run(db, `insert into payment_cancellations (order_id, win_id, payment_key, amount, reason, toss_idempotency_key, status)
            select 'DTB-1', win_id, payment_key, amount, 'x', 'k-${s}', '${s}' from orders`)).toBe(`payment_cancellation_transition_forbidden:insert_${s}`);
        }
        expect(await run(db, `delete from payment_cancellations where id = '${id}'`)).toBe("payment_cancellation_transition_forbidden:delete");
      });
      it("identity fields and the Idempotency-Key never change", async () => {
        const { db, id } = await setup();
        for (const set of ["order_id = 'DTB-2'", "win_id = gen_random_uuid()", "payment_key = 'pk_x'", "amount = 1", "reason = 'other'", "requested_at = now() - interval '1 day'"]) {
          expect(await run(db, `update payment_cancellations set ${set} where id = '${id}'`), set).toBe("payment_cancellation_transition_forbidden:identity");
        }
        expect(await run(db, `update payment_cancellations set toss_idempotency_key = 'cancel-new' where id = '${id}'`)).toBe("payment_cancellation_transition_forbidden:idempotency_key");
      });
      it("allowed moves only: failed / done are terminal", async () => {
        const allowed: Record<string, string[]> = {
          pending: ["pending", "done", "failed", "reconciliation_required"],
          reconciliation_required: ["reconciliation_required", "done", "failed"],
          failed: ["failed"], done: ["done"],
        };
        for (const [from, ok] of Object.entries(allowed)) {
          for (const to of ["pending", "done", "failed", "reconciliation_required"]) {
            const { db, id } = await setup();
            await db.exec(`alter table payment_cancellations disable trigger payment_cancellations_guard_transition;
              update payment_cancellations set status = '${from}', toss_status = 'CANCELED', toss_transaction_key = 'tx', canceled_at = now(), completed_at = now(),
                initial_post_outcome = 'definite_rejection', initial_post_http_status = 403, initial_post_error_code = 'X' where id = '${id}';
              alter table payment_cancellations enable trigger payment_cancellations_guard_transition`);
            const res = await run(db, `update payment_cancellations set status = '${to}' where id = '${id}'`);
            expect(res, `${from} -> ${to}`).toBe(ok.includes(to) ? "ok" : `payment_cancellation_transition_forbidden:${from}_to_${to}`);
          }
        }
      }, 60_000);
      it("a done row's transaction key / canceled_at / completed_at never change; requested_by_session only to NULL (session deleted)", async () => {
        const { db, id } = await setup();
        await finalize(db, id);
        for (const set of ["toss_transaction_key = 'tx_2'", "canceled_at = now()", "completed_at = now()"]) {
          expect(await run(db, `update payment_cancellations set ${set} where id = '${id}'`), set).toBe("payment_cancellation_transition_forbidden:done_fields");
        }
        expect(await run(db, `update payment_cancellations set requested_by_session = (select id from admin_sessions limit 1) where id = '${id}'`)).toBe("ok");
        const other = await session(db);
        expect(await run(db, `update payment_cancellations set requested_by_session = '${other}' where id = '${id}'`)).toBe("payment_cancellation_transition_forbidden:requested_by_session");
        expect(await run(db, "delete from admin_sessions")).toBe("ok");
        expect(await cancellation(db, id)).toMatchObject({ requested_by_session: null, status: "done" });
      });
    });

    describe("payment_cancel_mark / payment_cancel_finalize", () => {
      const setup = async () => {
        const db = await fresh();
        await paidOrder(db);
        const r = await reserve(db, "DTB-1", await session(db));
        return { db, id: r.cancellation_id };
      };
      it("mark: only from the given status; sets last_checked_at; a NULL toss status / response keeps the stored one", async () => {
        const { db, id } = await setup();
        expect(await mark(db, id, "reconciliation_required", "reconciliation_required")).toBe(false);
        expect(await mark(db, id, "pending", "reconciliation_required", "IN_PROGRESS", "cancel_timeout|lookup_status:IN_PROGRESS")).toBe(true);
        expect(await cancellation(db, id)).toMatchObject({ status: "reconciliation_required", toss_status: "IN_PROGRESS", error_detail: "cancel_timeout|lookup_status:IN_PROGRESS" });
        expect((await cancellation(db, id)).last_checked_at).not.toBeNull();
        await as(db, "service_role", "select payment_cancel_mark($1::uuid, 'reconciliation_required', 'reconciliation_required', null, null, 'recheck')", [id]);
        expect(await cancellation(db, id)).toMatchObject({ toss_status: "IN_PROGRESS", toss_response: { status: "IN_PROGRESS" }, error_detail: "recheck" });
        expect(await errorOf(as(db, "service_role", "select payment_cancel_mark($1::uuid, 'pending', 'done', null, null, 'x')", [id]))).toBe("cancel_mark:invalid");
      });
      it("mark failed: only with a Toss status of DONE, and never once a cancel was seen", async () => {
        const { db, id } = await setup();
        expect(await reject(db, id)).toBe(true);
        expect(await errorOf(mark(db, id, "pending", "failed", "CANCELED"))).toBe("cancel_mark:failed_needs_uncanceled_payment");
        expect(await errorOf(mark(db, id, "pending", "failed", null))).toBe("cancel_mark:failed_needs_uncanceled_payment");
        expect(await mark(db, id, "pending", "reconciliation_required", "PARTIAL_CANCELED")).toBe(true);
        expect(await errorOf(mark(db, id, "reconciliation_required", "failed", "DONE"))).toBe("cancel_mark:failed_needs_uncanceled_payment");
        expect((await cancellation(db, id)).status).toBe("reconciliation_required");
      });
      it("mark failed needs initial_post_outcome = definite_rejection (timeout / network / ambiguous / none -> refused)", async () => {
        for (const [outcome, http, code] of [[null, null, null], ["timeout_unknown", null, null], ["network_unknown", null, null],
          ["http_ambiguous", 500, "PROVIDER_ERROR"], ["http_ambiguous", 400, "ALREADY_CANCELED_PAYMENT"], ["verified_cancel", 200, null]] as const) {
          const { db, id } = await setup();
          if (outcome) expect(await recordPost(db, id, outcome, http, code)).toBe(true);
          expect(await errorOf(mark(db, id, "pending", "failed", "DONE")), String(outcome)).toBe("cancel_mark:failed_needs_definite_rejection");
          expect(await mark(db, id, "pending", "reconciliation_required", "DONE")).toBe(true);
          expect(await errorOf(mark(db, id, "reconciliation_required", "failed", "DONE")), String(outcome)).toBe("cancel_mark:failed_needs_definite_rejection");
          expect((await cancellation(db, id)).status).toBe("reconciliation_required");
        }
        // The table refuses it too, past the RPC and the trigger.
        const { db, id } = await setup();
        expect(await run(db, `alter table payment_cancellations disable trigger payment_cancellations_guard_transition;
          update payment_cancellations set status = 'failed' where id = '${id}'`)).toMatch(/payment_cancellations_failed_needs_rejection/);
        // NULLs never slip through a CHECK: a done row needs toss_status CANCELED, not NULL.
        expect(await run(db, `alter table payment_cancellations disable trigger payment_cancellations_guard_transition;
          update payment_cancellations set status = 'done', toss_status = null, toss_transaction_key = 'tx', canceled_at = now(), completed_at = now()
          where id = '${id}'`)).toMatch(/payment_cancellations_done_complete/);
      });
      it("record_post: once, while pending; machine-readable outcome + HTTP status + Toss code; shape enforced", async () => {
        const { db, id } = await setup();
        expect(await reject(db, id)).toBe(true);
        expect(await cancellation(db, id)).toMatchObject({ status: "pending", initial_post_outcome: "definite_rejection",
          initial_post_http_status: 403, initial_post_error_code: "API_KEY_ACCESS_DENIED", error_detail: null });
        expect(await recordPost(db, id, "timeout_unknown")).toBe(false);
        expect(await cancellation(db, id)).toMatchObject({ initial_post_outcome: "definite_rejection" });
        for (const set of ["initial_post_outcome = 'timeout_unknown', initial_post_http_status = null, initial_post_error_code = null",
          "initial_post_error_code = 'OTHER'", "initial_post_http_status = 400"]) {
          expect(await run(db, `update payment_cancellations set ${set} where id = '${id}'`), set).toBe("payment_cancellation_transition_forbidden:initial_post");
        }
        // Not pending -> nothing recorded; a direct write is refused too.
        const s2 = await setup();
        expect(await mark(s2.db, s2.id, "pending", "reconciliation_required", null)).toBe(true);
        expect(await recordPost(s2.db, s2.id, "network_unknown")).toBe(false);
        expect(await run(s2.db, `update payment_cancellations set initial_post_outcome = 'network_unknown' where id = '${s2.id}'`)).toBe("payment_cancellation_transition_forbidden:initial_post");
        expect(await cancellation(s2.db, s2.id)).toMatchObject({ initial_post_outcome: null });
        // Unknown value / inconsistent shapes.
        expect(await errorOf(recordPost((await setup()).db, id, "rejected"))).toBe("cancel_record_post:invalid");
        expect(await errorOf(recordPost((await setup()).db, id, null))).toBe("cancel_record_post:invalid");
        for (const [outcome, http, code] of [["definite_rejection", 403, null], ["definite_rejection", 408, "X"], ["definite_rejection", 429, "X"],
          ["definite_rejection", 500, "X"], ["definite_rejection", null, "X"], ["timeout_unknown", 504, null], ["network_unknown", null, "X"],
          ["http_ambiguous", null, null], ["verified_cancel", 400, null], ["verified_cancel", 200, "X"]] as const) {
          const t = await setup();
          expect(await errorOf(recordPost(t.db, t.id, outcome, http, code)), `${outcome} ${http} ${code}`).toMatch(/payment_cancellations_initial_post_shape/);
          expect(await cancellation(t.db, t.id)).toMatchObject({ initial_post_outcome: null });
        }
        // INSERT never carries an outcome.
        expect(await run(db, `insert into payment_cancellations (order_id, win_id, payment_key, amount, reason, toss_idempotency_key, initial_post_outcome)
          select 'DTB-1', win_id, payment_key, amount, 'x', 'k-ins', 'timeout_unknown' from orders`)).toBe("payment_cancellation_transition_forbidden:insert_initial_post");
      }, 60_000);
      it("finalize: done + orders.refunded_at = Toss's canceledAt (not now()), one transaction; idempotent replay", async () => {
        const { db, id } = await setup();
        expect(await finalize(db, id, "tx_1", CANCELED_AT)).toBe("done");
        const c = await cancellation(db, id);
        expect(c).toMatchObject({ status: "done", toss_status: "CANCELED", toss_transaction_key: "tx_1", error_detail: null });
        expect(new Date(c.canceled_at as string).toISOString()).toBe(new Date(CANCELED_AT).toISOString());
        expect(c.completed_at).not.toBeNull();
        const o = await one<{ refunded_at: string }>(db, "select refunded_at from orders where order_id = 'DTB-1'");
        expect(new Date(o.refunded_at).toISOString()).toBe(new Date(CANCELED_AT).toISOString());
        expect(await finalize(db, id, "tx_1", CANCELED_AT)).toBe("already_done");
        expect(await errorOf(finalize(db, id, "tx_other", CANCELED_AT))).toBe("cancel_finalize:done_mismatch");
        // The paid attempt and its order stay; nothing else changed.
        expect(await one(db, "select status from payment_attempts where order_id = 'DTB-1'")).toEqual({ status: "paid" });
      });
      it("finalize refuses (nothing written): not CANCELED / no transaction key / no canceledAt / failed row / order mismatch / duplicate transaction key", async () => {
        const { db, id } = await setup();
        expect(await errorOf(finalize(db, id, "tx", CANCELED_AT, "DONE"))).toBe("cancel_finalize:not_canceled");
        expect(await errorOf(finalize(db, id, " ", CANCELED_AT))).toBe("cancel_finalize:not_canceled");
        expect(await errorOf(as(db, "service_role", "select payment_cancel_finalize($1::uuid, 'CANCELED', 'tx', null, '{}')", [id]))).toBe("cancel_finalize:not_canceled");
        expect(await errorOf(finalize(db, "00000000-0000-4000-8000-000000000000"))).toBe("cancel_finalize:no_cancellation");
        await db.exec("update orders set amount = 1 where order_id = 'DTB-1'");
        expect(await errorOf(finalize(db, id))).toBe("cancel_finalize:order_mismatch");
        await db.exec(`update orders set amount = ${PRICE} where order_id = 'DTB-1'`);
        expect(await cancellation(db, id)).toMatchObject({ status: "pending", canceled_at: null });
        // Another order's cancellation already holds the transaction key.
        await paidOrder(db, "DTB-2", B);
        const r2 = await reserve(db, "DTB-2", await session(db));
        expect(await finalize(db, r2.cancellation_id, "tx_same")).toBe("done");
        expect(await errorOf(finalize(db, id, "tx_same"))).toMatch(/payment_cancellations_toss_transaction_key_key/);
        expect(await reject(db, id)).toBe(true);
        expect(await mark(db, id, "pending", "failed", "DONE")).toBe(true);
        expect(await errorOf(finalize(db, id))).toBe("cancel_finalize:status_failed");
        expect(await one(db, "select refunded_at from orders where order_id = 'DTB-1'")).toEqual({ refunded_at: null });
      });
    });

    describe("orders.refunded_at guard", () => {
      it("NULL on insert; only to a done cancellation's canceled_at; never changed once set", async () => {
        const db = await fresh();
        await paidOrder(db);
        expect(await run(db, `insert into orders (user_id, winner_id, product_name, amount, order_id, payment_key, refunded_at)
          values ('${A}', '${A}', 'p', 1, 'DTB-X', 'pk_x', now())`)).toBe("orders_refunded_at_forbidden:insert");
        expect(await errorOf(as(db, "service_role", "update orders set refunded_at = now() where order_id = 'DTB-1'"))).toBe("orders_refunded_at_forbidden:no_done_cancellation");
        const r = await reserve(db, "DTB-1", await session(db));
        expect(await finalize(db, r.cancellation_id)).toBe("done");
        expect(await errorOf(as(db, "service_role", "update orders set refunded_at = now() where order_id = 'DTB-1'"))).toBe("orders_refunded_at_forbidden:immutable");
        expect(await errorOf(as(db, "service_role", "update orders set refunded_at = null where order_id = 'DTB-1'"))).toBe("orders_refunded_at_forbidden:immutable");
        // Other order updates still work (the M4-A finalize inserts orders too).
        expect(await run(db, "update orders set product_name = product_name where order_id = 'DTB-1'")).toBe("ok");
      });
    });

    describe("unchanged game / payment behaviour", () => {
      it("a refund leaves the paid attempt + order: the win can't be paid again and admin_reset_game still sees it paid", async () => {
        const db = await fresh();
        const w = await paidOrder(db);
        const r = await reserve(db, "DTB-1", await session(db));
        await finalize(db, r.cancellation_id);
        expect(await errorOf(as(db, "service_role", "select payment_reserve_attempt('DTB-NEW', $1::uuid, $2::uuid, $3, 'pk_new', '홍', '010', '06236', '서울', '')", [A, w, PRICE])))
          .toMatch(/payment_attempts_one_active_per_win/);
        const paid = await one<{ n: number }>(db, "select count(*)::int n from orders where win_id = $1", [w]);
        expect(paid.n).toBe(1);
      });
    });

    describe("preconditions", () => {
      it("refuses without M4-A (chain up to M3 only) — nothing created", async () => {
        const db = new PGlite();
        await db.exec(SUPABASE);
        if (env === "pre1030") await db.exec(OLD_DEFAULT_ACL);
        for (const f of BEFORE_B1.filter((f) => f < "20261030200000")) expect(await run(db, readFileSync(pathJoin(DIR, f), "utf8"))).toBe("ok");
        // orders_payment_key_key (an M4-A constraint) is checked first.
        expect(await run(db, B1)).toMatch(/precondition failed: (orders_order_id_key \/ orders_payment_key_key|M4-A)/);
        expect(await one(db, "select to_regclass('public.payment_cancellations')::text t")).toEqual({ t: null });
      });
      it("refuses when an M4-A body is not the pinned one", async () => {
        const db = await freshBase();
        await db.exec("drop trigger payment_attempts_guard_transition on payment_attempts; drop function payment_attempts_guard_transition()");
        expect(await run(db, B1)).toMatch(/precondition failed: M4-A public\.payment_attempts_guard_transition\(\) body md5 is <missing>/);
      });
      it("refuses when an M4-B1 object already exists (re-run, a stray orders trigger, an orders.refunded_at column)", async () => {
        expect(await run(await fresh(), B1)).toMatch(/precondition failed: an M4-B1 object/);
        for (const pre of [
          "alter table orders add column refunded_at timestamptz",
          "create function public.x_trg() returns trigger language plpgsql as $f$ begin return new; end $f$; create trigger x before update on orders for each row execute function public.x_trg()",
        ]) {
          const db = await freshBase();
          await db.exec(pre);
          expect(await run(db, B1)).toMatch(/precondition failed: an M4-B1 object/);
          expect(await one(db, "select to_regclass('public.payment_cancellations')::text t")).toEqual({ t: null });
        }
      });
      it("a failing post-condition rolls the whole migration back", async () => {
        const db = await freshBase();
        expect(await run(db, `begin; ${B1.replace("'9e3c4d40972a7ef7a56f2bb2b105382d', true", "'00000000000000000000000000000000', true")}; commit;`))
          .toMatch(/post-condition failed: public\.payment_cancel_reserve/);
        expect(await one(db, "select to_regclass('public.payment_cancellations')::text t, (select count(*)::int from information_schema.columns where table_name = 'orders' and column_name = 'refunded_at') c"))
          .toEqual({ t: null, c: 0 });
      });
    });

    describe("rollback (supabase/rollbacks, manual)", () => {
      it("is not a migration", () => {
        expect(FILES.some((f) => f.includes("rollback"))).toBe(false);
      });
      it("refuses once any refund history exists (a row, or orders.refunded_at)", async () => {
        const db = await fresh();
        await paidOrder(db);
        const r = await reserve(db, "DTB-1", await session(db));
        expect(await run(db, ROLLBACK)).toMatch(/rollback refused: 1 payment_cancellations row/);
        expect(await md5(db, SIG.reserve)).toBe(MD5.reserve);
        await finalize(db, r.cancellation_id);
        expect(await run(db, ROLLBACK)).toMatch(/rollback refused/);
      });
      it("on a clean state removes every M4-B1 object; M4-B1 applies again afterwards; M4-A untouched", async () => {
        const db = await fresh();
        await paidOrder(db);
        expect(await run(db, ROLLBACK)).toBe("ok");
        for (const k of Object.keys(SIG) as (keyof typeof SIG)[]) expect(await md5(db, SIG[k])).toBeNull();
        expect(await one(db, "select to_regclass('public.payment_cancellations')::text t, (select count(*)::int from information_schema.columns where table_name = 'orders' and column_name = 'refunded_at') c"))
          .toEqual({ t: null, c: 0 });
        for (const [sig, h] of Object.entries(UNCHANGED_MD5)) expect(await md5(db, sig), sig).toBe(h);
        expect(await one(db, "select status from payment_attempts where order_id = 'DTB-1'")).toEqual({ status: "paid" });
        expect(await run(db, B1)).toBe("ok");
        expect(await md5(db, SIG.finalize)).toBe(MD5.finalize);
      });
    });
  });
}
