// Runs the REAL SQL of supabase/migrations/20261026100000_reconcile_send_chat_message.sql
// against an in-process Postgres (PGlite), from both starting states it accepts:
//   - the repo state (20260910130000_chat_security.sql + the EXECUTE grants of
//     20260910170000_final_rls_lockdown.sql) — a fresh replay
//   - the production state (production's pg_get_functiondef output, verbatim)
// The tables below are minimal stand-ins with just the columns the function
// touches; auth.uid() reads a test setting.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const MIGRATION = read("supabase/migrations/20261026100000_reconcile_send_chat_message.sql");
const CHAT_SECURITY = read("supabase/migrations/20260910130000_chat_security.sql");
const LOCKDOWN_GRANTS = read("supabase/migrations/20260910170000_final_rls_lockdown.sql")
  .split("\n").filter((l) => /^(revoke|grant) execute on function public\.send_chat_message\(text\)/.test(l)).join("\n");

const PROD_MD5 = "ed95a0d396f5808cf920e464256057ea";
const PROD_MD5_NOCOMMENT = "966fb76fea1cf9dc93fcbd00cb3b10ab";
const REPO_MD5 = "8d3c9d3947c75f38fe564cce76a57190";

// production: pg_get_functiondef('public.send_chat_message(text)'), verbatim.
const PRODUCTION_DEF = `CREATE OR REPLACE FUNCTION public.send_chat_message(p_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_nickname  text;
  v_message   text := trim(p_message);
  v_last_sent timestamptz;
begin
  -- Authentication required.
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  -- Serialize chat sends per auth.uid().
  -- Concurrent calls from the same user cannot bypass rate limiting.
  perform pg_advisory_xact_lock(
    hashtext(v_uid::text)::bigint
  );

  -- Nickname is never trusted from the client.
  select nickname
  into v_nickname
  from public.participants
  where guest_id = v_uid;

  if v_nickname is null then
    raise exception 'must join before chatting';
  end if;

  -- Explicit NULL + blank validation.
  if v_message is null
     or v_message = '' then
    raise exception 'message cannot be empty';
  end if;

  if length(v_message) > 200 then
    raise exception 'message too long';
  end if;

  -- Only actual user chat messages count toward the rate limit.
  -- System messages such as join announcements must not block
  -- the user's first real chat message.
  select max(created_at)
  into v_last_sent
  from public.chat_messages
  where guest_id = v_uid
    and kind = 'chat';

  if v_last_sent is not null
     and now() - v_last_sent < interval '1.5 seconds' then
    raise exception 'sending too fast';
  end if;

  -- Identity, nickname and kind are all decided server-side.
  insert into public.chat_messages (
    guest_id,
    nickname,
    message,
    kind
  )
  values (
    v_uid,
    v_nickname,
    v_message,
    'chat'
  );
end;
$function$;
revoke execute on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to anon, authenticated, service_role;`;

const PLAYER = "11111111-1111-4111-8111-111111111111";
const SPECTATOR = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
  create function auth.jwt() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
  create table participants (guest_id uuid primary key, nickname text not null, role text not null, last_seen timestamptz);
  create table chat_messages (
    id bigint generated always as identity primary key, guest_id uuid, nickname text not null,
    message text not null, kind text not null default 'chat', created_at timestamptz not null default now()
  );
`;

async function freshDb(start: "repo" | "production"): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  if (start === "repo") {
    await db.exec(CHAT_SECURITY);
    await db.exec(LOCKDOWN_GRANTS);
  } else {
    await db.exec(PRODUCTION_DEF);
  }
  await db.exec(`
    insert into participants values ('${PLAYER}', 'player', 'participant', now()), ('${SPECTATOR}', 'watcher', 'spectator', now());
  `);
  return db;
}

async function run(db: PGlite, sql: string): Promise<string> {
  try {
    await db.exec(sql);
    return "ok";
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return (e as Error).message;
  }
}

async function md5s(db: PGlite) {
  return (await db.query<{ ws: string; nc: string; secdef: boolean; cfg: string[]; owner: string }>(`
    select md5(regexp_replace(p.prosrc, '\\s+', '', 'g')) as ws,
           md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '\\s+', '', 'g')) as nc,
           p.prosecdef as secdef, p.proconfig as cfg, pg_get_userbyid(p.proowner) as owner
    from pg_proc p where p.oid = 'public.send_chat_message(text)'::regprocedure`)).rows[0];
}

async function send(db: PGlite, uid: string | null, message: string | null): Promise<string> {
  try {
    await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]);
    await db.query("select send_chat_message($1)", [message]);
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}

const chatRows = async (db: PGlite, uid: string) =>
  (await db.query<{ n: number }>("select count(*)::int as n from chat_messages where guest_id = $1 and kind = 'chat'", [uid])).rows[0].n;

describe("migration file", () => {
  it("embeds production's body verbatim (same normalized and comment-stripped md5)", async () => {
    const start = MIGRATION.indexOf("as $$\n", MIGRATION.indexOf("create or replace function public.send_chat_message")) + "as $$".length;
    const body = MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
    const prodBody = PRODUCTION_DEF.slice(PRODUCTION_DEF.indexOf("$function$") + "$function$".length, PRODUCTION_DEF.lastIndexOf("$function$"));
    expect(body).toBe(prodBody);
  });

  it("changes no data outside the function", () => {
    const outside = MIGRATION.replace(/as \$\$[\s\S]*?\$\$;/, "").replace(/do \$\$[\s\S]*?end \$\$;/g, "");
    expect(outside).not.toMatch(/^\s*(update|insert|delete|truncate)\b/im);
  });
});

describe("reconcile from both accepted starting states", () => {
  for (const start of ["repo", "production"] as const) {
    it(`${start} state -> ${PROD_MD5.slice(0, 8)}…, idempotent on a second run`, async () => {
      const db = await freshDb(start);
      expect((await md5s(db)).ws).toBe(start === "repo" ? REPO_MD5 : PROD_MD5);

      expect(await run(db, MIGRATION)).toBe("ok");
      expect(await md5s(db)).toEqual({ ws: PROD_MD5, nc: PROD_MD5_NOCOMMENT, secdef: true, cfg: ["search_path=public"], owner: "postgres" });

      expect(await run(db, MIGRATION)).toBe("ok");
      expect((await md5s(db)).ws).toBe(PROD_MD5);
    });
  }

  it("unknown body md5 -> refused, function untouched", async () => {
    const db = await freshDb("production");
    await db.exec(`create or replace function public.send_chat_message(p_message text) returns void
      language plpgsql security definer set search_path = public as $$ begin null; end; $$;`);
    const before = (await md5s(db)).ws;
    expect(await run(db, MIGRATION)).toContain(`send_chat_message body md5 is ${before}`);
    expect((await md5s(db)).ws).toBe(before);
  });

  it("production body without SECURITY DEFINER -> refused", async () => {
    const db = await freshDb("production");
    await db.exec("alter function public.send_chat_message(text) security invoker");
    expect(await run(db, MIGRATION)).toContain("not security definer / search_path=public");
  });

  it("an extra overload -> refused", async () => {
    const db = await freshDb("production");
    await db.exec("create function public.send_chat_message(p_message text, p_extra int) returns void language sql as $$ select $$;");
    expect(await run(db, MIGRATION)).toContain("expected exactly one public.send_chat_message(text), found 2");
  });
});

describe("behaviour after reconcile (from the repo state)", async () => {
  const db = await freshDb("repo");
  await db.exec(MIGRATION);

  it("NULL, blank and 201-char messages are refused; 200 chars is fine", async () => {
    expect(await send(db, PLAYER, null)).toBe("message cannot be empty");
    expect(await send(db, PLAYER, "")).toBe("message cannot be empty");
    expect(await send(db, PLAYER, "   ")).toBe("message cannot be empty");
    expect(await send(db, PLAYER, "x".repeat(201))).toBe("message too long");
    expect(await chatRows(db, PLAYER)).toBe(0);
    expect(await send(db, PLAYER, "y".repeat(200))).toBe("ok");
  });

  it("no session -> refused; a user without a participants row -> refused", async () => {
    expect(await send(db, null, "hi")).toBe("authentication required");
    expect(await send(db, STRANGER, "hi")).toBe("must join before chatting");
  });

  it("a system message under the user's guest_id doesn't block their first chat", async () => {
    await db.exec(`delete from chat_messages;
      insert into chat_messages (guest_id, nickname, message, kind) values ('${PLAYER}', 'system', 'player님이 입장했습니다', 'system');`);
    expect(await send(db, PLAYER, "first message")).toBe("ok");
  });

  it("a second chat within 1.5s is refused; after 1.5s it is allowed", async () => {
    expect(await send(db, PLAYER, "too soon")).toBe("sending too fast");
    await db.exec(`update chat_messages set created_at = now() - interval '2 seconds' where guest_id = '${PLAYER}'`);
    expect(await send(db, PLAYER, "later")).toBe("ok");
  });

  it("identity, nickname and kind are decided server-side", async () => {
    const r = (await db.query<{ guest_id: string; nickname: string; kind: string; message: string }>(
      "select guest_id, nickname, kind, message from chat_messages where message = 'later'")).rows[0];
    expect(r).toEqual({ guest_id: PLAYER, nickname: "player", kind: "chat", message: "later" });
  });

  it("a spectator's participants row can chat (production policy: no role condition)", async () => {
    expect(await send(db, SPECTATOR, "watching")).toBe("ok");
  });

  it("takes the per-caller advisory lock hashtext(uid)::bigint for the transaction", async () => {
    await db.exec(`update chat_messages set created_at = now() - interval '1 minute'`);
    await db.exec("begin");
    await db.query("select set_config('test.uid', $1, false)", [PLAYER]);
    await db.query("select send_chat_message('locked')");
    const r = (await db.query<{ held: boolean }>(`
      select exists (
        select 1 from pg_locks l, (select hashtext($1::uuid::text)::bigint as k) key
        where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
          and l.classid::bigint = ((key.k >> 32) & 4294967295) and l.objid::bigint = (key.k & 4294967295) and l.objsubid = 1
      ) as held`, [PLAYER])).rows[0];
    await db.exec("commit");
    expect(r.held).toBe(true);
    const after = (await db.query<{ n: number }>("select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()")).rows[0];
    expect(after.n).toBe(0);
  });

  it("EXECUTE: no direct PUBLIC grant; anon, authenticated, service_role can execute", async () => {
    const r = (await db.query<{ pub: boolean; anon: boolean; auth: boolean; svc: boolean }>(`
      select exists (select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                     where p.oid = 'public.send_chat_message(text)'::regprocedure and x.grantee = 0) as pub,
             has_function_privilege('anon', 'public.send_chat_message(text)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.send_chat_message(text)', 'execute') as auth,
             has_function_privilege('service_role', 'public.send_chat_message(text)', 'execute') as svc`)).rows[0];
    expect(r).toEqual({ pub: false, anon: true, auth: true, svc: true });
  });
});

describe("the repo version this replaces (documents the fixed bugs)", async () => {
  const db = await freshDb("repo");

  it("blocked the first chat right after a system message under the same guest_id", async () => {
    await db.exec(`insert into chat_messages (guest_id, nickname, message, kind) values ('${PLAYER}', 'system', 'joined', 'system');`);
    expect(await send(db, PLAYER, "first message")).toBe("sending too fast");
  });

  it("let a NULL message past its own checks (only the table's NOT NULL stopped it)", async () => {
    await db.exec("delete from chat_messages");
    expect(await send(db, PLAYER, null)).toContain('null value in column "message"');
  });
});
