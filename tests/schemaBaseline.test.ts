// Replays the WHOLE migration chain (20260901000000_schema_baseline.sql first,
// then every file in supabase/migrations in order) on a fresh in-process
// Postgres (PGlite), twice:
//   - pre1030:  the project's old default ACL (public objects granted to
//               anon/authenticated/service_role on creation) — like Production
//   - post1030: no default grants, like a project created after 2026-10-30
// and checks that both end in Production's current schema. The expected
// values below come from Production's catalog snapshot (inv_00, 2026-10-26).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "supabase", "migrations");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(join(DIR, f), "utf8");

// Minimal stand-in for what a Supabase project provides before any migration.
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

const ALL = "DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE";
const READ = "MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE";
const TABLE_GRANTS: Record<string, Record<string, string>> = {
  account_round_guard: { service_role: ALL },
  admin_login_attempts: { service_role: ALL },
  admin_sessions: { service_role: ALL },
  chat_messages: { anon: READ, authenticated: READ, service_role: ALL },
  device_round_guard: { anon: ALL, authenticated: ALL, service_role: ALL },
  game_state: { anon: READ, authenticated: READ, service_role: ALL },
  orders: { anon: `DELETE,${READ},UPDATE`, authenticated: `DELETE,${READ},UPDATE`, service_role: ALL },
  participant_verifications: { anon: ALL, authenticated: ALL, service_role: ALL },
  participants: { anon: `DELETE,${READ}`, authenticated: `DELETE,${READ}`, service_role: ALL },
  payment_attempts: { service_role: ALL },
  profiles: { anon: ALL, authenticated: ALL, service_role: ALL },
  service_health: { anon: ALL, authenticated: ALL, service_role: ALL },
};

const ALL_ROLES = ["anon", "authenticated", "service_role"];
const FUNCTION_EXECUTE: Record<string, string[]> = {
  "admin_force_start_game()": ["service_role"],
  "admin_login_gate(text)": ["service_role"],
  "admin_login_mark_success(uuid)": ["service_role"],
  "admin_reset_game()": ["service_role"],
  "calc_drop_price(numeric,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,numeric)": ["service_role"],
  "claim_winner()": ALL_ROLES,
  "cleanup_stale_participants()": ALL_ROLES,
  "join_game(text,text)": ALL_ROLES,
  "join_game_participant(uuid,text,text,uuid)": ["service_role"],
  "pause_game(text)": ["service_role"],
  "resume_game()": ["service_role"],
  "send_chat_message(text)": ALL_ROLES,
  "server_now()": ALL_ROLES,
  "start_game()": ALL_ROLES,
  "touch_health_lease()": ["service_role"],
  "touch_participant_session()": ["authenticated", "service_role"],
};

// name | cmd | roles | using | with check
const POLICIES: Record<string, string[]> = {
  chat_messages: [
    "chat_messages_select_all|r|anon,authenticated|true|",
    "delete chat|d|public|true|",
    "insert chat|a|public||true",
    "read chat|r|public|true|",
  ],
  game_state: [
    "game_state_select_all|r|anon,authenticated|true|",
    "read game_state|r|public|true|",
    "update game_state|w|public|true|",
  ],
  orders: ["본인 주문만 조회|r|public|(auth.uid() = user_id)|"],
  participants: [
    "participants_delete_own|d|anon,authenticated|(auth.uid() = guest_id)|",
    "participants_select_all|r|anon,authenticated|true|",
    "participants_update_own|w|anon,authenticated|(auth.uid() = guest_id)|(auth.uid() = guest_id)",
  ],
  profiles: [
    "닉네임 조회|r|public|true|",
    "본인 프로필 등록|a|public||(auth.uid() = id)",
    "본인 프로필 수정|w|public|(auth.uid() = id)|",
  ],
};

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

async function rows<T>(db: PGlite, sql: string): Promise<T[]> {
  return (await db.query<T>(sql)).rows;
}

const tableGrants = (db: PGlite) =>
  rows<{ t: string; grantee: string; privs: string }>(db, `
    select c.relname t, case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end grantee,
           string_agg(x.privilege_type, ',' order by x.privilege_type) privs
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    where n.nspname = 'public' and c.relkind = 'r'
      and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role'))
    group by 1, 2 order by 1, 2`);

const functionExecute = (db: PGlite) =>
  rows<{ sig: string; grantees: string[] }>(db, `
    select p.oid::regprocedure::text sig,
           coalesce((select array_agg(case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end order by 1)
                     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                     where x.privilege_type = 'EXECUTE'
                       and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated', 'service_role'))), '{}') grantees
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by 1`);

const bodyMd5 = async (db: PGlite, name: string) =>
  (await rows<{ h: string }>(db, `
    select md5(regexp_replace(p.prosrc, '\\s+', '', 'g')) h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '${name}'`)).map((r) => r.h);

describe("migration chain order", () => {
  it("starts with the schema baseline and ends with the explicit grants", () => {
    expect(FILES[0]).toBe("20260901000000_schema_baseline.sql");
    expect(FILES[1]).toBe("20260902120000_drop_zones.sql");
    expect(FILES.at(-2)).toBe("20261027100000_drop_orphan_calc_drop_price.sql");
    expect(FILES.at(-1)).toBe("20261027110000_explicit_data_api_grants.sql");
  });

  it("the baseline grants nothing (privileges live in the explicit grants migration)", () => {
    expect(read(FILES[0])).not.toMatch(/^\s*(grant|revoke)\b/im);
  });

  it("the cleanup and grants migrations never revoke", () => {
    expect(read("20261027100000_drop_orphan_calc_drop_price.sql")).not.toMatch(/^\s*revoke\b/im);
    expect(read("20261027110000_explicit_data_api_grants.sql")).not.toMatch(/^\s*revoke\b/im);
  });

  it("20260910170000 removes orders INSERT policies by command, not by name", () => {
    const sql = read("20260910170000_final_rls_lockdown.sql");
    expect(sql).toMatch(/where schemaname = 'public' and tablename = 'orders' and cmd = 'INSERT'/);
    expect(sql).toMatch(/execute format\('drop policy %I on public\.orders', pol\.policyname\)/);
  });
});

for (const env of ["pre1030", "post1030"] as const) {
  describe(`fresh replay (${env})`, () => {
    let db: PGlite;
    const failures: string[] = [];
    let ordersInsertPoliciesBefore1017 = -1;

    beforeAll(async () => {
      db = new PGlite();
      await db.exec(SUPABASE);
      if (env === "pre1030") await db.exec(OLD_DEFAULT_ACL);
      for (const f of FILES) {
        if (f === "20260910170000_final_rls_lockdown.sql") {
          ordersInsertPoliciesBefore1017 = (await rows<{ n: number }>(db,
            "select count(*)::int n from pg_policies where schemaname = 'public' and tablename = 'orders' and cmd = 'INSERT'"))[0].n;
        }
        const r = await run(db, read(f));
        if (r !== "ok") failures.push(`${f}: ${r}`);
      }
    }, 120_000);

    it("every migration succeeds", () => {
      expect(failures).toEqual([]);
    });

    it("has Production's 12 public tables, all with RLS", async () => {
      const t = await rows<{ relname: string; rls: boolean }>(db, `
        select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S') order by 1`);
      expect(t.map((r) => r.relname)).toEqual(Object.keys(TABLE_GRANTS).sort());
      expect(t.every((r) => r.rls)).toBe(true);
    });

    it("has Production's 16 functions with Production's EXECUTE grantees", async () => {
      const f = Object.fromEntries((await functionExecute(db)).map((r) => [r.sig, [...r.grantees].sort()]));
      expect(f).toEqual(FUNCTION_EXECUTE);
    });

    it("leaves only the 11-argument calc_drop_price and the 4-argument join_game_participant", async () => {
      const sigs = (await functionExecute(db)).map((r) => r.sig);
      expect(sigs.filter((s) => s.startsWith("calc_drop_price("))).toEqual([
        "calc_drop_price(numeric,integer,integer,integer,integer,integer,integer,integer,numeric,numeric,numeric)",
      ]);
      expect(sigs.filter((s) => s.startsWith("join_game_participant("))).toEqual(["join_game_participant(uuid,text,text,uuid)"]);
    });

    it("carries Production's send_chat_message and admin_reset_game bodies", async () => {
      expect(await bodyMd5(db, "send_chat_message")).toEqual(["ed95a0d396f5808cf920e464256057ea"]);
      expect(await bodyMd5(db, "admin_reset_game")).toEqual(["aa6bedbe02fd7b8563a87a0aca2f7a42"]);
    });

    it("has Production's table grants (no PUBLIC grants)", async () => {
      const g: Record<string, Record<string, string>> = {};
      for (const r of await tableGrants(db)) (g[r.t] ??= {})[r.grantee] = r.privs;
      expect(g).toEqual(TABLE_GRANTS);
    });

    it("keeps exactly the participants.last_seen column UPDATE grant", async () => {
      const c = await rows<{ t: string; col: string; grantee: string; priv: string }>(db, `
        select c.relname t, a.attname col, pg_get_userbyid(x.grantee) grantee, x.privilege_type priv
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(a.attacl) x
        where n.nspname = 'public' and a.attacl is not null order by 1, 2, 3`);
      expect(c).toEqual([
        { t: "participants", col: "last_seen", grantee: "anon", priv: "UPDATE" },
        { t: "participants", col: "last_seen", grantee: "authenticated", priv: "UPDATE" },
      ]);
    });

    it("has Production's policies; the baseline's orders INSERT policy existed and is gone", async () => {
      expect(ordersInsertPoliciesBefore1017).toBe(1);
      const p = await rows<{ t: string; d: string }>(db, `
        select tablename t, policyname || '|' || case cmd when 'SELECT' then 'r' when 'INSERT' then 'a' when 'UPDATE' then 'w' when 'DELETE' then 'd' else '*' end
               || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') d
        from pg_policies where schemaname = 'public' order by 1, 2`);
      const byTable: Record<string, string[]> = {};
      for (const r of p) (byTable[r.t] ??= []).push(r.d);
      expect(byTable).toEqual(POLICIES);
      expect(p.filter((r) => r.t === "orders" && r.d.split("|")[1] === "a")).toEqual([]);
    });

    it("publishes game_state, participants and chat_messages to Realtime", async () => {
      const t = await rows<{ tablename: string }>(db,
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1");
      expect(t.map((r) => r.tablename)).toEqual(["chat_messages", "game_state", "participants"]);
    });

    it("has exactly one game_state row, in a fresh waiting state", async () => {
      expect(await rows(db, `
        select id, phase, winner_id, is_paused, paused_total_ms::int ms, round_key is not null has_round_key
        from public.game_state`)).toEqual([
        { id: 1, phase: "waiting", winner_id: null, is_paused: false, ms: 0, has_round_key: true },
      ]);
      expect(await run(db, "insert into public.game_state (id) values (2)")).toMatch(/single_row|duplicate key/);
    });

    it("has no public sequences or custom types", async () => {
      expect(await rows(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'public' and c.relkind = 'S'`)).toEqual([]);
      expect(await rows(db, `select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
                             where n.nspname = 'public' and t.typtype in ('e', 'd')`)).toEqual([]);
    });

    it("the baseline refuses to run on a database that already has the schema", async () => {
      const before = await tableGrants(db);
      expect(await run(db, read(FILES[0]))).toContain("schema baseline refused");
      expect(await rows(db, "select count(*)::int n from public.game_state")).toEqual([{ n: 1 }]);
      expect(await tableGrants(db)).toEqual(before);
    });

    it("the cleanup and grants migrations are no-ops when re-run (as on Production)", async () => {
      const before = [await tableGrants(db), await functionExecute(db)];
      expect(await run(db, read("20261027100000_drop_orphan_calc_drop_price.sql"))).toBe("ok");
      expect(await run(db, read("20261027110000_explicit_data_api_grants.sql"))).toBe("ok");
      expect([await tableGrants(db), await functionExecute(db)]).toEqual(before);
    });
  });
}

describe("orphan calc_drop_price cleanup", () => {
  it("refuses to finish if the 11-argument overload is missing", async () => {
    const db = new PGlite();
    await db.exec(`create function public.calc_drop_price(numeric, integer, integer, integer, integer, integer, integer, integer)
                   returns integer language sql as $f$ select 1 $f$;`);
    expect(await run(db, read("20261027100000_drop_orphan_calc_drop_price.sql"))).toContain("11-argument overload is missing");
    expect(await rows(db, "select count(*)::int n from pg_proc where proname = 'calc_drop_price'")).toEqual([{ n: 1 }]);
  }, 60_000);
});
