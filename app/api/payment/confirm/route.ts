import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY ?? "test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R";

export async function POST(req: NextRequest) {
  const { paymentKey, orderId, amount } = await req.json();

  if (!paymentKey || !orderId || !amount) {
    return NextResponse.json({ ok: false, error: "Missing parameters" }, { status: 400 });
  }

  // Verify amount against DB winner_price to prevent URL tampering
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: gameState } = await supabase
    .from("game_state")
    .select("winner_price")
    .eq("id", 1)
    .single();

  if (!gameState?.winner_price) {
    return NextResponse.json({ ok: false, error: "낙찰 정보를 찾을 수 없습니다" }, { status: 400 });
  }
  if (gameState.winner_price !== amount) {
    return NextResponse.json({ ok: false, error: "결제 금액이 낙찰가와 일치하지 않습니다" }, { status: 400 });
  }

  // Confirm payment with Toss
  const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64");
  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: data }, { status: res.status });
  }

  return NextResponse.json({ ok: true, data });
}
