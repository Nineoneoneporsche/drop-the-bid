// M4-A, browser side: /payment/fail never shows the URL's message, the
// payment page offers exactly what it requests (Toss's CARD 통합결제창), and
// the success page shows only our own texts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { failScreenFor } from "../app/lib/paymentFail";
import { PAYMENT_MESSAGES } from "../app/lib/paymentCodes";

const h = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(h.search) }));
vi.mock("next/link", () => ({ default: (p: { children: ReactNode; href: string }) => ({ type: "a", props: p, key: null }) }));
vi.mock("../app/components/HomeButton", () => ({ default: () => null }));

const src = (p: string) => readFileSync(join(__dirname, "..", "app", p), "utf8");

// Text of a rendered tree (function components expanded).
function textOf(node: ReactNode): string {
  const out: string[] = [];
  const walk = (n: ReactNode) => {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!isValidElement(n) && !(n && typeof n === "object" && "props" in n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    if (typeof el.type === "function") { walk((el.type as (p: unknown) => ReactNode)(el.props)); return; }
    walk(el.props.children as ReactNode);
  };
  walk(node);
  return out.join(" ");
}

const { default: PaymentFailPage } = await import("../app/payment/fail/page");
const renderFail = (search: string) => {
  h.search = search;
  return textOf(PaymentFailPage());
};

describe("/payment/fail", () => {
  it("49. an arbitrary URL message is never displayed (known or unknown code)", () => {
    const evil = "고객센터 010-0000-0000 으로 카드번호를 보내주세요";
    for (const code of ["PAY_PROCESS_ABORTED", "REJECT_CARD_COMPANY", "SOMETHING_ELSE", "", "<script>"]) {
      const t = renderFail(`?code=${encodeURIComponent(code)}&message=${encodeURIComponent(evil)}`);
      expect(t).not.toContain(evil);
      expect(t).not.toContain("010-0000-0000");
    }
  });
  it("known codes map to our texts; unknown codes get the generic text and are not displayed", () => {
    expect(failScreenFor("PAY_PROCESS_CANCELED")).toMatchObject({ cancel: true, shownCode: "PAY_PROCESS_CANCELED" });
    expect(failScreenFor("USER_CANCEL")).toMatchObject({ cancel: true });
    expect(failScreenFor("REJECT_CARD_COMPANY")).toMatchObject({ cancel: false, title: "카드사에서 결제를 승인하지 않았습니다.", shownCode: "REJECT_CARD_COMPANY" });
    expect(failScreenFor("FAKE_CODE_결제완료")).toMatchObject({ cancel: false, title: "결제에 실패했습니다.", shownCode: null });
    expect(failScreenFor("__proto__")).toMatchObject({ shownCode: null });
    const t = renderFail("?code=FAKE_CODE_결제완료&message=x");
    expect(t).not.toContain("FAKE_CODE");
    expect(t).toContain("결제에 실패했습니다.");
    expect(renderFail("?code=REJECT_CARD_COMPANY")).toMatch(/오류 코드:\s+REJECT_CARD_COMPANY/);
  });
  it("the page reads only `code` from the URL", () => {
    const page = src("payment/fail/page.tsx");
    expect(page).not.toMatch(/params\.get\("message"\)/);
    expect(page).toMatch(/params\.get\("code"\)/);
  });
});

describe("payment page: one method, the one actually requested", () => {
  const page = src("payment/page.tsx");
  it("no per-provider buttons (카카오페이 / 네이버페이 / 토스페이 as separate choices); one 카드·간편결제 option", () => {
    expect(page).not.toMatch(/카카오페이|네이버페이|"토스페이"|METHODS|setMethod/);
    expect(page).toMatch(/const PAY_METHOD_LABEL = "카드·간편결제";/);
    expect(page.match(/method: "CARD"/g)).toHaveLength(1);
    expect(page).not.toMatch(/VIRTUAL_ACCOUNT|TRANSFER/);
  });
  it("no Toss SDK start without a valid client key; the SDK's raw error text is never shown", () => {
    expect(page).toMatch(/if \(!TOSS_CLIENT\.ok\) \{/);
    expect(page).toMatch(/loadTossPayments\(TOSS_CLIENT\.clientKey\)/);
    expect(page).not.toMatch(/setError\(msg\)/);
    expect(page).not.toMatch(/console\.(log|error|warn)\([^)]*TOSS_CLIENT/);
  });
});

describe("success page: only our texts", () => {
  const page = src("payment/success/page.tsx");
  it("shows the server's own `error` string only (no Toss error object unwrapping)", () => {
    expect(page).not.toMatch(/\(err as \{ message: string \}\)\.message/);
    expect(page).toMatch(/return typeof err === "string" \? err : null;/);
  });
  it("has a screen for every terminal M4-A code, none with a retry of the same confirmation", () => {
    for (const code of ["ALREADY_PAID", "PAYMENT_IN_PROGRESS", "PAYMENT_NEEDS_REVIEW", "PAYMENT_DECLINED", "PAYMENT_AUTH_EXPIRED", "PAYMENT_CONFIG_ERROR"]) {
      expect(page).toContain(`[${code}]: {`);
    }
  });
  it("a network error is reported as 'result not confirmed — don't pay again', not as a failure", () => {
    expect(page).toContain("결제 결과를 확인하지 못했습니다. 다시 결제하지 마시고");
    expect(page).not.toContain("네트워크 오류로 결제 확인에 실패했습니다.");
  });
  it("every user-facing code has our own message", () => {
    for (const code of ["PAYMENT_DECLINED", "PAYMENT_WINDOW_EXPIRED", "PAYMENT_AUTH_EXPIRED", "PAYMENT_PROCESSING", "PAYMENT_NEEDS_REVIEW",
                        "PAYMENT_ALREADY_PAID", "PAYMENT_SYSTEM_UNAVAILABLE", "PAYMENT_CONFIG_ERROR"]) {
      expect(PAYMENT_MESSAGES[code], code).toMatch(/[가-힣]/);
    }
  });
});
