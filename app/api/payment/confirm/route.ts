import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sandbox fallback only outside production — a missing env var in an
// actual production deploy must fail loudly (every payment rejected with a
// clear 500) rather than silently routing real users' charges through
// Toss's test/sandbox endpoint, which either doesn't move money at all or
// gets rejected by Toss for the production domain — both fail silently
// enough that it could go unnoticed for a while. `next dev`/local
// `next build && next start` still get the sandbox key with no setup.
const TOSS_SECRET_KEY: string | undefined =
  process.env.NODE_ENV === "production"
    ? process.env.TOSS_SECRET_KEY
    : (process.env.TOSS_SECRET_KEY ?? "test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R");

// Never let a paymentKey reach the logs in full — it's an opaque Toss
// token, not a secret in the same class as our own API keys, but there's
// no reason to leave a full copy sitting in whatever log aggregator this
// ends up in either. Masked, not removed — still useful for correlating
// log lines by eye.
function maskPaymentKey(key: string): string {
  if (key.length <= 10) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

// Toss's error object is not something we hand to the client as-is — it's
// meant for our own diagnostics (logged in full server-side, see below).
// The client gets just the message string, which is written to be
// user-displayable, with a safe generic fallback if that shape ever changes.
function safeTossErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string") {
    return (data as { message: string }).message;
  }
  return "결제 확인에 실패했습니다.";
}

export async function POST(req: NextRequest) {
  if (!TOSS_SECRET_KEY) {
    console.error("[payment/confirm] TOSS_SECRET_KEY is not set in production — refusing to process payment");
    return NextResponse.json({ ok: false, error: "결제 시스템이 설정되지 않았습니다. 운영자에게 문의해주세요." }, { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnon  = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { paymentKey, orderId, amount } = await req.json();

  if (!paymentKey || !orderId || !amount) {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }

  // Identity (Phase 3): a Supabase Auth access token is required and is
  // verified against Supabase Auth itself via getUser() — this makes a real
  // request to Auth to check the token, it does not just decode/trust it.
  // Every check below (and every record written) uses this verified user,
  // never a client-supplied id.
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다" }, { status: 401 });
  }
  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "유효하지 않은 인증 정보입니다" }, { status: 401 });
  }

  // Winner + amount: both must match the current DB state before Toss is
  // ever contacted. phase must be 'ended' (claim_winner() only ever sets
  // winner_id atomically together with phase='ended', so this also covers
  // "game isn't in a normal claimed state").
  const { data: gameState } = await supabaseAnon
    .from("game_state")
    .select("phase, winner_id, winner_price")
    .eq("id", 1)
    .single();

  if (!gameState || gameState.phase !== "ended" || !gameState.winner_id || !gameState.winner_price) {
    return NextResponse.json({ ok: false, error: "낙찰 정보를 찾을 수 없습니다" }, { status: 400 });
  }
  if (gameState.winner_id !== user.id) {
    return NextResponse.json({ ok: false, error: "낙찰자 본인만 결제할 수 있습니다" }, { status: 403 });
  }
  if (gameState.winner_price !== amount) {
    return NextResponse.json({ ok: false, error: "결제 금액이 낙찰가와 일치하지 않습니다" }, { status: 400 });
  }

  // Phase 3.6: payment_attempts is the durable, pre-Toss record of this
  // order_id — it exists BEFORE Toss is ever contacted, and is the single
  // source of truth for idempotency (same order_id, same identity/amount/
  // paymentKey => safe replay; anything else about order_id reuse is
  // rejected before Toss is touched).
  const { data: existingAttempt, error: attemptLookupError } = await supabaseAdmin
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();

  if (attemptLookupError) {
    console.error("[payment/confirm] payment_attempts lookup failed", { orderId, error: attemptLookupError });
    return NextResponse.json({ ok: false, error: "결제 확인 중 오류가 발생했습니다" }, { status: 500 });
  }

  if (existingAttempt) {
    const isSameRequest =
      existingAttempt.user_id === user.id &&
      existingAttempt.winner_id === gameState.winner_id &&
      existingAttempt.amount === amount &&
      existingAttempt.payment_key === paymentKey;

    if (!isSameRequest) {
      return NextResponse.json({ ok: false, error: "이미 사용된 주문번호입니다" }, { status: 409 });
    }

    if (existingAttempt.status === "paid" || existingAttempt.status === "reconciliation_required") {
      // Toss already genuinely confirmed this exact payment — a page
      // refresh, back/forward, or retry never needs (and must never
      // trigger) a second Toss confirm call for it. 'reconciliation_required'
      // still reports success to the user here: the charge succeeded, only
      // our order record needs manual follow-up (that's what the status is
      // for), and telling the user "failed" would be the actual lie.
      const cached = (existingAttempt.toss_response as Record<string, unknown> | null) ?? { totalAmount: existingAttempt.amount, method: null };
      return NextResponse.json({ ok: true, data: cached });
    }
    // status is 'pending' (an earlier attempt never got a response from
    // Toss) or 'failed' (Toss genuinely rejected it, nothing was charged) —
    // both are safe to retry, fall through to the Toss call below.
  } else {
    const { error: insertPendingError } = await supabaseAdmin.from("payment_attempts").insert({
      order_id: orderId,
      user_id: user.id,
      winner_id: gameState.winner_id,
      amount,
      payment_key: paymentKey,
      status: "pending",
    });
    if (insertPendingError) {
      console.error("[payment/confirm] failed to create pending payment_attempts row", { orderId, error: insertPendingError });
      return NextResponse.json({ ok: false, error: "결제 확인 중 오류가 발생했습니다" }, { status: 500 });
    }
  }

  // Confirm payment with Toss — only reached once identity/winner/amount
  // have all passed and order_id isn't a stale/mismatched reuse. Network
  // failures and non-JSON error bodies are caught here so they come back as
  // a clean { ok: false } instead of crashing into a bare 500 — the client
  // must never read a crashed request as success.
  let data: Record<string, unknown>;
  try {
    const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");
    const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    data = await res.json();
    if (!res.ok) {
      console.error("[payment/confirm] Toss rejected confirm", { orderId, paymentKey: maskPaymentKey(paymentKey), status: res.status, tossError: data });
      await supabaseAdmin.from("payment_attempts")
        .update({ status: "failed", toss_response: data, updated_at: new Date().toISOString() })
        .eq("order_id", orderId);
      return NextResponse.json({ ok: false, error: safeTossErrorMessage(data) }, { status: res.status });
    }
  } catch (e) {
    console.error("[payment/confirm] Toss confirm request failed", { orderId, paymentKey: maskPaymentKey(paymentKey), error: e });
    await supabaseAdmin.from("payment_attempts")
      .update({ status: "failed", error_detail: String(e), updated_at: new Date().toISOString() })
      .eq("order_id", orderId);
    return NextResponse.json({ ok: false, error: "결제 확인 중 오류가 발생했습니다" }, { status: 502 });
  }

  // Toss has now genuinely confirmed the payment (money moved, or would in
  // production). From this point on we must never tell the user "결제
  // 실패" — that would invite a retry that re-hits an already-confirmed
  // paymentKey, which Toss doesn't guarantee is harmless. The
  // payment_attempts row updated below is the durable record that makes
  // recovery possible even if the orders insert fails.
  const { error: insertError } = await supabaseAdmin.from("orders").insert({
    user_id:      user.id,
    // Immutable historical record of who this order was for — survives
    // account deletion (no FK, same pattern as payment_attempts.winner_id)
    // even after user_id goes null via ON DELETE SET NULL. This is what
    // admin/reconciliation logic keys off, not user_id.
    winner_id:    gameState.winner_id,
    product_name: data.orderName ?? "Apple iPad Air 11형 Wi-Fi 128GB",
    amount:       data.totalAmount,
    order_id:     orderId,
    payment_key:  paymentKey,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      // Race: a concurrent request for the same order_id won the orders
      // insert between our earlier attempt lookup and this insert. The
      // order is saved either way — mark this attempt paid too.
      await supabaseAdmin.from("payment_attempts")
        .update({ status: "paid", toss_response: data, updated_at: new Date().toISOString() })
        .eq("order_id", orderId);
    } else {
      // The payment succeeded at Toss; the local order record did not.
      // This is exactly the durable "reconciliation_required" case — every
      // field needed to manually (or via a future automated job) complete
      // the missing `orders` row is preserved right here: user_id,
      // winner_id, amount, payment_key, and the full Toss response
      // (orderName/totalAmount/method) in toss_response.
      await supabaseAdmin.from("payment_attempts")
        .update({
          status: "reconciliation_required",
          toss_response: data,
          error_detail: String(insertError.message ?? insertError),
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);
      console.error("[payment/confirm] orders insert failed after Toss confirm succeeded — reconciliation_required", {
        orderId, paymentKey: maskPaymentKey(paymentKey), userId: user.id, amount, error: insertError,
      });
    }
    return NextResponse.json({ ok: true, data });
  }

  await supabaseAdmin.from("payment_attempts")
    .update({ status: "paid", toss_response: data, updated_at: new Date().toISOString() })
    .eq("order_id", orderId);

  return NextResponse.json({ ok: true, data });
}
