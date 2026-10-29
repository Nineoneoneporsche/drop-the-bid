// M3 (supabase/migrations/20261030100000_scheduled_start_join_window.sql):
// the scheduled start T is the auction's only time axis. Runs the REAL
// migration chain on PGlite (Supabase stub roles/auth), in both default-ACL
// environments, then M3 itself, its preconditions and its rollback.
//
// Boundary cases run inside one transaction, where now() is fixed, so
// "1 µs before T" is exact. PGlite has a single connection: concurrent
// callers are serialized, so the race tests check the outcome of every
// ordering plus the row locks the functions take, not true parallelism.
import { readFileSync, readdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = pathJoin(__dirname, "..", "supabase", "migrations");
const M3_FILE = "20261030100000_scheduled_start_join_window.sql";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const BEFORE_M3 = FILES.filter((f) => f < M3_FILE);
const M3 = readFileSync(pathJoin(DIR, M3_FILE), "utf8");
const ROLLBACK = readFileSync(pathJoin(__dirname, "..", "supabase", "rollbacks", "20261030100000_scheduled_start_join_window.rollback.sql"), "utf8");

const SIGS = {
  join: "public.join_game_participant(uuid,text,text,uuid)",
  start: "public.start_game()",
  force: "public.admin_force_start_game()",
  schedule: "public.admin_update_schedule(timestamptz,integer)",
};
const PRE_MD5 = { join: "6a02b52987290c468efad952ad43c057", start: "f8148a6a15c973d48b4b372a5e49a554", force: "92115841ed6a40b50f03e3c17fde1a60" };
const M3_MD5 = {
  join: "b8d03a4d9dcc5e349d9a30b6d349511d", start: "8f8cba95b88422c9c717bb804faa6da9",
  force: "0251520809f95fa35f1c010dd6deeade", schedule: "fadb9870e7de7dbd0a6ce3591cfd73b0",
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

for (const env of ["pre1030", "post1030"] as const) {
  describe(`M3 scheduled start (${env})`, () => {
    let base: PGlite; // the 32 migrations before M3 == Production after M2
    let m3: PGlite;   // base + M3
    const fresh = () => m3.clone() as Promise<PGlite>;
    const freshBase = () => base.clone() as Promise<PGlite>;

    beforeAll(async () => {
      base = new PGlite();
      await base.exec(SUPABASE);
      if (env === "pre1030") await base.exec(OLD_DEFAULT_ACL);
      for (const f of BEFORE_M3) {
        const r = await run(base, readFileSync(pathJoin(DIR, f), "utf8"));
        if (r !== "ok") throw new Error(`${f}: ${r}`);
      }
      m3 = (await base.clone()) as PGlite;
      const r = await run(m3, M3);
      if (r !== "ok") throw new Error(`M3: ${r}`);
    }, 180_000);

    it("36. fresh replay: 33 migrations, M3 last, no explicit BEGIN/COMMIT; pre/post bodies as pinned", async () => {
      expect(BEFORE_M3).toHaveLength(32);
      expect(BEFORE_M3.at(-1)).toBe("20261029100000_reset_game_uses_auction_wins.sql");
      expect(FILES).toHaveLength(33);
      expect(FILES.at(-1)).toBe(M3_FILE);
      expect(M3).not.toMatch(/^\s*(begin|commit)\s*;/im);
      for (const k of ["join", "start", "force"] as const) {
        expect(await md5(base, SIGS[k])).toBe(PRE_MD5[k]);
        expect(await md5(m3, SIGS[k])).toBe(M3_MD5[k]);
      }
      expect(await md5(base, SIGS.schedule)).toBeNull();
      expect(await md5(m3, SIGS.schedule)).toBe(M3_MD5.schedule);
    });

    describe("N: participant_join_lead_minutes", () => {
      it("1. integer not null default 30 (the existing row gets 30)", async () => {
        const db = await fresh();
        expect((await gs(db)).participant_join_lead_minutes).toBe(30);
        expect(await one(db, `select data_type, is_nullable, column_default from information_schema.columns
                              where table_name = 'game_state' and column_name = 'participant_join_lead_minutes'`))
          .toEqual({ data_type: "integer", is_nullable: "NO", column_default: "30" });
      });
      it("2. < 1 or > 180 (and null) rejected by the CHECK; 1 and 180 accepted", async () => {
        const db = await fresh();
        for (const v of ["0", "-5", "181", "null"]) {
          expect(await run(db, `update game_state set participant_join_lead_minutes = ${v} where id = 1`))
            .toMatch(/participant_join_lead_minutes|not-null|null value/);
        }
        for (const v of [1, 180]) expect(await run(db, `update game_state set participant_join_lead_minutes = ${v} where id = 1`)).toBe("ok");
      });
      it("anon / authenticated can read it (table-level SELECT) but not write it", async () => {
        const db = await fresh();
        for (const role of ["anon", "authenticated"] as const) {
          expect(await as(db, role, null, "select participant_join_lead_minutes from game_state")).toEqual([{ participant_join_lead_minutes: 30 }]);
          expect(await errorOf(as(db, role, null, "update game_state set participant_join_lead_minutes = 5"))).toMatch(/permission denied/);
        }
      });
    });

    describe("join window: T - N <= now() < T (DB time)", () => {
      it("3. T null -> participant_join_not_open", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set scheduled_start_at = null")).toBe("participant_join_not_open");
        expect((await gs(db)).phase).toBe("waiting");
      });
      it("4. 1 µs before T - N -> participant_join_not_open, nothing written", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set scheduled_start_at = now() + interval '30 minutes' + interval '1 microsecond'"))
          .toBe("participant_join_not_open");
        expect(await rows(db, "select 1 from participants")).toEqual([]);
        expect(await rows(db, "select 1 from device_round_guard")).toEqual([]);
      });
      it("5. exactly T - N -> allowed", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set scheduled_start_at = now() + interval '30 minutes'")).toBe("ok");
        expect((await gs(db)).phase).toBe("strategy");
      });
      it("6. inside the window -> allowed (also for a second participant, phase stays strategy)", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set scheduled_start_at = now() + interval '20 minutes'")).toBe("ok");
        expect(await joinNow(db, B, S_B)).toBe("ok");
        expect(await rows(db, "select guest_id::text from participants where role = 'participant' order by 1")).toEqual([{ guest_id: A }, { guest_id: B }]);
      });
      it("7. 1 µs before T -> allowed", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set scheduled_start_at = now() + interval '1 microsecond'")).toBe("ok");
      });
      it("8. at T and after -> participant join closed (waiting and strategy)", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set scheduled_start_at = now()")).toBe("participant join closed");
        expect(await joinTx(db, "update game_state set scheduled_start_at = now() - interval '1 second'")).toBe("participant join closed");
        await withParticipant(db);
        expect(await joinTx(db, "update game_state set scheduled_start_at = now()", B, S_B)).toBe("participant join closed");
      });
      it("N follows the column: N = 5 -> 6 min before T refused, 5 min before allowed", async () => {
        const db = await fresh();
        expect(await joinTx(db, "update game_state set participant_join_lead_minutes = 5, scheduled_start_at = now() + interval '6 minutes'"))
          .toBe("participant_join_not_open");
        expect(await joinTx(db, "update game_state set participant_join_lead_minutes = 5, scheduled_start_at = now() + interval '5 minutes'")).toBe("ok");
      });
      it("game / ended -> participant join closed, even inside a window", async () => {
        const db = await fresh();
        for (const phase of ["game", "ended"]) {
          expect(await joinTx(db, `update game_state set phase = '${phase}', scheduled_start_at = now() + interval '10 minutes'`))
            .toBe("participant join closed");
        }
      });
      it("9 / 10. joining never moves T, N or game_started_at; strategy_started_at is not a timing input", async () => {
        const db = await fresh();
        await setT(db, "now() + interval '10 minutes'");
        const before = await gs(db);
        expect(await joinNow(db)).toBe("ok");
        expect(await joinNow(db, B, S_B)).toBe("ok");
        const after = await gs(db);
        expect(after).toMatchObject({
          phase: "strategy", scheduled_start_at: before.scheduled_start_at,
          participant_join_lead_minutes: before.participant_join_lead_minutes, game_started_at: null,
        });
        expect(after.strategy_started_at).not.toBeNull();
        // The old rule (strategy_started_at + 60 s) would start now; T decides.
        await db.exec("update game_state set strategy_started_at = now() - interval '1 hour'");
        expect(await startGame(db)).toBe(false);
        expect((await gs(db)).phase).toBe("strategy");
      });
    });

    describe("start_game(): at T, with a participant; game_started_at = T", () => {
      it("11. before T -> false (also 1 µs before T, in one transaction)", async () => {
        const db = await fresh();
        await withParticipant(db);
        expect(await startGame(db)).toBe(false);
        expect(await run(db, `begin; update game_state set scheduled_start_at = now() + interval '1 microsecond';
                              do $$ begin if start_game() then raise exception 'started early'; end if; end $$; commit;`)).toBe("ok");
        expect((await gs(db)).phase).toBe("strategy");
      });
      it("12 / 13. at exactly T -> true, phase game, game_started_at exactly T, fresh health lease", async () => {
        const db = await fresh();
        await withParticipant(db);
        await db.exec("update service_health set lease_until = now() - interval '1 hour'");
        expect(await run(db, `begin; update game_state set scheduled_start_at = now();
                              do $$ begin if not start_game() then raise exception 'not started'; end if; end $$; commit;`)).toBe("ok");
        const g = await gs(db);
        expect(g.phase).toBe("game");
        expect(g.game_started_at).toEqual(g.scheduled_start_at);
        expect((await one<{ ok: boolean }>(db, "select lease_until > now() ok from service_health where service_name = 'auction_api'")).ok).toBe(true);
      });
      it("14. called 20 s late -> game_started_at is still T (not the call time)", async () => {
        const db = await fresh();
        await withParticipant(db);
        await setT(db, "now() - interval '20 seconds'");
        const T = (await gs(db)).scheduled_start_at;
        expect(await startGame(db)).toBe(true);
        const g = await gs(db);
        expect(g.game_started_at).toEqual(T);
        expect((await one<{ s: number }>(db, "select extract(epoch from now() - game_started_at)::float8 s from game_state")).s).toBeGreaterThanOrEqual(20);
      });
      it("15. no participant -> false: waiting after T stays waiting, strategy without a guard holder stays strategy", async () => {
        const db = await fresh();
        await setT(db, "now() - interval '5 seconds'");
        expect(await startGame(db)).toBe(false);
        expect(await gs(db)).toMatchObject({ phase: "waiting", game_started_at: null });
        expect(await joinNow(db)).toBe("participant join closed");

        const db2 = await fresh();
        await withParticipant(db2);
        await db2.exec("delete from participants");
        await setT(db2, "now() - interval '5 seconds'");
        expect(await startGame(db2)).toBe(false);
        expect(await gs(db2)).toMatchObject({ phase: "strategy", game_started_at: null });
      });
      it("15b. a spectator row or a guard of another round is not a participant", async () => {
        const db = await fresh();
        await withParticipant(db);
        await db.exec(`update participants set role = 'spectator'`);
        await setT(db, "now() - interval '1 second'");
        expect(await startGame(db)).toBe(false);
        await db.exec(`update participants set role = 'participant'; update account_round_guard set round_key = gen_random_uuid()`);
        expect(await startGame(db)).toBe(false);
        expect((await gs(db)).phase).toBe("strategy");
      });
      it("16. two callers -> exactly one transition; game_started_at not moved by the second", async () => {
        const db = await fresh();
        await withParticipant(db);
        await setT(db, "now() - interval '1 second'");
        const results = [await startGame(db, "anon"), await startGame(db, "authenticated", { role: "authenticated", sub: B })];
        expect(results.filter(Boolean)).toHaveLength(1);
        const after = (await gs(db)).game_started_at;
        expect(await startGame(db)).toBe(false);
        expect((await gs(db)).game_started_at).toEqual(after);
        // The transition is a single UPDATE guarded by phase = 'strategy' (row lock + recheck).
        const src = (await one<{ s: string }>(db, `select prosrc s from pg_proc where oid = '${SIGS.start}'::regprocedure`)).s;
        expect(src).toMatch(/update game_state gs\s+set phase = 'game', game_started_at = gs\.scheduled_start_at\s+where gs\.id = 1\s+and gs\.phase = 'strategy'/);
      });
      it("17. nothing a client sends moves the DB decision (no time arguments; claims ignored)", async () => {
        const db = await fresh();
        await withParticipant(db);
        const future = { role: "authenticated", sub: A, session_id: S_A, now: "2099-01-01T00:00:00Z", iat: 4070908800 };
        expect(await startGame(db, "authenticated", future)).toBe(false);
        expect(await one(db, `select pronargs from pg_proc where oid = '${SIGS.start}'::regprocedure`)).toEqual({ pronargs: 0 });
        const args = await one<{ t: string }>(db, `select pg_get_function_identity_arguments('${SIGS.join}'::regprocedure) t`);
        expect(args.t).not.toMatch(/timestamp/);
      });
      it("25. price runs off T: 20 s after T the claim price is the 20 s price", async () => {
        const db = await fresh();
        await withParticipant(db);
        await db.exec(`update game_state set start_price = 899000, minimum_price = 550000, drop_amount = 1000,
                       fast_drop_price = null, fast_drop_amount = null, final_drop_price = null, final_drop_amount = null,
                       drop_interval_seconds = 1 where id = 1`);
        await setT(db, "now() - interval '20 seconds'");
        expect(await startGame(db)).toBe(true);
        expect(await claim(db)).toBe(true);
        const p = (await gs(db)).winner_price as number;
        expect(p).toBeLessThanOrEqual(899000 - 20 * 1000);
        expect(p).toBeGreaterThanOrEqual(899000 - 22 * 1000);
      });
      it("26. claim_winner before T (strategy) -> false; at T after start -> true", async () => {
        const db = await fresh();
        await withParticipant(db);
        expect(await claim(db)).toBe(false);
        await setT(db, "now() + interval '1 microsecond'"); // still strategy, T a hair away
        expect(await claim(db)).toBe(false);
        await setT(db, "now() - interval '1 second'");
        expect(await startGame(db)).toBe(true);
        expect(await claim(db)).toBe(true);
      });
    });

    describe("admin_update_schedule(p_start, p_lead_minutes)", () => {
      it("18. waiting -> sets T and N together", async () => {
        const db = await fresh();
        const t = (await one<{ t: string }>(db, "select (now() + interval '2 hours')::text t")).t;
        await schedule(db, t, 45);
        const g = await gs(db);
        expect(g.participant_join_lead_minutes).toBe(45);
        expect((await one<{ ok: boolean }>(db, "select scheduled_start_at = $1::timestamptz ok from game_state", [t])).ok).toBe(true);
        await schedule(db, null, 10); // clearing T (no auction scheduled) is allowed
        expect(await gs(db)).toMatchObject({ scheduled_start_at: null, participant_join_lead_minutes: 10 });
      });
      it("19. strategy / game / ended -> schedule_locked:not_waiting, nothing changes", async () => {
        const db = await fresh();
        for (const phase of ["strategy", "game", "ended"]) {
          await db.exec(`update game_state set phase = '${phase}'`);
          const before = await gs(db);
          expect(await errorOf(schedule(db, "2099-01-01T00:00:00Z", 30))).toBe("schedule_locked:not_waiting");
          expect(await gs(db)).toEqual(before);
        }
      });
      it("20. N out of 1..180 or null -> schedule_invalid:lead_minutes", async () => {
        const db = await fresh();
        for (const n of [0, -1, 181, null]) {
          expect(await errorOf(schedule(db, "2099-01-01T00:00:00Z", n))).toBe("schedule_invalid:lead_minutes");
        }
        expect((await gs(db)).participant_join_lead_minutes).toBe(30);
      });
      it("21. T in the past or within 60 s -> schedule_invalid:start_too_soon; 61 s ahead is fine", async () => {
        const db = await fresh();
        for (const off of ["-1 minute", "0 seconds", "59 seconds", "60 seconds"]) {
          const t = (await one<{ t: string }>(db, `select (now() + interval '${off}')::text t`)).t;
          expect(await errorOf(schedule(db, t, 30))).toBe("schedule_invalid:start_too_soon");
        }
        const ok = (await one<{ t: string }>(db, "select (now() + interval '61 seconds')::text t")).t;
        expect(await errorOf(schedule(db, ok, 30))).toBeNull();
      });
      it("22. vs a join: both lock the game_state row; join first -> schedule refused; schedule first -> join judged on the new T", async () => {
        const db = await fresh();
        await withParticipant(db); // join first
        expect(await errorOf(schedule(db, "2099-01-01T00:00:00Z", 30))).toBe("schedule_locked:not_waiting");

        const db2 = await fresh();
        await setT(db2, "now() + interval '10 minutes'");
        await schedule(db2, (await one<{ t: string }>(db2, "select (now() + interval '3 hours')::text t")).t, 30); // schedule first
        expect(await joinNow(db2)).toBe("participant_join_not_open");

        for (const sig of [SIGS.schedule, SIGS.join]) {
          const s = (await one<{ s: string }>(db, `select prosrc s from pg_proc where oid = to_regprocedure($1)`, [sig])).s;
          expect(s).toMatch(/from game_state where id = 1 for update/);
        }
      });
      it("service_role only (anon / authenticated: permission denied)", async () => {
        const db = await fresh();
        for (const role of ["anon", "authenticated"] as const) {
          expect(await errorOf(as(db, role, { role, sub: A }, "select admin_update_schedule(now() + interval '1 day', 30)"))).toMatch(/permission denied/);
        }
      });
    });

    describe("admin_force_start_game(): T := game_started_at := now()", () => {
      it("23. with a participant before T -> game; scheduled_start_at == game_started_at; lease stamped", async () => {
        const db = await fresh();
        await withParticipant(db);
        await db.exec("update service_health set lease_until = now() - interval '1 hour'");
        expect(await forceStart(db)).toBe(true);
        const g = await gs(db);
        expect(g.phase).toBe("game");
        expect(g.game_started_at).toEqual(g.scheduled_start_at);
        expect((await one<{ ok: boolean }>(db, "select lease_until > now() ok from service_health")).ok).toBe(true);
        expect(await claim(db)).toBe(true);
      });
      it("24. no participant -> false, in waiting and in strategy; never in game / ended", async () => {
        const db = await fresh();
        await setT(db, "now() + interval '10 minutes'");
        expect(await forceStart(db)).toBe(false);
        await db.exec("update game_state set phase = 'strategy'");
        expect(await forceStart(db)).toBe(false);
        expect(await gs(db)).toMatchObject({ phase: "strategy", game_started_at: null });

        const db2 = await fresh();
        await withParticipant(db2);
        for (const phase of ["game", "ended"]) {
          await db2.exec(`update game_state set phase = '${phase}', game_started_at = null`);
          expect(await forceStart(db2)).toBe(false);
        }
      });
    });

    describe("regressions", () => {
      it("27. pause / resume unchanged", async () => {
        const db = await fresh();
        await withParticipant(db);
        expect((await as<{ ok: boolean }>(db, "service_role", null, "select pause_game('manual') ok"))[0].ok).toBe(false); // not in game yet
        await setT(db, "now() - interval '10 seconds'");
        expect(await startGame(db)).toBe(true);
        expect((await as<{ ok: boolean }>(db, "service_role", null, "select pause_game('manual') ok"))[0].ok).toBe(true);
        expect(await claim(db)).toBe(false);
        await db.exec("update game_state set paused_at = paused_at - interval '3 seconds'");
        expect((await as<{ ok: boolean }>(db, "service_role", null, "select resume_game() ok"))[0].ok).toBe(true);
        expect((await gs(db)).paused_total_ms as number).toBeGreaterThanOrEqual(3000);
        expect(await claim(db)).toBe(true);
      });
      it("28. health lease: a late transition stamps a fresh lease, no false pause; an expired lease still pauses", async () => {
        const db = await fresh();
        await withParticipant(db);
        await db.exec("update service_health set lease_until = now() - interval '1 day'");
        await setT(db, "now() - interval '20 seconds'");
        expect(await startGame(db)).toBe(true);
        const t = (await as<{ r: { recovered_from_expiry: boolean } }>(db, "service_role", null, "select touch_health_lease() r"))[0].r;
        expect(t.recovered_from_expiry).toBe(false);
        expect((await gs(db)).is_paused).toBe(false);
        await db.exec("update service_health set lease_until = now() - interval '5 seconds'");
        expect(await claim(db)).toBe(false);
        expect((await gs(db)).is_paused).toBe(true);
      });
      it("29. device and account guards unchanged inside the window", async () => {
        const db = await fresh();
        await withParticipant(db);
        expect(await joinNow(db, B, S_B, `dev-${A}`)).toBe("this device already joined as a participant this round");
        expect(await joinNow(db, A, S_A2)).toBe("account active on another session");
        expect(await joinNow(db, A, S_A)).toBe("ok"); // same session re-join
        await setT(db, "now() - interval '1 second'");
        expect(await startGame(db)).toBe(true);
        expect(await claim(db, A, S_A2)).toBe(false); // not the guard holder
      });
      it("30. M1: the claim writes its auction_wins row (game_started_at = T in price_inputs)", async () => {
        const db = await fresh();
        await withParticipant(db);
        await setT(db, "now() - interval '3 seconds'");
        expect(await startGame(db)).toBe(true);
        expect(await claim(db)).toBe(true);
        const w = await one<{ n: number; ok: boolean; started: boolean }>(db, `
          select count(*)::int n, bool_and(w.winning_price = g.winner_price and w.winner_id = g.winner_id) ok,
                 bool_and((w.price_inputs ->> 'game_started_at')::timestamptz = g.scheduled_start_at) started
          from auction_wins w join game_state g on g.round_key = w.round_key`);
        expect(w).toEqual({ n: 1, ok: true, started: true });
      });
      it("31. M2: an unpaid win inside its payment window still blocks the reset", async () => {
        const db = await fresh();
        await withParticipant(db);
        await setT(db, "now() - interval '1 second'");
        expect(await startGame(db)).toBe(true);
        expect(await claim(db)).toBe(true);
        expect(await errorOf(as(db, "service_role", null, "select admin_reset_game()"))).toBe("reset_blocked:unpaid_win_in_payment_window");
        expect(await md5(db, "public.admin_reset_game()")).toBe("e74405580db4c4694302f25e9d9d1e37");
        expect(await md5(db, "public.claim_winner()")).toBe("3b84dfd5ca929a55d5c093209693d225");
      });
      it("next round: reset keeps T (now past) -> joins closed until a new T; admin_update_schedule opens the next round", async () => {
        const db = await fresh();
        await withParticipant(db);
        await as(db, "service_role", null, "select admin_reset_game()");
        await setT(db, "now() - interval '1 minute'");
        expect(await joinNow(db)).toBe("participant join closed");
        await schedule(db, (await one<{ t: string }>(db, "select (now() + interval '10 minutes')::text t")).t, 30);
        expect(await joinNow(db)).toBe("ok");
      });
    });

    describe("update-config conditional UPDATE (the statement /api/admin/update-config sends)", () => {
      // PostgREST: .update(changes).eq("id", 1).in("phase", ["waiting"]).select("id")
      const lockedUpdate = (db: PGlite) => as<{ id: number }>(db, "service_role", null,
        `update game_state set start_price = 700000 where id = 1 and phase in ('waiting') returning id`);
      it("32. strategy / game / ended -> 0 rows, price inputs unchanged", async () => {
        const db = await fresh();
        for (const phase of ["strategy", "game", "ended"]) {
          await db.exec(`update game_state set phase = '${phase}'`);
          expect(await lockedUpdate(db)).toEqual([]);
          expect((await gs(db)).start_price).toBe(899000);
        }
      });
      it("33. waiting -> 1 row, applied", async () => {
        const db = await fresh();
        expect(await lockedUpdate(db)).toEqual([{ id: 1 }]);
        expect((await gs(db)).start_price).toBe(700000);
      });
      it("strategy after every participant left -> still 0 rows (frozen until reset); after reset -> 1 row", async () => {
        const db = await fresh();
        await withParticipant(db);
        await db.exec("delete from participants");
        expect((await gs(db)).phase).toBe("strategy");
        expect(await lockedUpdate(db)).toEqual([]);
        await as(db, "service_role", null, "select admin_reset_game()");
        expect(await lockedUpdate(db)).toEqual([{ id: 1 }]);
      });
    });

    it("34. owner / SECURITY DEFINER / search_path / EXECUTE grants of the replaced functions unchanged; new RPC service_role only", async () => {
      for (const k of ["join", "start", "force"] as const) expect(await fnMeta(m3, SIGS[k])).toEqual(await fnMeta(base, SIGS[k]));
      expect(await fnMeta(m3, SIGS.schedule)).toMatchObject({
        prosecdef: true, proconfig: ["search_path=public"], owner: (await fnMeta(m3, SIGS.start)).owner,
      });
      const priv = await rows(m3, `select r, has_function_privilege(r, '${SIGS.schedule}', 'execute') x
                                   from unnest(array['anon', 'authenticated', 'service_role']) r order by 1`);
      expect(priv).toEqual([{ r: "anon", x: false }, { r: "authenticated", x: false }, { r: "service_role", x: true }]);
      const startPriv = await rows(m3, `select has_function_privilege('anon', '${SIGS.start}', 'execute') a,
                                              has_function_privilege('anon', '${SIGS.force}', 'execute') f,
                                              has_function_privilege('anon', '${SIGS.join}', 'execute') j`);
      expect(startPriv).toEqual([{ a: true, f: false, j: false }]);
    });

    describe("migration preconditions (abort, nothing changes)", () => {
      const cases: [string, string, RegExp][] = [
        ["drifted start_game body", `create or replace function public.start_game() returns boolean language plpgsql security definer set search_path = public as $$ begin return false; end $$;`, /start_game\(\) body md5 is/],
        ["drifted join_game_participant body", `create or replace function public.join_game_participant(p_uid uuid, p_nickname text, p_device_hash text, p_session_id uuid) returns void language plpgsql security definer set search_path = public as $$ begin end $$;`, /join_game_participant\(uuid,text,text,uuid\) body md5 is/],
        ["round in progress (strategy)", `update game_state set phase = 'strategy'`, /phase is strategy, expected waiting or ended/],
        ["round in progress (game)", `update game_state set phase = 'game'`, /phase is game/],
        ["admin_update_schedule already there", `create function public.admin_update_schedule(p int) returns void language sql as $$ select $$;`, /admin_update_schedule already exists/],
        ["column with another shape", `alter table game_state add column participant_join_lead_minutes integer default 10`, /unexpected shape/],
        ["M2 not live", `create or replace function public.admin_reset_game() returns void language plpgsql security definer set search_path = public as $$ begin end $$;`, /admin_reset_game\(\) body md5 is/],
      ];
      for (const [name, setup, err] of cases) {
        it(name, async () => {
          const db = await freshBase();
          await db.exec(setup);
          const before = await md5(db, SIGS.start);
          expect(await run(db, `begin; ${M3} commit;`)).toMatch(err);
          expect(await md5(db, SIGS.start)).toBe(before);
          expect(await md5(db, SIGS.schedule)).toBeNull();
        });
      }
      it("ended is fine; running M3 twice is refused", async () => {
        const db = await freshBase();
        await db.exec("update game_state set phase = 'ended'");
        expect(await run(db, `begin; ${M3} commit;`)).toBe("ok");
        expect(await run(db, `begin; ${M3} commit;`)).toMatch(/body md5 is/);
      });
    });

    describe("rollback (supabase/rollbacks, manual)", () => {
      it("is not in the migrations folder and never touches supabase_migrations", () => {
        expect(FILES.some((f) => f.includes("rollback"))).toBe(false);
        expect(ROLLBACK.replace(/^--.*$/gm, "")).not.toMatch(/supabase_migrations/);
        expect(ROLLBACK).toMatch(/MIGRATION HISTORY WARNING/);
      });
      it("35. restores the pre-M3 bodies (md5) with the same owner / grants / config, drops the RPC, keeps the column; M3 re-applies", async () => {
        const db = await fresh();
        await db.exec("update game_state set participant_join_lead_minutes = 15");
        expect(await run(db, ROLLBACK)).toBe("ok");
        for (const k of ["join", "start", "force"] as const) {
          expect(await md5(db, SIGS[k])).toBe(PRE_MD5[k]);
          expect(await fnMeta(db, SIGS[k])).toEqual(await fnMeta(base, SIGS[k]));
        }
        expect(await md5(db, SIGS.schedule)).toBeNull();
        expect((await gs(db)).participant_join_lead_minutes).toBe(15);
        // The old 60 s clock is back.
        await db.exec("update game_state set scheduled_start_at = null");
        expect(await joinNow(db)).toBe("ok");
        await db.exec("update game_state set strategy_started_at = now() - interval '61 seconds'");
        expect(await startGame(db)).toBe(true);
        // Re-apply after resetting the round.
        await as(db, "service_role", null, "select admin_reset_game()");
        expect(await run(db, `begin; ${M3} commit;`)).toBe("ok");
        expect(await md5(db, SIGS.start)).toBe(M3_MD5.start);
        expect((await gs(db)).participant_join_lead_minutes).toBe(15);
      });
      it("refuses unless M3 is live, and while a round is in progress", async () => {
        const db = await freshBase();
        expect(await run(db, ROLLBACK)).toMatch(/is not the M3 definition/);
        const db2 = await fresh();
        await withParticipant(db2);
        expect(await run(db2, ROLLBACK)).toMatch(/phase is strategy/);
        expect(await md5(db2, SIGS.start)).toBe(M3_MD5.start);
      });
    });
  });
}
