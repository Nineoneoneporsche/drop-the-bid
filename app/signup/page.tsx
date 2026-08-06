"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HomeButton from "../components/HomeButton";

/* ── Terms content ──────────────────────────────────────────────────── */
const TERMS_OF_SERVICE = `제1조 (목적)
본 약관은 Drop The Bid(이하 "회사")가 제공하는 역경매 서비스(이하 "서비스")의 이용에 관한 조건 및 절차, 회사와 이용자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.

제2조 (용어의 정의)
① "서비스"란 회사가 제공하는 실시간 역경매 플랫폼으로, 이용자가 경쟁을 통해 상품을 낙찰받을 수 있는 서비스를 말합니다.
② "이용자"란 이 약관에 따라 회사가 제공하는 서비스를 받는 회원 및 비회원을 말합니다.
③ "회원"이란 회사에 개인정보를 제공하여 회원 등록을 한 자로서, 회사의 정보를 지속적으로 제공받으며 회사가 제공하는 서비스를 계속적으로 이용할 수 있는 자를 말합니다.
④ "낙찰"이란 경매에서 최종 낙찰자로 선정되어 해당 상품의 구매 권리를 획득하는 것을 말합니다.

제3조 (약관의 효력 및 변경)
① 이 약관은 서비스를 이용하고자 하는 모든 이용자에게 그 효력을 발생합니다.
② 회사는 합리적인 사유가 발생할 경우 관련 법령에 위배되지 않는 범위 안에서 이 약관을 개정할 수 있습니다.
③ 회사가 약관을 개정할 경우에는 적용 일자 및 개정 사유를 명시하여 현행 약관과 함께 서비스 초기 화면에 그 적용 일자 7일 전부터 공지합니다.

제4조 (서비스의 제공 및 변경)
① 회사는 다음과 같은 서비스를 제공합니다.
  - 실시간 역경매 서비스
  - 입찰 전략 제공 서비스
  - 낙찰 상품 결제 및 배송 서비스
② 회사는 서비스의 내용을 변경할 수 있으며, 변경 시에는 이용자에게 사전 공지합니다.

제5조 (서비스 이용 요금)
① 회사는 서비스 이용에 대한 요금을 부과할 수 있습니다.
② 낙찰된 상품에 대한 결제는 낙찰 시점의 낙찰가로 이루어집니다.
③ 낙찰 후 결제 미이행 시 패널티가 부과될 수 있습니다.

제6조 (이용자의 의무)
① 이용자는 다음 행위를 하여서는 안 됩니다.
  - 타인의 정보 도용
  - 서비스를 이용한 부정경쟁 행위
  - 경매 결과를 조작하거나 조작을 시도하는 행위
  - 기타 관계 법령에 위반되는 행위

제7조 (회사의 의무)
① 회사는 관계 법령과 이 약관이 금지하거나 공서양속에 반하는 행위를 하지 않으며, 이 약관이 정하는 바에 따라 지속적이고 안정적으로 서비스를 제공하기 위해 최선을 다합니다.
② 회사는 이용자가 안전하게 서비스를 이용할 수 있도록 개인정보보호를 위한 보안 시스템을 갖춥니다.

제8조 (면책조항)
① 회사는 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 서비스 제공에 관한 책임이 면제됩니다.
② 회사는 이용자의 귀책사유로 인한 서비스 이용의 장애에 대하여는 책임을 지지 않습니다.

제9조 (분쟁해결)
① 회사는 이용자로부터 제출되는 불만사항 및 의견은 우선적으로 그 사항을 처리합니다.
② 회사와 이용자 간에 발생한 분쟁은 대한민국 법을 준거법으로 하며, 분쟁이 발생한 경우 회사의 주소지를 관할하는 법원을 관할 법원으로 합니다.

부칙
본 약관은 2025년 1월 1일부터 시행합니다.`;

const PRIVACY_POLICY = `제1조 (개인정보의 처리 목적)
Drop The Bid(이하 "회사")는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 개인정보 보호법 제18조에 따라 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.

① 회원가입 및 관리
  회원 가입 의사 확인, 회원제 서비스 제공에 따른 본인 식별·인증, 회원자격 유지·관리, 서비스 부정이용 방지, 각종 고지·통지 목적으로 개인정보를 처리합니다.

② 서비스 제공
  경매 서비스 제공, 콘텐츠 제공, 낙찰 정보 제공, 결제 및 정산 목적으로 개인정보를 처리합니다.

제2조 (개인정보의 처리 및 보유 기간)
① 회사는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 개인정보를 수집 시에 동의 받은 개인정보 보유·이용 기간 내에서 개인정보를 처리·보유합니다.
② 각각의 개인정보 처리 및 보유 기간은 다음과 같습니다.
  - 회원가입 및 관리: 서비스 탈퇴 시까지 (단, 관계 법령 위반에 따른 수사·조사 등이 진행 중인 경우에는 해당 수사·조사 종료 시까지)
  - 결제 및 거래 기록: 전자상거래 등에서의 소비자보호에 관한 법률에 따라 5년간 보존

제3조 (개인정보의 제3자 제공)
① 회사는 정보주체의 개인정보를 제1조에서 명시한 범위 내에서만 처리하며, 정보주체의 동의, 법률의 특별한 규정 등 개인정보 보호법 제17조 및 제18조에 해당하는 경우에만 개인정보를 제3자에게 제공합니다.
② 결제 처리를 위해 토스페이먼츠(주)에 결제 관련 정보가 제공됩니다.

제4조 (수집하는 개인정보의 항목)
① 필수 수집 항목
  이메일, 비밀번호, 이름, 휴대폰 번호
② 선택 수집 항목
  생년월일, 배송지 주소
③ 서비스 이용 과정에서 자동 수집되는 정보
  IP 주소, 쿠키, 기기 정보, 서비스 이용 기록

제5조 (개인정보의 파기)
① 회사는 개인정보 보유 기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.
② 전자적 파일 형태로 기록·저장된 개인정보는 기록을 재생할 수 없도록 파기하며, 종이 문서에 기록·저장된 개인정보는 분쇄기로 분쇄하거나 소각하여 파기합니다.

제6조 (정보주체의 권리·의무 및 행사방법)
① 정보주체는 회사에 대해 언제든지 개인정보 열람·정정·삭제·처리정지 요구 등의 권리를 행사할 수 있습니다.
② 권리 행사는 개인정보 보호법 시행령 제41조 제1항에 따라 서면, 전자우편 등을 통하여 하실 수 있으며, 회사는 이에 대해 지체 없이 조치하겠습니다.

제7조 (개인정보 보호책임자)
개인정보 보호와 관련한 문의는 아래의 담당자에게 연락 주시기 바랍니다.
  - 개인정보 보호책임자: 서비스 운영팀
  - 연락처: privacy@dropthebid.co.kr

본 방침은 2025년 1월 1일부터 적용됩니다.`;

const MARKETING_CONSENT = `마케팅 정보 수신 동의 안내

수신 동의 항목
  - 이메일, SMS/MMS, 앱 푸시 알림

제공 정보 내용
  - 신규 경매 상품 안내
  - 이벤트 및 프로모션 정보
  - 할인 혜택 및 쿠폰 정보
  - 서비스 업데이트 소식

보유 및 이용 기간
  동의 철회 시까지 (동의 철회는 마이페이지에서 언제든지 가능합니다)

거부 시 불이익
  마케팅 정보 수신을 거부하셔도 기본 서비스 이용에는 제한이 없습니다.
  단, 혜택 정보를 받아보실 수 없습니다.

본 동의는 선택사항이며, 거부하셔도 서비스 이용에 불이익이 없습니다.`;

type ModalType = "terms" | "privacy" | "marketing" | null;

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
          <h2 className="text-base font-bold text-white">{title}</h2>
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
              className="w-full py-3.5 text-white font-bold text-sm rounded-xl transition-opacity active:opacity-80"
              style={{ background: agreed ? "rgba(168,85,247,0.3)" : "linear-gradient(180deg, #bf7af0 0%, #a855f7 55%, #8b3fd9 100%)" }}
            >
              {agreed ? "동의 완료" : "동의하고 닫기"}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full py-3 text-white/50 text-sm font-medium"
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
          <span className="text-sm text-white/65 leading-relaxed">{children}</span>
        </button>
        {onView && (
          <button
            type="button"
            onClick={onView}
            className="flex-shrink-0 text-[11px] text-white/40 hover:text-white/70 transition-colors underline underline-offset-2 ml-2 mt-1"
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
      if (!form.email || !/\S+@\S+\.\S+/.test(form.email)) e.email = "유효한 이메일 주소를 입력하세요";
      if (form.password.length < 8) e.password = "8자 이상 입력하세요";
      if (form.password !== form.passwordConfirm) e.passwordConfirm = "비밀번호가 일치하지 않습니다";
      if (!form.agreeTerms) e.agreeTerms = "이용약관 동의가 필요합니다";
      if (!form.agreePrivacy) e.agreePrivacy = "개인정보 처리방침 동의가 필요합니다";
    }
    if (step === 2) {
      if (!form.name.trim()) e.name = "이름을 입력하세요";
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
      localStorage.setItem("dtb_session", "1");
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
    localStorage.setItem("dtb_session", "1");
    router.push("/mypage");
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
                  onClick={handlePostcodeSearch}
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
                배송지는 낙찰 후 결제 시에도 변경할 수 있어요. 지금 입력하면 결제가 더 빨라져요.
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
    </main>
  );
}
