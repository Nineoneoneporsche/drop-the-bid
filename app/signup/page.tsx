"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HomeButton from "../components/HomeButton";

/* ── Types ──────────────────────────────────────────────────────── */
interface Form {
  email: string; password: string; passwordConfirm: string;
  agreeTerms: boolean; agreePrivacy: boolean; agreeMarketing: boolean;
  name: string; phone: string; dob: string;
  postcode: string; addressBase: string; addressDetail: string;
  cardNumber: string; cardExpiry: string; cardCvc: string; cardHolder: string;
}
type Errors = Partial<Record<keyof Form, string>>;

const INIT: Form = {
  email: "", password: "", passwordConfirm: "",
  agreeTerms: false, agreePrivacy: false, agreeMarketing: false,
  name: "", phone: "", dob: "",
  postcode: "", addressBase: "", addressDetail: "",
  cardNumber: "", cardExpiry: "", cardCvc: "", cardHolder: "",
};

const STEPS = ["계정 정보", "개인 정보", "배송지", "결제 카드"];

/* ── Formatters ──────────────────────────────────────────────────── */
function fmtPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
function fmtCard(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 16);
  return d.replace(/(.{4})(?=.)/g, "$1-");
}
function fmtExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}

/* ── Sub-components ──────────────────────────────────────────────── */
function Field({
  label, required, error, hint, ...props
}: { label: string; required?: boolean; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-4">
      <label className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/55 font-medium mb-1.5">
        {label}
        {required && <span className="text-[#a855f7] normal-case tracking-normal text-xs">*</span>}
      </label>
      <input
        className={`w-full bg-white/5 border px-3.5 py-3 text-white placeholder-white/20 text-sm focus:outline-none transition-colors rounded-xl ${
          error ? "border-red-500/60 focus:border-red-500/80" : "border-white/12 focus:border-[#a855f7]/60"
        }`}
        {...props}
      />
      {hint && !error && <p className="text-white/40 text-[11px] mt-1">{hint}</p>}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

function CheckRow({
  checked, onChange, children, error,
}: { checked: boolean; onChange: () => void; children: React.ReactNode; error?: string }) {
  return (
    <div className="mb-2">
      <button type="button" onClick={onChange} className="flex items-start gap-3 w-full text-left">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${checked ? "bg-[#a855f7] border-[#a855f7]" : "border-white/25 bg-transparent"}`}>
          {checked && (
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1,6 5,10 11,2" />
            </svg>
          )}
        </div>
        <span className="text-sm text-white/65 leading-relaxed">{children}</span>
      </button>
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
            <div className={`w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center transition-colors ${
              i + 1 < step ? "bg-[#a855f7] text-white" :
              i + 1 === step ? "bg-[#a855f7] text-white" : "bg-white/10 text-white/40"
            }`}>
              {i + 1 < step ? (
                <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1,6 5,10 11,2" />
                </svg>
              ) : i + 1}
            </div>
            <span className={`text-[10px] font-medium text-center leading-tight ${i + 1 <= step ? "text-white/65" : "text-white/30"}`}>
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

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  }

  function toggleAgreeAll() {
    const next = !agreeAll;
    setAgreeAll(next);
    setForm(f => ({ ...f, agreeTerms: next, agreePrivacy: next, agreeMarketing: next }));
  }

  function validate(): boolean {
    const e: Errors = {};
    if (step === 1) {
      if (!form.email || !/\S+@\S+\.\S+/.test(form.email)) e.email = "유효한 이메일 주소를 입력하세요";
      if (form.password.length < 8) e.password = "8자 이상 입력하세요";
      if (form.password !== form.passwordConfirm) e.passwordConfirm = "비밀번호가 일치하지 않습니다";
      if (!form.agreeTerms) e.agreeTerms = "이용약관 동의가 필요합니다";
      if (!form.agreePrivacy) e.agreePrivacy = "개인정보 처리방침 동의가 필요합니다";
    }
    if (step === 2) {
      if (!form.name.trim()) e.name = "이름을 입력하세요";
      if (form.phone.replace(/\D/g, "").length < 10) e.phone = "올바른 휴대폰 번호를 입력하세요";
    }
    if (step === 3) {
      if (!form.postcode) e.postcode = "우편번호를 입력하세요";
      if (!form.addressBase.trim()) e.addressBase = "기본 주소를 입력하세요";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    if (!validate()) return;
    if (step < 4) {
      setStep(s => s + 1);
    } else {
      const user = {
        nickname: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone,
        since: new Date().toISOString().slice(0, 7).replace("-", "."),
      };
      localStorage.setItem("dtb_user", JSON.stringify(user));
      router.push("/mypage");
    }
  }

  function handleSkipCard() {
    const user = {
      nickname: form.name,
      email: form.email,
      password: form.password,
      phone: form.phone,
      since: new Date().toISOString().slice(0, 7).replace("-", "."),
    };
    localStorage.setItem("dtb_user", JSON.stringify(user));
    router.push("/mypage");
  }

  function mockPostcodeSearch() {
    set("postcode", "06236");
    set("addressBase", "서울특별시 강남구 테헤란로 123");
  }

  return (
    <main className="min-h-screen bg-[#0f0f0f] flex flex-col items-center">
      <div className="w-full max-w-md px-4 pt-10 pb-16">

        <div className="mb-5"><HomeButton /></div>

        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.14em] text-white/55 font-medium mb-1">Drop The Bid</p>
          <h1 className="text-5xl font-black text-white leading-tight">회원가입</h1>
        </div>

        <Progress step={step} />

        {/* ── Step 1: 계정 정보 ── */}
        {step === 1 && (
          <div key="step1" className="step-enter">
            <Field label="이메일" required type="email" placeholder="example@email.com"
              value={form.email} onChange={e => set("email", e.target.value)} error={errors.email} autoComplete="email" />
            <Field label="비밀번호" required type="password" placeholder="8자 이상"
              value={form.password} onChange={e => set("password", e.target.value)} error={errors.password}
              hint="영문, 숫자, 특수문자 조합 8자 이상" autoComplete="new-password" />
            <Field label="비밀번호 확인" required type="password" placeholder="비밀번호 재입력"
              value={form.passwordConfirm} onChange={e => set("passwordConfirm", e.target.value)} error={errors.passwordConfirm} autoComplete="new-password" />

            <div className="mt-6 mb-5 bg-[#141414] border border-white/10 rounded-2xl p-4">
              <CheckRow checked={agreeAll} onChange={toggleAgreeAll}>
                <span className="font-bold text-white/85">전체 동의</span>
              </CheckRow>
              <div className="border-t border-white/10 mt-3 pt-3 space-y-1">
                <CheckRow checked={form.agreeTerms} onChange={() => set("agreeTerms", !form.agreeTerms)} error={errors.agreeTerms}>
                  <span className="text-[#a855f7] font-semibold mr-1">[필수]</span>서비스 이용약관 동의
                </CheckRow>
                <CheckRow checked={form.agreePrivacy} onChange={() => set("agreePrivacy", !form.agreePrivacy)} error={errors.agreePrivacy}>
                  <span className="text-[#a855f7] font-semibold mr-1">[필수]</span>개인정보 처리방침 동의
                </CheckRow>
                <CheckRow checked={form.agreeMarketing} onChange={() => set("agreeMarketing", !form.agreeMarketing)}>
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
            <Field label="휴대폰 번호" required type="tel" placeholder="010-0000-0000"
              value={form.phone}
              onChange={e => set("phone", fmtPhone(e.target.value))}
              error={errors.phone} autoComplete="tel" />
            <Field label="생년월일" type="date" placeholder="YYYY-MM-DD"
              value={form.dob} onChange={e => set("dob", e.target.value)}
              hint="만 14세 이상만 가입할 수 있어요" />
          </div>
        )}

        {/* ── Step 3: 배송지 ── */}
        {step === 3 && (
          <div key="step3" className="step-enter">
            <div className="mb-4">
              <label className="block text-[11px] uppercase tracking-wider text-white/55 font-medium mb-1.5">
                우편번호 <span className="text-[#a855f7] normal-case tracking-normal text-xs">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  placeholder="우편번호"
                  value={form.postcode}
                  className={`flex-1 bg-white/5 border px-3.5 py-3 text-white placeholder-white/20 text-sm focus:outline-none rounded-xl ${errors.postcode ? "border-red-500/60" : "border-white/12"}`}
                />
                <button
                  type="button"
                  onClick={mockPostcodeSearch}
                  className="flex-shrink-0 px-4 py-3 text-sm font-bold text-white rounded-xl border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
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
                💡 배송지는 낙찰 후 결제 시에도 변경할 수 있어요. 지금 입력하면 결제가 더 빨라져요.
              </p>
            </div>
          </div>
        )}

        {/* ── Step 4: 결제 카드 (선택) ── */}
        {step === 4 && (
          <div key="step4" className="step-enter">
            <div className="bg-[#141414] border border-white/10 rounded-2xl px-5 pt-5 pb-2 mb-4">
              <p className="text-white/85 text-sm font-bold mb-1">결제 카드 등록 <span className="text-white/40 font-normal text-xs ml-1">선택</span></p>
              <p className="text-white/45 text-xs mb-5 leading-relaxed">등록하면 낙찰 시 바로 결제할 수 있어요. 나중에 마이페이지에서도 등록 가능해요.</p>

              <Field label="카드 번호" placeholder="0000-0000-0000-0000"
                value={form.cardNumber} onChange={e => set("cardNumber", fmtCard(e.target.value))}
                inputMode="numeric" autoComplete="cc-number" />
              <div className="flex gap-3">
                <div className="flex-1">
                  <Field label="유효 기간" placeholder="MM/YY"
                    value={form.cardExpiry} onChange={e => set("cardExpiry", fmtExpiry(e.target.value))}
                    inputMode="numeric" autoComplete="cc-exp" />
                </div>
                <div className="flex-1">
                  <Field label="CVC" placeholder="000"
                    value={form.cardCvc} onChange={e => set("cardCvc", e.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric" type="password" autoComplete="cc-csc" />
                </div>
              </div>
              <Field label="카드 소유자명" placeholder="카드에 표기된 이름"
                value={form.cardHolder} onChange={e => set("cardHolder", e.target.value)} autoComplete="cc-name" />
            </div>
          </div>
        )}

        {/* ── Buttons ── */}
        <div className="mt-6 space-y-2">
          <button onClick={handleNext} className="w-full py-4 text-white font-bold text-base bid-btn-purple rounded-xl">
            {step < 4 ? "다음" : "가입 완료"}
          </button>

          {step === 4 && (
            <button onClick={handleSkipCard} className="w-full py-3 text-white/50 text-sm border border-white/12 rounded-xl transition-colors hover:border-white/25">
              나중에 등록할게요
            </button>
          )}

          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)} className="w-full py-3 text-white/40 text-sm transition-colors hover:text-white/65">
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
    </main>
  );
}
