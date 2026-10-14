// Runs the REAL migration SQL (supabase/migrations/20261014100000_one_session_per_account_round.sql)
// on PGlite, on top of the base function definitions it replaces, loaded
// verbatim from the repo migrations they come from (the migration's own
// precondition proves they hash the same as production's). The reset is the
// real 20261008100000 migration too. Tables are minimal stand-ins with the
// columns these functions touch — not the production schema.
//
// auth.uid()/auth.jwt() read request.jwt.claims like Supabase's; a "session"
// below is just the session_id claim set for that call.
//
// PGlite is a single connection, so concurrent calls run one after another:
// the race tests check the serialized outcomes, and the atomicity itself
// comes from the per-user advisory lock + game_state FOR UPDATE + the
// (round_key, user_id) primary key.
import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(pathJoin(__dirname, "../supabase/migrations", f), "utf8");
const MIGRATION = read("20261014100000_one_session_per_account_round.sql");
const RESET_MIGRATION = read("20261008100000_block_reset_of_payable_win.sql");

// The last `create or replace function public.<name>(...) ... $$;` in a file.
function baseFunction(file: string, name: string): string {
  const src = read(file);
  const start = src.lastIndexOf(`create or replace function public.${name}(`);
  const open = src.indexOf("$$", start);
  const close = src.indexOf("$$", open + 2);
  return src.slice(start, close + 3);
}
const BASE_CLAIM_WINNER = baseFunction("20260917100000_fail_closed_pause.sql", "claim_winner");
const BASE_JOIN_GAME = baseFunction("20260921100000_anti_multi_account.sql", "join_game");
const BASE_JOIN_PARTICIPANT = baseFunction("20260921100000_anti_multi_account.sql", "join_game_participant");

const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create function auth.jwt() returns jsonb language sql stable as
    $f$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $f$;
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(auth.jwt() ->> 'sub', '')::uuid $f$;

  create table game_state (
    id int primary key, phase text, strategy_started_at timestamptz, game_started_at timestamptz,
    winner_id uuid, winner_nickname text, winner_price int, winner_claimed_at timestamptz,
    is_paused boolean not null default false, paused_at timestamptz, paused_total_ms bigint not null default 0, pause_reason text,
    round_key uuid not null default gen_random_uuid(), scheduled_start_at timestamptz, operator_nickname text,
    start_price int, minimum_price int, drop_amount int, fast_drop_price int, fast_drop_amount int,
    final_drop_price int, final_drop_amount int, drop_interval_seconds numeric,
    fast_drop_interval_seconds numeric, final_drop_interval_seconds numeric
  );
  create table participants (guest_id uuid primary key, nickname text not null, role text not null, last_seen timestamptz);
  create table chat_messages (id serial primary key, guest_id uuid, nickname text, message text, kind text);
  create table participant_verifications (guest_id uuid primary key, verified_at timestamptz not null);
  create table device_round_guard (
    round_key uuid not null, device_hash text not null, guest_id uuid not null,
    created_at timestamptz not null default now(), primary key (round_key, device_hash)
  );
  create table service_health (service_name text primary key, lease_until timestamptz);
  create table payment_attempts (
    order_id text primary key, user_id uuid, winner_id uuid not null, amount int not null,
    payment_key text, status text not null, win_claimed_at timestamptz, created_at timestamptz not null default now()
  );
  create table orders (order_id text, winner_id uuid, amount int, created_at timestamptz not null default now());
  -- Price calc stand-in: claim_winner()'s price isn't under test here.
  create function calc_drop_price(numeric, numeric, numeric, numeric, numeric, numeric,
                                  numeric, numeric, numeric, numeric, numeric)
    returns integer language sql as $f$ select $2::integer $f$;
`;

async function loadBase(db: PGlite) {
  await db.exec(SCHEMA);
  await db.exec(BASE_CLAIM_WINNER);
  await db.exec(BASE_JOIN_GAME);
  await db.exec(BASE_JOIN_PARTICIPANT);
  await db.exec(`
    revoke all on function public.join_game_participant(uuid, text, text) from public, anon, authenticated;
    grant execute on function public.join_game_participant(uuid, text, text) to service_role;
  `);
}

const A = "aaaaaaaa-0000-4000-8000-000000000001"; // the account on two devices
const C = "cccccccc-0000-4000-8000-000000000003"; // another account
const ANON = "dddddddd-0000-4000-8000-000000000004";
const S_A1 = "a1a1a1a1-1111-4111-8111-111111111111"; // account A, device 1
const S_A2 = "a2a2a2a2-2222-4222-8222-222222222222"; // account A, device 2
const S_C = "c3c3c3c3-3333-4333-8333-333333333333";
const S_ANON = "d4d4d4d4-4444-4444-8444-444444444444";

let db: PGlite;

async function as(role: "authenticated" | "anon" | "service_role", claims: Record<string, unknown> | null, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims ? JSON.stringify(claims) : ""]);
  await db.exec(`set role ${role}`);
  try {
    return await db.query<Record<string, unknown>>(sql, params);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return (e as Error).message; }
}

// /api/join/participant -> join_game_participant() as service_role.
const join = (uid: string, session: string | null, device = `dev-${uid}`, nickname = `nick-${uid.slice(0, 4)}`) =>
  as("service_role", null, "select join_game_participant($1, $2, $3, $4)", [uid, nickname, device, session]);

const claim = async (uid: string, session: string | undefined) =>
  (await as("authenticated", { sub: uid, role: "authenticated", ...(session ? { session_id: session } : {}) },
    "select claim_winner() as won")).rows[0].won as boolean;

const touch = async (uid: string, session: string) =>
  (await as("authenticated", { sub: uid, role: "authenticated", session_id: session },
    "select touch_participant_session() as ok")).rows[0].ok as boolean;

const spectate = (uid: string, session: string, nickname = "watcher") =>
  as("authenticated", { sub: uid, role: "authenticated", session_id: session },
    "select join_game('spectator', $1)", [nickname]);

async function guard(uid: string) {
  return (await db.query<{ session_id: string; takeover_count: number; last_seen_at: string }>(
    `select g.session_id, g.takeover_count, g.last_seen_at from account_round_guard g
     join game_state gs on gs.id = 1 and gs.round_key = g.round_key where g.user_id = $1`, [uid])).rows;
}

async function participant(uid: string) {
  return (await db.query<{ role: string; nickname: string }>("select role, nickname from participants where guest_id = $1", [uid])).rows[0];
}

async function staleLease(uid: string, seconds: number) {
  await db.query("update account_round_guard set last_seen_at = now() - make_interval(secs => $2) where user_id = $1", [uid, seconds]);
}

async function setPhase(phase: string) {
  await db.query(
    `update game_state set phase = $1,
       game_started_at = case when $1 in ('game', 'ended') then now() - interval '10 seconds' end
     where id = 1`, [phase]);
}

beforeAll(async () => {
  db = new PGlite();
  await loadBase(db);
  await db.exec(RESET_MIGRATION);
  await db.exec(MIGRATION);
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    delete from account_round_guard; delete from device_round_guard; delete from participants;
    delete from chat_messages; delete from participant_verifications; delete from payment_attempts; delete from orders;
    delete from service_health; delete from game_state; delete from auth.users;
    insert into auth.users (id, is_anonymous) values ('${A}', false), ('${C}', false), ('${ANON}', true);
    insert into participant_verifications values ('${A}', now()), ('${C}', now());
    insert into service_health values ('auction_api', now() + interval '1 minute');
    insert into game_state (id, phase, operator_nickname, start_price, minimum_price) values (1, 'waiting', 'operator', 500000, 100000);
  `);
});

describe("same account, same session", () => {
  it("re-joining (reload / another tab / browser restart) keeps the slot and can still win", async () => {
    await join(A, S_A1);
    await join(A, S_A1);
    await join(A, S_A1);
    expect(await guard(A)).toMatchObject([{ session_id: S_A1, takeover_count: 0 }]);
    await setPhase("game");
    expect(await claim(A, S_A1)).toBe(true);
  });
});

describe("same account, second session (device B)", () => {
  it("is refused while A's lease is live, and nothing of A's changes", async () => {
    await join(A, S_A1, "dev-1", "alice");
    expect(await errorOf(join(A, S_A2, "dev-2", "alice-b"))).toBe("account active on another session");
    expect(await guard(A)).toMatchObject([{ session_id: S_A1, takeover_count: 0 }]);
    expect(await participant(A)).toEqual({ role: "participant", nickname: "alice" });
  });

  it("is still refused at 89s of silence", async () => {
    await join(A, S_A1);
    await staleLease(A, 89);
    expect(await errorOf(join(A, S_A2, "dev-2"))).toBe("account active on another session");
  });

  it("takes over in strategy once A has been silent 90s+; then only B can win", async () => {
    await join(A, S_A1, "dev-1");
    expect((await db.query<{ phase: string }>("select phase from game_state")).rows[0].phase).toBe("strategy");
    await staleLease(A, 91);
    await join(A, S_A2, "dev-2");
    expect(await guard(A)).toMatchObject([{ session_id: S_A2, takeover_count: 1 }]);

    expect(await touch(A, S_A1)).toBe(false); // A can't renew a lease it no longer holds
    await setPhase("game");
    expect(await claim(A, S_A1)).toBe(false);
    expect(await claim(A, S_A2)).toBe(true);
  });

  it("takes over in waiting too", async () => {
    await join(A, S_A1, "dev-1");
    await db.query("update game_state set phase = 'waiting', strategy_started_at = null");
    await staleLease(A, 120);
    await join(A, S_A2, "dev-2");
    expect(await guard(A)).toMatchObject([{ session_id: S_A2, takeover_count: 1 }]);
  });

  it("can't take over during game or ended, even with A long gone", async () => {
    await join(A, S_A1, "dev-1");
    await staleLease(A, 600);
    for (const phase of ["game", "ended"]) {
      await setPhase(phase);
      expect(await errorOf(join(A, S_A2, "dev-2"))).toBe("participant join closed");
      expect(await guard(A)).toMatchObject([{ session_id: S_A1, takeover_count: 0 }]);
    }
  });

  it("calling claim_winner() directly from B returns false and changes nothing", async () => {
    await join(A, S_A1);
    await setPhase("game");
    expect(await claim(A, S_A2)).toBe(false);
    expect(await claim(A, undefined)).toBe(false); // no session claim at all
    const gs = (await db.query<{ winner_id: string | null; phase: string; is_paused: boolean }>(
      "select winner_id, phase, is_paused from game_state")).rows[0];
    expect(gs).toEqual({ winner_id: null, phase: "game", is_paused: false });
    expect((await db.query("select 1 from chat_messages where message like '%낙찰%'")).rows).toHaveLength(0);
  });

  it("A and B claiming at once: only the holder session can win, in either order", async () => {
    await join(A, S_A1);
    await setPhase("game");
    expect(await claim(A, S_A2)).toBe(false);
    expect(await claim(A, S_A1)).toBe(true);
    expect((await db.query<{ winner_id: string }>("select winner_id from game_state")).rows[0].winner_id).toBe(A);
    expect(await claim(A, S_A2)).toBe(false);
  });

  it("A and B joining at once: exactly one holder, and the key can't hold two", async () => {
    const results = await Promise.allSettled([join(A, S_A1, "dev-1"), join(A, S_A2, "dev-2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await guard(A)).toHaveLength(1);
    const err = await errorOf(db.query(
      "insert into account_round_guard (round_key, user_id, session_id) select round_key, $1, $2 from game_state",
      [A, S_A2]));
    expect(err).toMatch(/duplicate key/);
  });
});

describe("heartbeat: touch_participant_session()", () => {
  it("renews only the holder's lease", async () => {
    await join(A, S_A1);
    await staleLease(A, 60);
    expect(await touch(A, S_A2)).toBe(false);
    const stale = (await guard(A))[0].last_seen_at;
    expect(await touch(A, S_A1)).toBe(true);
    expect(new Date((await guard(A))[0].last_seen_at).getTime()).toBeGreaterThan(new Date(stale).getTime());
  });

  it("a renewed lease keeps B out past the original 90s", async () => {
    await join(A, S_A1);
    await staleLease(A, 200);
    expect(await touch(A, S_A1)).toBe(true);
    expect(await errorOf(join(A, S_A2, "dev-2"))).toBe("account active on another session");
  });
});

describe("spectators", () => {
  it("B entering as spectator doesn't touch A's participant row, slot or win", async () => {
    await join(A, S_A1, "dev-1", "alice");
    const chatBefore = (await db.query("select 1 from chat_messages")).rows.length;
    await spectate(A, S_A2, "alice-watch");
    expect(await participant(A)).toEqual({ role: "participant", nickname: "alice" });
    expect(await guard(A)).toMatchObject([{ session_id: S_A1 }]);
    expect((await db.query("select 1 from chat_messages")).rows.length).toBe(chatBefore);
    await setPhase("game");
    expect(await claim(A, S_A1)).toBe(true);
  });

  it("the holder session itself can still switch to spectator (unchanged behaviour)", async () => {
    await join(A, S_A1, "dev-1", "alice");
    await spectate(A, S_A1, "alice");
    expect((await participant(A)).role).toBe("spectator");
  });

  it("anonymous spectators join as before", async () => {
    await spectate(ANON, S_ANON, "guest");
    expect(await participant(ANON)).toEqual({ role: "spectator", nickname: "guest" });
    expect((await db.query("select 1 from chat_messages where message like '%관전자로 입장%'")).rows).toHaveLength(1);
  });

  it("anonymous accounts still can't become participants", async () => {
    await db.query("insert into participant_verifications values ($1, now())", [ANON]);
    expect(await errorOf(join(ANON, S_ANON))).toBe("participant role requires a signed-in account");
  });
});

describe("participant join phase gate (server-side)", () => {
  it("allows waiting and strategy", async () => {
    await join(A, S_A1);
    expect((await db.query<{ phase: string }>("select phase from game_state")).rows[0].phase).toBe("strategy");
    await join(C, S_C);
    expect((await participant(C)).role).toBe("participant");
  });

  it("refuses a direct join during game and after it ended", async () => {
    for (const phase of ["game", "ended"]) {
      await setPhase(phase);
      expect(await errorOf(join(C, S_C))).toBe("participant join closed");
      expect(await participant(C)).toBeUndefined();
      expect(await guard(C)).toHaveLength(0);
    }
  });

  it("refuses once scheduled_start_at has passed (server now()), allows before it", async () => {
    await db.query("update game_state set scheduled_start_at = now() + interval '5 minutes'");
    await join(A, S_A1);
    await db.query("update game_state set scheduled_start_at = now() - interval '1 second'");
    expect(await errorOf(join(C, S_C))).toBe("participant join closed");
  });

  it("requires a session id", async () => {
    expect(await errorOf(join(A, null))).toBe("session check required");
  });
});

describe("device_round_guard is unchanged and independent", () => {
  it("another account on the same device is still refused", async () => {
    await join(A, S_A1, "shared-device");
    expect(await errorOf(join(C, S_C, "shared-device"))).toBe("this device already joined as a participant this round");
  });

  it("another account on another device joins normally", async () => {
    await join(A, S_A1, "dev-1");
    await join(C, S_C, "dev-2");
    expect((await participant(C)).role).toBe("participant");
    expect(await guard(C)).toMatchObject([{ session_id: S_C }]);
  });
});

describe("reset", () => {
  it("a new round lets any session join again; old-round slots are cleared on join", async () => {
    await join(A, S_A1, "dev-1");
    await db.query("select admin_reset_game()");
    await join(A, S_A2, "dev-2");
    expect(await guard(A)).toMatchObject([{ session_id: S_A2, takeover_count: 0 }]);
    expect((await db.query("select 1 from account_round_guard")).rows).toHaveLength(1);
  });
});

describe("privileges", () => {
  it("clients can't read or write account_round_guard", async () => {
    await join(A, S_A1);
    for (const role of ["anon", "authenticated"] as const) {
      const claims = { sub: A, role, session_id: S_A2 };
      expect(await errorOf(as(role, claims, "select * from account_round_guard"))).toMatch(/permission denied/);
      expect(await errorOf(as(role, claims, `insert into account_round_guard (round_key, user_id, session_id) values (gen_random_uuid(), '${A}', '${S_A2}')`))).toMatch(/permission denied/);
      expect(await errorOf(as(role, claims, `update account_round_guard set session_id = '${S_A2}'`))).toMatch(/permission denied/);
      expect(await errorOf(as(role, claims, "delete from account_round_guard"))).toMatch(/permission denied/);
    }
    expect(await guard(A)).toMatchObject([{ session_id: S_A1 }]);
  });

  it("join_game_participant is service_role-only; touch is authenticated-only", async () => {
    expect(await errorOf(as("authenticated", { sub: A, session_id: S_A1 },
      "select join_game_participant($1, 'x1', 'd', $2)", [A, S_A1]))).toMatch(/permission denied/);
    expect(await errorOf(as("anon", { sub: A, session_id: S_A1 }, "select touch_participant_session()"))).toMatch(/permission denied/);
    expect(await db.query("select to_regprocedure('public.join_game_participant(uuid,text,text)') as f")).toMatchObject({ rows: [{ f: null }] });
  });
});

describe("migration safety", () => {
  const norm = (s: string) => s.replace(/\s+/g, "");

  it("claim_winner: production body plus exactly the session block", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.claim_winner()"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    const block = body.slice(body.indexOf("  if not exists (\n    select 1\n    from account_round_guard g"));
    const sessionBlock = block.slice(0, block.indexOf("end if;\n") + "end if;\n".length);
    expect(sessionBlock).toContain("auth.jwt() ->> 'session_id'");
    expect(norm(body.replace(sessionBlock, ""))).toBe(norm(BASE_CLAIM_WINNER));
  });

  it("join_game: production body plus exactly the non-holder no-op", () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf("create or replace function public.join_game(p_role text"));
    const body = fn.slice(0, fn.indexOf("$$;") + 3);
    const start = body.indexOf("  if v_old_role = 'participant' and exists (");
    const block = body.slice(start, body.indexOf("end if;\n", start) + "end if;\n".length);
    expect(norm(body.replace(block, ""))).toBe(norm(BASE_JOIN_GAME));
  });

  it("join_game_participant keeps the device guard block verbatim", () => {
    const deviceBlock = BASE_JOIN_PARTICIPANT.slice(
      BASE_JOIN_PARTICIPANT.indexOf("  select guest_id into v_existing_uid"),
      BASE_JOIN_PARTICIPANT.indexOf("  select role into v_old_role"),
    );
    expect(deviceBlock).toContain("device_round_guard");
    expect(MIGRATION).toContain(deviceBlock.trimEnd());
    expect(MIGRATION).not.toMatch(/(alter|drop|create)[^;]*device_round_guard/i);
  });

  it("leaves price calc, pause and health-lease code of claim_winner untouched", () => {
    for (const s of ["calc_drop_price(", "if v_row.is_paused then", "pause_reason = 'health_lease_expired'", "for update;"]) {
      expect(MIGRATION).toContain(s);
    }
  });

  it("aborts without changing anything when production's function drifted", async () => {
    const drifted = new PGlite();
    await loadBase(drifted);
    // The PG-side comment-stripping hash matches the one computed for the
    // migration's precondition, so a comment-free production copy also passes.
    const h = (await drifted.query<{ raw: string; nc: string }>(`
      select md5(regexp_replace(prosrc, '\\s+', '', 'g')) as raw,
             md5(regexp_replace(regexp_replace(prosrc, '--[^\\n]*', '', 'g'), '\\s+', '', 'g')) as nc
      from pg_proc where oid = 'public.claim_winner()'::regprocedure`)).rows[0];
    expect(h).toEqual({ raw: "1d9c0a025461ec2c05979cc97c0bc24f", nc: "9013dd21487a3a4ffb85eef835f8b755" });

    await drifted.exec(BASE_CLAIM_WINNER.replace("v_price := calc_drop_price(", "v_price := 1 + calc_drop_price("));
    expect(await errorOf(drifted.exec(MIGRATION))).toMatch(/precondition failed: public.claim_winner\(\) differs/);
    await drifted.exec("rollback");
    expect((await drifted.query("select to_regclass('public.account_round_guard') as t")).rows[0]).toEqual({ t: null });
    expect((await drifted.query<{ f: string | null }>("select to_regprocedure('public.join_game_participant(uuid,text,text)') as f")).rows[0].f).not.toBeNull();
    await drifted.close();
  }, 60_000);

  it("a comment-free production copy passes the precondition", async () => {
    const bare = new PGlite();
    await loadBase(bare);
    await bare.exec(BASE_CLAIM_WINNER.replace(/--[^\n]*/g, ""));
    await bare.exec(BASE_JOIN_PARTICIPANT.replace(/--[^\n]*/g, ""));
    await bare.exec(read("20261008100000_block_reset_of_payable_win.sql"));
    expect(await errorOf(bare.exec(MIGRATION))).toBeNull();
    await bare.close();
  }, 60_000);
});
