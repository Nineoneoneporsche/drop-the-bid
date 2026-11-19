#!/usr/bin/env node
// PG review test account (TEMPORARY, 2026-11). Creates an e-mail/password
// account (e-mail already confirmed), gives it a profile nickname, and lists
// it in public.review_accounts so it may join a live drop
// (supabase/migrations/20261119100000_review_account_live_join.sql).
//
// Run it yourself:   node scripts/create-review-account.mjs
// Targets the Supabase project in .env.local (NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY). Asks for the e-mail, password (hidden) and
// nickname. Prints no user id, key or password. Safe to re-run: an existing
// account with that e-mail is reused (its password is NOT changed) and just
// listed.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function findUserIdByEmail(admin, email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`사용자 조회 실패: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const env = loadEnv(path.join(process.cwd(), ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("✗ .env.local에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없습니다. drop-the-bid 폴더에서 실행하세요.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const email = (await ask("심사용 이메일: ")).toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("✗ 이메일 형식이 아닙니다."); process.exit(1); }

let userId = await findUserIdByEmail(admin, email);
if (userId) {
  console.log("• 이미 있는 계정입니다. 비밀번호는 바꾸지 않고 목록 등록만 진행합니다.");
} else {
  const password = await ask("비밀번호 (화면에 표시되지 않음, 8자 이상): ", { hidden: true });
  const again = await ask("비밀번호 다시 입력: ", { hidden: true });
  if (password.length < 8) { console.error("✗ 비밀번호는 8자 이상이어야 합니다."); process.exit(1); }
  if (password !== again) { console.error("✗ 비밀번호가 서로 다릅니다."); process.exit(1); }
  const nickname = (await ask("닉네임 (엔터 = 심사용): ")) || "심사용";

  const { data: taken, error: nickErr } = await admin.from("profiles").select("id").eq("nickname", nickname).maybeSingle();
  if (nickErr) { console.error(`✗ 닉네임 확인 실패: ${nickErr.message}`); process.exit(1); }
  if (taken) { console.error("✗ 이미 사용 중인 닉네임입니다. 다른 닉네임으로 다시 실행하세요."); process.exit(1); }

  const since = new Date().toISOString().slice(0, 7).replace("-", ".");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname, since },
  });
  if (error) { console.error(`✗ 계정 생성 실패: ${error.message}`); process.exit(1); }
  userId = data.user.id;
  console.log("✓ 계정 생성 (이메일 인증 완료 상태)");

  const { error: profErr } = await admin.from("profiles").insert({ id: userId, nickname });
  if (profErr) console.warn(`! 프로필 닉네임 저장 실패 (로그인 후 마이페이지에서 설정 가능): ${profErr.message}`);
  else console.log("✓ 프로필 닉네임 저장");
}

const { error: listErr } = await admin
  .from("review_accounts")
  .upsert({ user_id: userId, note: `PG review ${new Date().toISOString().slice(0, 10)}` }, { onConflict: "user_id", ignoreDuplicates: true });
if (listErr) { console.error(`✗ 심사용 목록 등록 실패: ${listErr.message}`); process.exit(1); }

const { count, error: cntErr } = await admin.from("review_accounts").select("user_id", { count: "exact", head: true });
if (cntErr) { console.error(`✗ 목록 확인 실패: ${cntErr.message}`); process.exit(1); }
console.log(`✓ 심사용 목록 등록 완료 (현재 ${count}개)`);
console.log("다음: dropthebid.com 마이페이지에서 이 이메일/비밀번호로 로그인 → 배송지 등록");
