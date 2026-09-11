import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, isSameOrigin, getSupabaseAdmin } from "../../../lib/adminAuth";
import { validateDropZones } from "../../../lib/dropZones";

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
  strategyDuration?: number;
  gameStartTime?: string | null;
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
  if (body.strategyDuration !== undefined) updates.strategy_duration = body.strategyDuration;
  if (body.gameStartTime    !== undefined) updates.scheduled_start_at = body.gameStartTime || null;
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

  // Re-validate drop zones server-side — closes the gap where a raw REST
  // call (bypassing the admin UI's own client-side validateDropZones()
  // check) could previously write an invalid zone combination directly.
  // Fields not present in this request fall back to the current DB row so
  // a partial update is validated against the config it would actually
  // produce, same as the old client-side behavior did against local state.
  const { data: current, error: readError } = await admin
    .from("game_state")
    .select("start_price, minimum_price, fast_drop_price, fast_drop_amount, final_drop_price, final_drop_amount")
    .eq("id", 1)
    .single();
  if (readError || !current) {
    return NextResponse.json({ ok: false, error: "게임 상태를 읽을 수 없습니다" }, { status: 500 });
  }

  const zoneError = validateDropZones({
    startPrice:      body.startPrice      ?? (current.start_price as number),
    floorPrice:      body.floorPrice      ?? (current.minimum_price as number),
    fastDropPrice:   body.fastDropPrice   !== undefined ? body.fastDropPrice   : (current.fast_drop_price as number | null),
    fastDropAmount:  body.fastDropAmount  !== undefined ? body.fastDropAmount  : (current.fast_drop_amount as number | null),
    finalDropPrice:  body.finalDropPrice  !== undefined ? body.finalDropPrice  : (current.final_drop_price as number | null),
    finalDropAmount: body.finalDropAmount !== undefined ? body.finalDropAmount : (current.final_drop_amount as number | null),
  });
  if (zoneError) {
    return NextResponse.json({ ok: false, error: zoneError }, { status: 400 });
  }

  const { error } = await admin.from("game_state").update(updates).eq("id", 1);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
