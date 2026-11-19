// Review accounts may join a live round
// (supabase/migrations/20261119100000_review_account_live_join.sql). Runs the
// REAL migration chain on PGlite (Supabase stub roles/auth) in both
// default-ACL environments, then this migration, its preconditions and its
// rollback. Harness copied from scheduledStartM3.test.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = pathJoin(__dirname, "..", "supabase", "migrations");
const RV_FILE = "20261119100000_review_account_live_join.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE = FILES.filter((f) => f < RV_FILE);
const RV = readFileSync(pathJoin(DIR, RV_FILE), "utf8");
const ROLLBACK = readFileSync(pathJoin(__dirname, "..", "supabase", "rollbacks", "20261119100000_review_account_live_join.rollback.sql"), "utf8");
const OPS = readFileSync(pathJoin(__dirname, "..", "supabase", "ops", "review_accounts.sql"), "utf8");

const JOIN = "public.join_game_participant(uuid,text,text,uuid)";
const AMR = "public.am_i_review_account()";
const PRE_MD5 = "b8d03a4d9dcc5e349d9a30b6d349511d";
const RV_MD5 = { join: "a0ba24fbba36a716eea3c90b7a91b41e", amr: "ba41bab0e9f4cbc8ea3d3379e6463158" };

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
const S_A2 = "a2a2a2a2-1111-4111-8111-111111111112";
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

// A signed-in account that has just cleared the Turnstile route.
async function user(db: PGlite, uid: string) {
  await db.query("insert into auth.users (id) values ($1) on conflict do nothing", [uid]);
  await db.query(`insert into participant_verifications (guest_id, verified_at) values ($1, now())
                  on conflict (guest_id) do update set verified_at = now()`, [uid]);
}

// One transaction (fixed now()): `setup` as the DB owner, then the join as
// /api/join/participant makes it (service_role). "ok" or the error message.
async function joinTx(db: PGlite, setup: string, uid = A, session = S_A, device = `dev-${uid}`) {
  await user(db, uid);
  return run(db, `begin; ${setup}; set local role service_role;
                  select join_game_participant('${uid}', 'nick-${uid.slice(0, 4)}', '${device}', '${session}'); commit;`);
}
const joinNow = (db: PGlite, uid = A, session = S_A, device = `dev-${uid}`) => joinTx(db, "select 1", uid, session, device);

const setT = (db: PGlite, expr: string, lead = 30) =>
  db.exec(`update game_state set scheduled_start_at = ${expr}, participant_join_lead_minutes = ${lead} where id = 1`);

const startGame = async (db: PGlite, role: Role = "anon", claims: Record<string, unknown> | null = null) =>
  (await as<{ ok: boolean }>(db, role, claims, "select start_game() as ok"))[0].ok;
const forceStart = async (db: PGlite) => (await as<{ ok: boolean }>(db, "service_role", null, "select admin_force_start_game() as ok"))[0].ok;
const schedule = (db: PGlite, start: string | null, lead: number | null) =>
  as(db, "service_role", null, "select admin_update_schedule($1::timestamptz, $2::integer)", [start, lead]);
const claim = async (db: PGlite, uid = A, session = S_A) =>
  (await as<{ won: boolean }>(db, "authenticated", { sub: uid, role: "authenticated", session_id: session }, "select claim_winner() as won"))[0].won;

const gs = (db: PGlite) => one<Record<string, unknown>>(db,
  `select phase, scheduled_start_at, game_started_at, strategy_started_at, participant_join_lead_minutes, winner_id, winner_price,
          is_paused, paused_total_ms, start_price from game_state where id = 1`);

// Window open (T in 10 min, N = 30) and participant A joined: phase strategy.
async function withParticipant(db: PGlite, uid = A, session = S_A) {
  await setT(db, "now() + interval '10 minutes'");
  expect(await joinNow(db, uid, session)).toBe("ok");
  expect((await gs(db)).phase).toBe("strategy");
}

const md5 = async (db: PGlite, sig: string) =>
  (await one<{ h: string | null }>(db, `select md5(regexp_replace(prosrc, '\\s+', '', 'g')) h from pg_proc where oid = to_regprocedure($1)`, [sig]))?.h ?? null;
const fnMeta = (db: PGlite, sig: string) =>
  one(db, `select prosecdef, proconfig, pg_get_userbyid(proowner) owner, proacl::text acl from pg_proc where oid = to_regprocedure($1)`, [sig]);

const listReview = (db: PGlite, uid: string) => db.query("insert into review_accounts (user_id) values ($1)", [uid]);
const amI = async (db: PGlite, uid: string) =>
  (await as<{ v: boolean }>(db, "authenticated", { sub: uid, role: "authenticated" }, "select am_i_review_account() as v"))[0].v;

// Round live: T in 10 min, A joined in the window, forced start.
async function live(db: PGlite) {
  await withParticipant(db);
  expect(await forceStart(db)).toBe(true);
  expect((await gs(db)).phase).toBe("game");
}

for (const env of ["pre1030", "post1030"] as const) {
  describe(`review accounts join a live round (${env})`, () => {
    let base: PGlite; // chain before this migration == Production now
    let rv: PGlite;   // base + this migration
    const fresh = () => rv.clone() as Promise<PGlite>;
    const freshBase = () => base.clone() as Promise<PGlite>;

    beforeAll(async () => {
      base = new PGlite();
      await base.exec(SUPABASE);
      if (env === "pre1030") await base.exec(OLD_DEFAULT_ACL);
      for (const f of BEFORE) {
        const r = await run(base, readFileSync(pathJoin(DIR, f), "utf8"));
        if (r !== "ok") throw new Error(`${f}: ${r}`);
      }
      rv = (await base.clone()) as PGlite;
      const r = await run(rv, RV);
      if (r !== "ok") throw new Error(`RV: ${r}`);
    }, 180_000);

    it("is the last migration, no explicit BEGIN/COMMIT; bodies as pinned; metadata kept", async () => {
      expect(FILES.at(-1)).toBe(RV_FILE);
      expect(RV).not.toMatch(/^\s*(begin|commit)\s*;/im);
      expect(await md5(base, JOIN)).toBe(PRE_MD5);
      expect(await md5(rv, JOIN)).toBe(RV_MD5.join);
      expect(await md5(base, AMR)).toBeNull();
      expect(await md5(rv, AMR)).toBe(RV_MD5.amr);
      expect(await fnMeta(rv, JOIN)).toEqual(await fnMeta(base, JOIN));
    });

    it("a non-listed account still cannot join a live round", async () => {
      const db = await fresh();
      await live(db);
      expect(await joinNow(db, B, S_B)).toBe("participant join closed");
      expect(await claim(db, B, S_B)).toBe(false);
    });

    it("a listed account joins a live round and can claim with that session", async () => {
      const db = await fresh();
      await live(db);
      await user(db, B);
      await listReview(db, B);
      expect(await joinNow(db, B, S_B)).toBe("ok");
      expect(await one(db, "select role from participants where guest_id = $1", [B])).toEqual({ role: "participant" });
      expect(await claim(db, B, S_B)).toBe(true);
      const g = await gs(db);
      expect(g.phase).toBe("ended");
      expect(g.winner_id).toBe(B);
    });

    it("a listed account re-joining from a new session takes over once the old one is stale, then claims", async () => {
      const db = await fresh();
      await live(db);
      await user(db, B);
      await listReview(db, B);
      expect(await joinNow(db, B, S_B)).toBe("ok");
      expect(await joinNow(db, B, S_A2)).toBe("account active on another session");
      await db.exec(`update account_round_guard set last_seen_at = now() - interval '5 minutes' where user_id = '${B}'`);
      expect(await joinNow(db, B, S_A2)).toBe("ok");
      expect(await claim(db, B, S_B)).toBe(false);
      expect(await claim(db, B, S_A2)).toBe(true);
    });

    it("listing changes nothing outside a live round: the T - N .. T window still applies", async () => {
      const db = await fresh();
      await user(db, B);
      await listReview(db, B);
      expect(await joinTx(db, "update game_state set scheduled_start_at = null", B, S_B)).toBe("participant_join_not_open");
      expect(await joinTx(db, "update game_state set scheduled_start_at = now() + interval '31 minutes'", B, S_B)).toBe("participant_join_not_open");
      expect(await joinTx(db, "update game_state set phase = 'ended'", B, S_B)).toBe("participant join closed");
    });

    it("after someone has won, a listed account may join but cannot claim", async () => {
      const db = await fresh();
      await live(db);
      expect(await claim(db)).toBe(true);
      await user(db, B);
      await listReview(db, B);
      expect(await joinNow(db, B, S_B)).toBe("participant join closed"); // phase is 'ended' now
      expect(await claim(db, B, S_B)).toBe(false);
    });

    it("am_i_review_account(): true only for the listed caller; anon cannot call it", async () => {
      const db = await fresh();
      await user(db, A);
      await user(db, B);
      await listReview(db, B);
      expect(await amI(db, B)).toBe(true);
      expect(await amI(db, A)).toBe(false);
      expect(await errorOf(as(db, "anon", null, "select am_i_review_account()"))).toMatch(/permission denied/);
      expect((await as<{ v: boolean }>(db, "authenticated", { role: "authenticated" }, "select am_i_review_account() as v"))[0].v).toBe(false);
    });

    it("review_accounts is closed to anon / authenticated and starts empty", async () => {
      const db = await fresh();
      expect(await rows(db, "select 1 from review_accounts")).toEqual([]);
      for (const role of ["anon", "authenticated"] as const) {
        expect(await errorOf(as(db, role, null, "select * from review_accounts"))).toMatch(/permission denied/);
        expect(await errorOf(as(db, role, null, `insert into review_accounts (user_id) values ('${A}')`))).toMatch(/permission denied/);
      }
    });

    it("refuses during a round in progress and on an unexpected body; nothing changes", async () => {
      const db = await freshBase();
      await withParticipant(db);
      expect(await run(db, `begin; ${RV} commit;`)).toMatch(/precondition failed: game_state.phase is strategy/);
      expect(await md5(db, JOIN)).toBe(PRE_MD5);
      expect(await one(db, "select to_regclass('public.review_accounts') r")).toEqual({ r: null });

      const db2 = await freshBase();
      await db2.exec(`create or replace function public.join_game_participant(p_uid uuid, p_nickname text, p_device_hash text, p_session_id uuid)
        returns void language plpgsql security definer set search_path = public as $f$ begin null; end; $f$`);
      expect(await run(db2, `begin; ${RV} commit;`)).toMatch(/precondition failed: join_game_participant body md5/);
    });

    it("rollback restores the previous body and drops the table and function", async () => {
      const db = await fresh();
      await user(db, B);
      await listReview(db, B);
      expect(await run(db, ROLLBACK)).toBe("ok");
      expect(await md5(db, JOIN)).toBe(PRE_MD5);
      expect(await fnMeta(db, JOIN)).toEqual(await fnMeta(base, JOIN));
      expect(await md5(db, AMR)).toBeNull();
      expect(await one(db, "select to_regclass('public.review_accounts') r")).toEqual({ r: null });
    });

    it("ops SQL prints no user id (no RETURNING / select of user_id)", () => {
      expect(OPS).not.toMatch(/returning/i);
      expect(OPS).not.toMatch(/select\s+[^;]*user_id[^;]*from\s+public\.review_accounts/i);
    });
  });
}
