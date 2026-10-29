import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";
import { validateDropZones } from "../../../lib/dropZones";
import { isValidJoinLeadMinutes, MAX_JOIN_LEAD_MINUTES, MIN_JOIN_LEAD_MINUTES } from "../../../lib/auctionSchedule";

// Mirrors the field->column mapping that used to live in
// GameContext.tsx's updateConfig() (removed — see that file). Only these
// exact keys are ever read from the request body; nothing here passes an
// arbitrary client-supplied object straight into `.update()`, so a caller
// can't target a column outside this fixed list.
interface ConfigBody {
  productName?: string;
  startPrice?: number;
  dropAmount?: number;
  floorPrice?: number;
  gameStartTime?: string | null;
  joinLeadMinutes?: number;
  fastDropPrice?: number | null;
  fastDropAmount?: number | null;
  finalDropPrice?: number | null;
  finalDropAmount?: number | null;
  dropIntervalSeconds?: number;
  fastDropIntervalSeconds?: number;
  finalDropIntervalSeconds?: number;
  operatorNickname?: string;
  operatorMessages?: { threshold: number; message: string }[];
}

// Inputs of the round's price / win record (claim_winner() reads them
// live): only changeable while phase = 'waiting'. The first participant
// join (waiting -> strategy) freezes them for the round — participants
// joined on these terms — and they stay frozen even if every participant
// leaves; changing them takes an admin reset (new round). The phase check
// is part of the UPDATE itself (see below), so the DB decides atomically —
// no read-then-write window.
const ROUND_COLUMNS = [
  "product_name", "start_price", "drop_amount", "minimum_price",
  "fast_drop_price", "fast_drop_amount", "final_drop_price", "final_drop_amount",
  "drop_interval_seconds", "fast_drop_interval_seconds", "final_drop_interval_seconds",
] as const;
const EDITABLE_PHASES = ["waiting"];

const SCHEDULE_ERRORS: Record<string, { status: number; code: string; error: string }> = {
  "schedule_locked:not_waiting": {
    status: 409, code: "SCHEDULE_LOCKED",
    error: "참가자가 입장했거나 경매가 진행/종료된 뒤에는 경매 시작 시각과 참가 가능 시간을 바꿀 수 없습니다. 리셋 후 다시 설정해주세요.",
  },
  "schedule_invalid:start_too_soon": {
    status: 400, code: "SCHEDULE_START_TOO_SOON", error: "경매 시작 시각은 지금으로부터 1분 이후여야 합니다.",
  },
  "schedule_invalid:lead_minutes": {
    status: 400, code: "SCHEDULE_INVALID_LEAD",
    error: `참가 가능 시작은 경매 시작 ${MIN_JOIN_LEAD_MINUTES}~${MAX_JOIN_LEAD_MINUTES}분 전이어야 합니다.`,
  },
};

const sameMinute = (a: number | null, b: number | null) =>
  a === b || (a !== null && b !== null && Math.floor(a / 60_000) === Math.floor(b / 60_000));

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return typeof a !== typeof b && Number(a) === Number(b); // a numeric column may come back as a string
}

export async function POST(req: NextRequest) {
  if (!(await requireAdminSession(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body: ConfigBody = await req.json();
  const admin = getSupabaseAdmin();

  const updates: Record<string, unknown> = {};
  if (body.productName      !== undefined) updates.product_name      = body.productName;
  if (body.startPrice       !== undefined) updates.start_price       = body.startPrice;
  if (body.dropAmount       !== undefined) updates.drop_amount       = body.dropAmount;
  if (body.floorPrice       !== undefined) updates.minimum_price     = body.floorPrice;
  if (body.fastDropPrice    !== undefined) updates.fast_drop_price    = body.fastDropPrice;
  if (body.fastDropAmount   !== undefined) updates.fast_drop_amount   = body.fastDropAmount;
  if (body.finalDropPrice   !== undefined) updates.final_drop_price   = body.finalDropPrice;
  if (body.finalDropAmount  !== undefined) updates.final_drop_amount  = body.finalDropAmount;
  if (body.dropIntervalSeconds      !== undefined) updates.drop_interval_seconds       = body.dropIntervalSeconds;
  if (body.fastDropIntervalSeconds  !== undefined) updates.fast_drop_interval_seconds  = body.fastDropIntervalSeconds;
  if (body.finalDropIntervalSeconds !== undefined) updates.final_drop_interval_seconds = body.finalDropIntervalSeconds;
  if (body.operatorNickname !== undefined) updates.operator_nickname = body.operatorNickname;
  if (body.operatorMessages !== undefined) updates.operator_messages = body.operatorMessages;

  for (const [label, value] of [
    ["NORMAL", body.dropIntervalSeconds],
    ["FAST DROP", body.fastDropIntervalSeconds],
    ["FINAL DROP", body.finalDropIntervalSeconds],
  ] as const) {
    if (value !== undefined && value <= 0) {
      return NextResponse.json({ ok: false, error: `${label} 하락 주기는 0보다 커야 합니다` }, { status: 400 });
    }
  }

  // Schedule (T = scheduled_start_at, N = participant_join_lead_minutes):
  // shape checks here, the real rules in admin_update_schedule() (DB time,
  // phase lock, 1..180 — also a CHECK on the column).
  let startMs: number | null | undefined;
  if (body.gameStartTime !== undefined) {
    if (body.gameStartTime === null || body.gameStartTime === "") startMs = null;
    else if (typeof body.gameStartTime === "string" && Number.isFinite(Date.parse(body.gameStartTime))) startMs = Date.parse(body.gameStartTime);
    else return NextResponse.json({ ok: false, error: "경매 시작 시각 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (body.joinLeadMinutes !== undefined && !isValidJoinLeadMinutes(body.joinLeadMinutes)) {
    return NextResponse.json({ ok: false, ...SCHEDULE_ERRORS["schedule_invalid:lead_minutes"] }, { status: 400 });
  }

  // Re-validate drop zones server-side — closes the gap where a raw REST
  // call (bypassing the admin UI's own client-side validateDropZones()
  // check) could previously write an invalid zone combination directly.
  // Fields not present in this request fall back to the current DB row so
  // a partial update is validated against the config it would actually
  // produce, same as the old client-side behavior did against local state.
  const { data: current, error: readError } = await admin
    .from("game_state")
    .select(`${ROUND_COLUMNS.join(", ")}, operator_nickname, operator_messages, scheduled_start_at, participant_join_lead_minutes`)
    .eq("id", 1)
    .single();
  if (readError || !current) {
    return NextResponse.json({ ok: false, error: "게임 상태를 읽을 수 없습니다" }, { status: 500 });
  }
  const cur = current as unknown as Record<string, unknown>;

  const zoneError = validateDropZones({
    startPrice:      body.startPrice      ?? (cur.start_price as number),
    floorPrice:      body.floorPrice      ?? (cur.minimum_price as number),
    fastDropPrice:   body.fastDropPrice   !== undefined ? body.fastDropPrice   : (cur.fast_drop_price as number | null),
    fastDropAmount:  body.fastDropAmount  !== undefined ? body.fastDropAmount  : (cur.fast_drop_amount as number | null),
    finalDropPrice:  body.finalDropPrice  !== undefined ? body.finalDropPrice  : (cur.final_drop_price as number | null),
    finalDropAmount: body.finalDropAmount !== undefined ? body.finalDropAmount : (cur.final_drop_amount as number | null),
  });
  if (zoneError) {
    return NextResponse.json({ ok: false, error: zoneError }, { status: 400 });
  }

  // 1. Schedule first (the strictest rule: waiting only), and only when it
  //    actually changes — T compared to the minute, the precision the admin
  //    form edits it at. A refusal here leaves everything unwritten.
  const curStartMs = cur.scheduled_start_at ? Date.parse(cur.scheduled_start_at as string) : null;
  const curLead = cur.participant_join_lead_minutes as number;
  const newStartMs = startMs === undefined ? curStartMs : startMs;
  const newLead = body.joinLeadMinutes ?? curLead;
  if (!sameMinute(newStartMs, curStartMs) || newLead !== curLead) {
    const { error } = await admin.rpc("admin_update_schedule", {
      p_start: newStartMs === null ? null : new Date(newStartMs).toISOString(),
      p_lead_minutes: newLead,
    });
    if (error) {
      const known = SCHEDULE_ERRORS[error.message];
      if (known) return NextResponse.json({ ok: false, code: known.code, error: known.error }, { status: known.status });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  // 2. Everything else, as changes only (the form re-sends every field).
  //    Any change to a round input makes it one conditional UPDATE:
  //    ... where id = 1 and phase in ('waiting') — 0 rows means participants
  //    are in, or the auction is running or over, and nothing is written.
  const changes = Object.fromEntries(Object.entries(updates).filter(([col, v]) => !sameValue(v, cur[col])));
  if (Object.keys(changes).length === 0) return NextResponse.json({ ok: true });

  const touchesRound = Object.keys(changes).some((c) => (ROUND_COLUMNS as readonly string[]).includes(c));
  if (touchesRound) {
    const { data, error } = await admin.from("game_state").update(changes).eq("id", 1).in("phase", EDITABLE_PHASES).select("id");
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { ok: false, code: "CONFIG_LOCKED", error: "참가자가 입장한 뒤(또는 경매 진행/종료 후)에는 상품·가격·하락 설정을 바꿀 수 없습니다. 리셋 후 변경해주세요." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin.from("game_state").update(changes).eq("id", 1);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
