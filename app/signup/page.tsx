"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HomeButton from "../components/HomeButton";
import SiteFooter from "../components/SiteFooter";
import { supabase } from "../lib/supabase";
import { MARKETING_CONSENT, PRIVACY_POLICY, TERMS_OF_SERVICE } from "../lib/legal";

// Minimum anti-multi-account deterrent (⑧): disposable-email signup is the
// cheapest way to run several accounts, so new signups go through
// Kakao/Google only for now. UI-level only — existing email/password
// *login* is untouched (app/mypage/page.tsx), and this doesn't stop
// someone from calling supabase.auth.signUp() directly against the API.
// The real server-side toggle is Supabase Dashboard > Authentication >
// Providers > Email > "Allow new users to sign up", which only the
// project owner can flip — see report for exact steps.
const EMAIL_SIGNUP_ENABLED = false;

/* ── Terms content: app/lib/legal.ts (shared with /terms, /privacy, /refund) ── */

type ModalType = "terms" | "privacy" | "marketing" | null;

/* ── Types ──────────────────────────────────────────────────────── */
interface Form {
  email: string; password: string; passwordConfirm: string;
  agreeTerms: boolean; agreePrivacy: boolean; agreeMarketing: boolean;
  name: string; nickname: string; phone: string; dob: string;
  postcode: string; addressBase: string; addressDetail: string;
}
type Errors = Partial<Record<keyof Form, string>>;

const INIT: Form = {
  email: "", password: "", passwordConfirm: "",
  agreeTerms: false, agreePrivacy: false, agreeMarketing: false,
  name: "", nickname: "", phone: "", dob: "",
  postcode: "", addressBase: "", addressDetail: "",
};

const STEPS = ["계정 정보", "개인 정보", "배송지"];

/* ── Formatters ──────────────────────────────────────────────────── */
function fmtPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/* ── Terms Modal ─────────────────────────────────────────────────── */
function TermsModal({
  title, content, onAgree, onClose, agreed,
}: {
  title: string;
  content: string;
  onAgree?: () => void;
  onClose: () => void;
  agreed?: boolean;
}) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md flex flex-col"
        style={{ background: "#141414", borderRadius: "20px 20px 0 0", maxHeight: "82vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "22px" }}>close</span>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          <pre className="text-white/65 text-xs leading-relaxed whitespace-pre-wrap font-sans">
            {content}
          </pre>
        </div>

        {/* Footer */}
        <div className="px-5 pb-8 pt-4 border-t border-white/10 flex-shrink-0 space-y-2">
          {onAgree && (
            <button
              onClick={() => { onAgree(); onClose(); }}
              className="w-full py-3.5 text-white font-semibold text-base rounded-xl transition-opacity active:opacity-80"
              style={{ background: agreed ? "rgba(168,85,247,0.3)" : "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
            >
              {agreed ? "동의 완료" : "동의하고 닫기"}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full py-3 text-white/50 text-base font-medium"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */
function Field({
  label, required, error, hint, ...props
}: { label: string; required?: boolean; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-4">
      <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/55 font-medium mb-1.5">
        {label}
        {required && <span className="text-[#a855f7] normal-case tracking-normal text-xs">*</span>}
      </label>
      <input
        className={`w-full bg-white/5 border px-3.5 py-3 text-white placeholder-white/20 text-base focus:outline-none transition-colors rounded-xl ${
          error ? "border-red-500/60 focus:border-red-500/80" : "border-white/12 focus:border-[#a855f7]/60"
        }`}
        {...props}
      />
      {hint && !error && <p className="text-white/40 text-xs mt-1">{hint}</p>}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

function CheckRow({
  checked, onChange, onView, children, error,
}: { checked: boolean; onChange: () => void; onView?: () => void; children: React.ReactNode; error?: string }) {
  return (
    <div className="mb-2">
      <div className="flex items-start gap-0 w-full">
        <button type="button" onClick={onChange} className="flex items-start gap-3 flex-1 text-left py-0.5">
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${checked ? "bg-[#a855f7] border-[#a855f7]" : "border-white/25 bg-transparent"}`}>
            {checked && (
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1,6 5,10 11,2" />
              </svg>
            )}
          </div>
          <span className="text-base text-white/65 leading-relaxed">{children}</span>
        </button>
        {onView && (
          <button
            type="button"
            onClick={onView}
            className="flex-shrink-0 text-xs text-white/40 hover:text-white/70 transition-colors underline underline-offset-2 ml-2 mt-1"
          >
            내용 보기
          </button>
        )}
      </div>
      {error && <p className="text-red-400 text-xs mt-1 pl-8">{error}</p>}
    </div>
  );
}

/* ── Progress bar ──────────────────────────────────────────────────── */
function Progress({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
            <div className={`w-6 h-6 rounded-full text-xs font-extrabold flex items-center justify-center transition-colors ${
              i + 1 < step ? "bg-[#a855f7] text-white" :
              i + 1 === step ? "bg-[#a855f7] text-white" : "bg-white/10 text-white/40"
            }`}>
              {i + 1 < step ? (
                <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1,6 5,10 11,2" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-xs font-medium text-center leading-tight ${i + 1 <= step ? "text-white/65" : "text-white/30"}`}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <div className="h-0.5 bg-white/8 rounded-full mt-1 mx-3">
        <div
          className="h-0.5 rounded-full transition-all duration-500"
          style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%`, background: "#a855f7" }}
        />
      </div>
    </div>
  );
}

/* ── Main ─────────────────────────────────────────────────────────── */
export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(INIT);
  const [errors, setErrors] = useState<Errors>({});
  const [agreeAll, setAgreeAll] = useState(false);
  const [modal, setModal] = useState<ModalType>(null);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  }

  function toggleAgreeAll() {
    const next = !agreeAll;
    setAgreeAll(next);
    setForm(f => ({ ...f, agreeTerms: next, agreePrivacy: next, agreeMarketing: next }));
  }

  // Keep agreeAll in sync
  useEffect(() => {
    setAgreeAll(form.agreeTerms && form.agreePrivacy && form.agreeMarketing);
  }, [form.agreeTerms, form.agreePrivacy, form.agreeMarketing]);

  function validate(): boolean {
    const e: Errors = {};
    if (step === 1) {
      if (!form.email || !/\S+@\S+\.\S+/.test(form.email)) {
        e.email = "유효한 이메일 주소를 입력하세요";
      } else if (emailStatus === "taken") {
        e.email = "이미 가입된 이메일입니다";
      } else if (emailStatus === "checking") {
        e.email = "이메일 확인 중입니다. 잠시 후 다시 시도해주세요";
      }
      if (form.password.length < 8) e.password = "8자 이상 입력하세요";
      if (form.password !== form.passwordConfirm) e.passwordConfirm = "비밀번호가 일치하지 않습니다";
      if (!form.agreeTerms) e.agreeTerms = "이용약관 동의가 필요합니다";
      if (!form.agreePrivacy) e.agreePrivacy = "개인정보 처리방침 동의가 필요합니다";
    }
    if (step === 2) {
      if (!form.name.trim()) e.name = "이름을 입력하세요";
      const nick = form.nickname.trim();
      if (!nick) {
        e.nickname = "닉네임을 입력하세요";
      } else if (!/^[가-힣a-zA-Z0-9_]{2,12}$/.test(nick)) {
        e.nickname = "2-12자, 한글·영문·숫자·밑줄만 사용 가능합니다";
      } else if (nicknameStatus === "taken") {
        e.nickname = "이미 사용 중인 닉네임입니다";
      } else if (nicknameStatus !== "available") {
        e.nickname = "닉네임 확인 중입니다. 잠시 후 다시 시도해주세요";
      }
      if (form.phone.replace(/\D/g, "").length < 10) e.phone = "올바른 휴대폰 번호를 입력하세요";
      if (!form.dob) {
        e.dob = "생년월일을 입력하세요";
      } else {
        const birth = new Date(form.dob);
        const today = new Date();
        const age = today.getFullYear() - birth.getFullYear()
          - (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
        if (age < 14) e.dob = "만 14세 이상만 가입할 수 있습니다";
      }
    }
    if (step === 3) {
      if (!form.postcode) e.postcode = "우편번호를 입력하세요";
      if (!form.addressBase.trim()) e.addressBase = "기본 주소를 입력하세요";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [nicknameStatus, setNicknameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  useEffect(() => {
    if (step !== 1) return;
    const email = form.email.trim().toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email)) { setEmailStatus("idle"); return; }
    setEmailStatus("checking");
    const t = setTimeout(async () => {
      const res = await fetch(`/api/auth/check-email?email=${encodeURIComponent(email)}`);
      const { exists } = await res.json();
      setEmailStatus(exists ? "taken" : "available");
    }, 600);
    return () => clearTimeout(t);
  }, [form.email, step]);

  useEffect(() => {
    if (step !== 2) return;
    const nick = form.nickname.trim();
    if (!nick || !/^[가-힣a-zA-Z0-9_]{2,12}$/.test(nick)) { setNicknameStatus("idle"); return; }
    setNicknameStatus("checking");
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id").eq("nickname", nick).maybeSingle();
      setNicknameStatus(data ? "taken" : "available");
    }, 500);
    return () => clearTimeout(t);
  }, [form.nickname, step]);

  async function finishSignup() {
    setSubmitting(true);
    setSubmitErr("");
    const nick = form.nickname.trim();

    // Final uniqueness check
    const { data: taken } = await supabase.from("profiles").select("id").eq("nickname", nick).maybeSingle();
    if (taken) {
      setSubmitErr("이미 사용 중인 닉네임입니다. 다른 닉네임을 선택해주세요.");
      setSubmitting(false);
      return;
    }

    const since = new Date().toISOString().slice(0, 7).replace("-", ".");
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          name: form.name,
          nickname: nick,
          phone: form.phone,
          since,
          postcode: form.postcode,
          address: form.addressBase,
          addressDetail: form.addressDetail,
        },
      },
    });
    if (error) {
      setSubmitErr(error.message === "User already registered"
        ? "이미 가입된 이메일입니다."
        : error.message);
      setSubmitting(false);
      return;
    }
    await supabase.auth.signInWithPassword({ email: form.email, password: form.password });

    // Save nickname to profiles table
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase.from("profiles").insert({ id: session.user.id, nickname: nick });
    }

    router.push("/mypage");
  }

  function handleNext() {
    if (!validate()) return;
    if (step < STEPS.length) {
      setStep(s => s + 1);
    } else {
      finishSignup();
    }
  }

  function handlePostcodeSearch() {
    function openPostcode() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (window as any).daum.Postcode({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oncomplete: (data: any) => {
          set("postcode", data.zonecode);
          set("addressBase", data.roadAddress || data.jibunAddress);
        },
      }).open();
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).daum?.Postcode) {
      openPostcode();
    } else {
      const script = document.createElement("script");
      script.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
      script.onload = openPostcode;
      document.head.appendChild(script);
    }
  }

  const modalConfig: Record<NonNullable<ModalType>, { title: string; content: string; agreeKey?: keyof Form }> = {
    terms:     { title: "서비스 이용약관",      content: TERMS_OF_SERVICE, agreeKey: "agreeTerms" },
    privacy:   { title: "개인정보 처리방침",     content: PRIVACY_POLICY,   agreeKey: "agreePrivacy" },
    marketing: { title: "마케팅 정보 수신 동의", content: MARKETING_CONSENT, agreeKey: "agreeMarketing" },
  };

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center">
      <div className="w-full max-w-md px-4 pt-10 pb-16">

        <div className="mb-5"><HomeButton /></div>

        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-[22px] font-extrabold text-white leading-tight">회원가입</h1>
        </div>

        <Progress step={step} />

        {/* ── Step 1: 계정 정보 ── */}
        {step === 1 && (
          <div key="step1" className="step-enter">
            {/* 소셜 로그인 */}
            <button
              type="button"
              onClick={() => supabase.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "login", lang: "ko" } } })}
              className="w-full py-3.5 font-semibold text-base rounded-xl mb-2.5 flex items-center justify-center gap-2.5 active:opacity-80 transition-opacity"
              style={{ background: "#FEE500", color: "#191919" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#191919">
                <path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.607 5.085 4.054 6.534L5.1 20.72a.375.375 0 0 0 .54.41l4.335-2.87C10.302 18.41 11.143 18.5 12 18.5c5.523 0 10-3.477 10-7.7S17.523 3 12 3z"/>
              </svg>
              카카오로 시작하기
            </button>
            <button
              type="button"
              onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "select_account" } } })}
              className="w-full py-3.5 font-semibold text-base rounded-xl mb-5 flex items-center justify-center gap-2.5 border border-white/15 active:opacity-80 transition-opacity"
              style={{ background: "#fff", color: "#1f1f1f" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              구글로 시작하기
            </button>

            {EMAIL_SIGNUP_ENABLED ? (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs text-white/30 font-medium">또는 이메일로 가입</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
                <div className="mb-4">
                  <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/55 font-medium mb-1.5">
                    이메일 <span className="text-[#a855f7] normal-case tracking-normal text-xs">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="example@email.com"
                      value={form.email}
                      onChange={e => { set("email", e.target.value.trim()); setEmailStatus("idle"); }}
                      autoComplete="email"
                      className={`w-full bg-white/5 border px-3.5 py-3 text-white placeholder-white/20 text-base focus:outline-none transition-colors rounded-xl pr-28 ${
                        errors.email ? "border-red-500/60 focus:border-red-500/80" : "border-white/12 focus:border-[#a855f7]/60"
                      }`}
                    />
                    {emailStatus !== "idle" && (
                      <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${
                        emailStatus === "checking" ? "text-white/40" :
                        emailStatus === "available" ? "text-green-400" : "text-red-400"
                      }`}>
                        {emailStatus === "checking" ? "확인 중..." :
                         emailStatus === "available" ? "✓ 사용 가능" : "✗ 이미 가입됨"}
                      </span>
                    )}
                  </div>
                  {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
                </div>
                <Field label="비밀번호" required type="password" placeholder="8자 이상"
                  value={form.password} onChange={e => set("password", e.target.value)} error={errors.password}
                  hint="영문, 숫자, 특수문자 조합 8자 이상" autoComplete="new-password" />
                <Field label="비밀번호 확인" required type="password" placeholder="비밀번호 재입력"
                  value={form.passwordConfirm} onChange={e => set("passwordConfirm", e.target.value)} error={errors.passwordConfirm} autoComplete="new-password" />
              </>
            ) : (
              <p className="text-center text-white/35 text-xs mt-6">
                현재 신규 가입은 카카오톡/구글로만 가능합니다.
              </p>
            )}

            <div className="mt-6 mb-5 bg-[#141414] border border-white/10 rounded-2xl p-4">
              <CheckRow checked={agreeAll} onChange={toggleAgreeAll}>
                <span className="font-semibold text-white/85">전체 동의</span>
              </CheckRow>
              <div className="border-t border-white/10 mt-3 pt-3 space-y-1">
                <CheckRow
                  checked={form.agreeTerms}
                  onChange={() => set("agreeTerms", !form.agreeTerms)}
                  onView={() => setModal("terms")}
                  error={errors.agreeTerms}
                >
                  <span className="text-[#a855f7] font-semibold mr-1">[필수]</span>서비스 이용약관 동의
                </CheckRow>
                <CheckRow
                  checked={form.agreePrivacy}
                  onChange={() => set("agreePrivacy", !form.agreePrivacy)}
                  onView={() => setModal("privacy")}
                  error={errors.agreePrivacy}
                >
                  <span className="text-[#a855f7] font-semibold mr-1">[필수]</span>개인정보 처리방침 동의
                </CheckRow>
                <CheckRow
                  checked={form.agreeMarketing}
                  onChange={() => set("agreeMarketing", !form.agreeMarketing)}
                  onView={() => setModal("marketing")}
                >
                  <span className="text-white/40 font-semibold mr-1">[선택]</span>마케팅 정보 수신 동의
                </CheckRow>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: 개인 정보 ── */}
        {step === 2 && (
          <div key="step2" className="step-enter">
            <Field label="이름" required placeholder="실명을 입력하세요"
              value={form.name} onChange={e => set("name", e.target.value)} error={errors.name} autoComplete="name" />
            <div className="mb-4">
              <label className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/55 font-medium mb-1.5">
                닉네임 <span className="text-[#a855f7] normal-case tracking-normal text-xs">*</span>
              </label>
              <div className="relative">
                <input
                  className={`w-full bg-white/5 border px-3.5 py-3 text-white placeholder-white/20 text-base focus:outline-none transition-colors rounded-xl pr-24 ${
                    errors.nickname ? "border-red-500/60 focus:border-red-500/80" : "border-white/12 focus:border-[#a855f7]/60"
                  }`}
                  placeholder="드랍에서 사용할 닉네임"
                  value={form.nickname}
                  onChange={e => { set("nickname", e.target.value.replace(/\s/g, "")); }}
                  maxLength={12}
                />
                {nicknameStatus !== "idle" && (
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${
                    nicknameStatus === "checking" ? "text-white/40" :
                    nicknameStatus === "available" ? "text-green-400" : "text-red-400"
                  }`}>
                    {nicknameStatus === "checking" ? "확인 중..." :
                     nicknameStatus === "available" ? "✓ 사용 가능" : "✗ 중복"}
                  </span>
                )}
              </div>
              <p className="text-white/40 text-xs mt-1">한글·영문·숫자·밑줄(_) 2-12자</p>
              {errors.nickname && <p className="text-red-400 text-xs mt-1">{errors.nickname}</p>}
            </div>
            <Field label="휴대폰 번호" required type="tel" placeholder="010-0000-0000"
              value={form.phone}
              onChange={e => set("phone", fmtPhone(e.target.value))}
              error={errors.phone} autoComplete="tel" />
            <Field label="생년월일" required type="date" placeholder="YYYY-MM-DD"
              value={form.dob} onChange={e => set("dob", e.target.value)}
              error={errors.dob}
              hint={!errors.dob ? "만 14세 이상만 가입할 수 있어요" : undefined} />
          </div>
        )}

        {/* ── Step 3: 배송지 ── */}
        {step === 3 && (
          <div key="step3" className="step-enter">
            <div className="mb-4">
              <label className="block text-xs uppercase tracking-wider text-white/55 font-medium mb-1.5">
                우편번호 <span className="text-[#a855f7] normal-case tracking-normal text-xs">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  placeholder="우편번호"
                  value={form.postcode}
                  className={`flex-1 bg-white/5 border px-3.5 py-3 text-white placeholder-white/20 text-base focus:outline-none rounded-xl ${errors.postcode ? "border-red-500/60" : "border-white/12"}`}
                />
                <button
                  type="button"
                  onClick={handlePostcodeSearch}
                  className="flex-shrink-0 px-4 py-3 text-base font-semibold text-white rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  주소 검색
                </button>
              </div>
              {errors.postcode && <p className="text-red-400 text-xs mt-1">{errors.postcode}</p>}
            </div>
            <Field label="기본 주소" required placeholder="도로명 주소"
              value={form.addressBase} onChange={e => set("addressBase", e.target.value)} error={errors.addressBase} autoComplete="street-address" />
            <Field label="상세 주소" placeholder="동·호수, 건물명 등"
              value={form.addressDetail} onChange={e => set("addressDetail", e.target.value)} />
            <div className="bg-[#141414] border border-white/10 rounded-2xl p-4 mt-2">
              <p className="text-xs text-white/45 leading-relaxed">
                배송지는 구매 확정 후 결제 시에도 변경할 수 있어요. 지금 입력하면 결제가 더 빨라져요.
              </p>
            </div>
          </div>
        )}

        {/* ── Buttons ── */}
        <div className="mt-6 space-y-2">
          {submitErr && <p className="text-red-400 text-sm text-center">{submitErr}</p>}
          {/* Steps 2-3 only ever exist to finish an email/password signup
              (finishSignup() below) — with that path disabled, step 1 has
              nothing left to submit into them. Kakao/Google buttons above
              navigate away immediately regardless of step, unaffected. */}
          {(EMAIL_SIGNUP_ENABLED || step !== 1) && (
            <button onClick={handleNext} disabled={submitting} className="w-full py-4 text-white font-semibold text-base bid-btn-purple rounded-xl disabled:opacity-50">
              {submitting ? "처리 중..." : step < STEPS.length ? "다음" : "가입 완료"}
            </button>
          )}

          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)} className="w-full py-3 text-white/40 text-base transition-colors hover:text-white/65">
              ← 이전 단계
            </button>
          )}

          {step === 1 && (
            <p className="text-center text-white/40 text-sm pt-1">
              이미 계정이 있나요?{" "}
              <Link href="/mypage" className="text-[#a855f7] font-semibold">로그인</Link>
            </p>
          )}
        </div>

      </div>

      {/* ── Terms / Privacy Modal ── */}
      {modal && (
        <TermsModal
          title={modalConfig[modal].title}
          content={modalConfig[modal].content}
          agreed={modalConfig[modal].agreeKey ? !!form[modalConfig[modal].agreeKey!] : undefined}
          onAgree={modalConfig[modal].agreeKey
            ? () => set(modalConfig[modal].agreeKey!, true as Form[keyof Form])
            : undefined
          }
          onClose={() => setModal(null)}
        />
      )}
      <SiteFooter />
    </main>
  );
}
