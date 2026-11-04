import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PAYMENT_CONFIG_ERROR } from "../../../lib/paymentCodes";
import { resolveTossServerConfig } from "../../../lib/tossEnv";
import { recheckReconciliation, refuse, RESPONSE_UNAVAILABLE, type AuctionWin } from "../../../lib/paymentSettle";

// "결제 상태 확인" on /mypage, for the signed-in user's own
// reconciliation_required payment_attempts rows (the browser has no access
// to payment_attempts at all; every read here is the service-role client,
// always filtered by the verified user's id).
//
//   GET   the user's reconciliation_required attempts: order id, product,
//         amount, last check — never the paymentKey or any Toss data.
//   POST  { orderId } — re-check that one attempt with Toss: a lookup of
//         the attempt's OWN paymentKey judged against its own orderId /
//         amount / win (recheckReconciliation, app/lib/paymentSettle.ts).
//         Nothing about the payment is taken from the request: no new
//         confirm, no new Idempotency-Key, no new attempt.
//
// Answers only { ok, status, code?, error? } — status is the attempt's
// status after the check ("paid" / "failed" / "reconciliation_required").

// The Toss lookup has a 10 s timeout (app/lib/tossClient.ts).
export const maxDuration = 30;

const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

type Verified = { ok: true; userId: string } | { ok: false; res: NextResponse };

async function verifyUser(req: NextRequest): Promise<Verified> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { ok: false, res: NextResponse.json({ ok: false, error: "인증이 필요합니다" }, { status: 401 }) };
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user || user.is_anonymous) {
    return { ok: false, res: NextResponse.json({ ok: false, error: "유효하지 않은 인증 정보입니다" }, { status: 401 }) };
  }
  return { ok: true, userId: user.id };
}

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: NextRequest) {
  const v = await verifyUser(req);
  if (!v.ok) return v.res;
  const db = admin();
  const { data, error } = await db
    .from("payment_attempts")
    .select("order_id, win_id, amount, created_at, last_checked_at")
    .eq("user_id", v.userId)
    .eq("status", "reconciliation_required")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[payment/recheck] payment_attempts lookup failed", { error });
    return RESPONSE_UNAVAILABLE();
  }
  const rows = (data ?? []) as { order_id: string; win_id: string | null; amount: number; created_at: string | null; last_checked_at: string | null }[];
  const winIds = [...new Set(rows.map((r) => r.win_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (winIds.length > 0) {
    const { data: wins } = await db.from("auction_wins").select("id, product_name").in("id", winIds);
    for (const w of (wins ?? []) as { id: string; product_name: string }[]) names.set(w.id, w.product_name);
  }
  return NextResponse.json({
    ok: true,
    items: rows.map((r) => ({
      orderId: r.order_id,
      productName: (r.win_id && names.get(r.win_id)) || null,
      amount: r.amount,
      createdAt: r.created_at ?? null,
      lastCheckedAt: r.last_checked_at ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const toss = resolveTossServerConfig();
  if (!toss.ok) {
    console.error("[payment/recheck] Toss key configuration refused — no lookup", { reason: toss.reason, vercelEnv: toss.vercelEnv });
    return refuse(PAYMENT_CONFIG_ERROR, 503);
  }
  const v = await verifyUser(req);
  if (!v.ok) return v.res;

  let orderId: unknown;
  try {
    orderId = ((await req.json()) as { orderId?: unknown })?.orderId;
  } catch {
    orderId = undefined;
  }
  if (typeof orderId !== "string" || !ORDER_ID_RE.test(orderId)) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다" }, { status: 400 });
  }

  const db = admin();
  // Ownership is part of the lookup: another user's order_id finds nothing.
  const { data: att, error: attError } = await db
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .eq("user_id", v.userId)
    .maybeSingle();
  if (attError) {
    console.error("[payment/recheck] payment_attempts lookup failed", { orderId, error: attError });
    return RESPONSE_UNAVAILABLE();
  }
  if (!att) return NextResponse.json({ ok: false, error: "결제 내역을 찾을 수 없습니다" }, { status: 404 });
  // Already settled (another tab, the confirm route, an operator): report
  // it, no Toss call.
  if (att.status !== "reconciliation_required") {
    return NextResponse.json({ ok: true, status: att.status });
  }

  const { data: win, error: winError } = att.win_id
    ? await db.from("auction_wins")
      .select("id, winner_id, product_name, winning_price, claimed_at, payment_deadline")
      .eq("id", att.win_id)
      .maybeSingle()
    : { data: null, error: null };
  if (winError) {
    console.error("[payment/recheck] auction_wins lookup failed", { orderId, error: winError });
    return RESPONSE_UNAVAILABLE();
  }

  const res = await recheckReconciliation(db, toss.secretKey, att, win as AuctionWin | null, v.userId);
  const body = (await res.json().catch(() => ({}))) as { code?: unknown; error?: unknown };

  // The attempt's status as the DB now has it — that, not the shape of the
  // re-check's answer, is what the page shows.
  const { data: after, error: afterError } = await db
    .from("payment_attempts")
    .select("status")
    .eq("order_id", orderId)
    .eq("user_id", v.userId)
    .maybeSingle();
  if (afterError || !after) {
    console.error("[payment/recheck] could not read the attempt back", { orderId, error: afterError });
    return RESPONSE_UNAVAILABLE();
  }
  return NextResponse.json({
    ok: true,
    status: after.status,
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(typeof body.error === "string" ? { error: body.error } : {}),
  });
}
