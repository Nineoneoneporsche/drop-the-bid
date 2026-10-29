// Admin page UX lock (UI only — the server enforces waiting-only itself):
// from the first participant join (phase strategy) on, the round's terms
// (product / prices / drop settings) and the schedule (T / N) inputs are
// disabled and a notice is shown; operator nickname / messages stay
// editable. Renders the real page component with React's hooks reduced to
// "render once" and walks the element tree (custom components expanded),
// so each <input> is checked under its Field label. No DOM, no network.
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const h = vi.hoisted(() => ({
  phase: "home" as string,
  config: {
    productName: "Apple iPad Air 11형 Wi-Fi 128GB", startPrice: 899_000, dropAmount: 1_000, floorPrice: 550_000,
    gameStartTime: null as string | null, joinLeadMinutes: 30,
    fastDropPrice: null, fastDropAmount: null, finalDropPrice: null, finalDropAmount: null,
    dropIntervalSeconds: 1, fastDropIntervalSeconds: 1, finalDropIntervalSeconds: 1,
    operatorNickname: "운영자", operatorMessages: [] as { threshold: number; message: string }[],
  },
}));

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(init: T | (() => T)) => [typeof init === "function" ? (init as () => T)() : init, () => {}],
    useEffect: () => {},
    useCallback: <T,>(fn: T) => fn,
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("../app/lib/supabase", () => ({ supabase: {} }));
vi.mock("../app/context/GameContext", () => {
  return {
    DEFAULT_CONFIG: h.config,
    formatKRW: (n: number) => `₩${n}`,
    validateDropZones: () => null,
    useGame: () => ({
      state: {
        phase: h.phase,
        config: { ...h.config, gameStartTime: "2026-10-30T11:00:00.000Z", operatorMessages: [{ threshold: 50, message: "반값" }] },
        participantCount: 1, spectatorCount: 0, winner: null, isPaused: false, currentPrice: 899000, gameStartedAt: null,
      },
    }),
  };
});

const { default: AdminPage } = await import("../app/admin/(protected)/page");

type Input = { label: string | null; props: Record<string, unknown> };

// Walk the rendered tree; function components are called with their props.
function render(phase: string) {
  h.phase = phase;
  const inputs: Input[] = [];
  const texts: string[] = [];
  const walk = (node: ReactNode, label: string | null) => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") { texts.push(String(node)); return; }
    if (Array.isArray(node)) { node.forEach((n) => walk(n, label)); return; }
    if (!isValidElement(node)) return;
    const el = node as ReactElement<Record<string, unknown>>;
    if (typeof el.type === "function") {
      const fieldLabel = (el.type as { name?: string }).name === "Field" ? (el.props.label as string) : label;
      walk((el.type as (p: unknown) => ReactNode)(el.props), fieldLabel);
      return;
    }
    if (el.type === "input") inputs.push({ label, props: el.props });
    walk(el.props.children as ReactNode, label);
  };
  walk(AdminPage() as ReactNode, null);
  return { inputs, text: texts.join("\n") };
}

const ROUND_LABELS = [
  "상품명", "시작가 (원)", "목표 하한가 (원) — 프로그레스 바 기준", "초당 하락 금액 — NORMAL (원/초)", "하락 주기 — NORMAL (초)",
  "FAST DROP ZONE 시작가 (원)", "초당 하락 금액 — FAST DROP (원/초)", "하락 주기 — FAST DROP (초)",
  "FINAL DROP ZONE 시작가 (원)", "초당 하락 금액 — FINAL DROP (원/초)", "하락 주기 — FINAL DROP (초)",
];
const SCHEDULE_LABELS = ["경매 시작 예정 시간", "참가 가능 시작"];
const NOTICE = "참가자가 입장한 후에는 경매 조건을 변경할 수 없습니다. 변경하려면 경매를 리셋해주세요.";

const byLabel = (inputs: Input[], label: string) => inputs.filter((i) => i.label === label);
const disabled = (i: Input) => i.props.disabled === true;

describe("admin page: round terms locked outside waiting (UX)", () => {
  it("the walk sees every round / schedule field exactly once", () => {
    const { inputs } = render("home");
    for (const l of [...ROUND_LABELS, ...SCHEDULE_LABELS]) expect(byLabel(inputs, l), l).toHaveLength(1);
  });

  it("1. waiting: round terms and T / N enabled, no notice", () => {
    const { inputs, text } = render("home");
    for (const l of [...ROUND_LABELS, ...SCHEDULE_LABELS]) expect(disabled(byLabel(inputs, l)[0]), l).toBe(false);
    expect(text).not.toContain(NOTICE);
  });

  for (const phase of ["strategy", "game", "ended"]) {
    it(`${{ strategy: 2, game: 3, ended: 4 }[phase]}. ${phase}: every round term and T / N disabled, notice shown`, () => {
      const { inputs, text } = render(phase);
      for (const l of [...ROUND_LABELS, ...SCHEDULE_LABELS]) expect(disabled(byLabel(inputs, l)[0]), l).toBe(true);
      expect(text).toContain(NOTICE);
    });
  }

  it("5. strategy / game: operator nickname and messages stay enabled", () => {
    for (const phase of ["strategy", "game"]) {
      const { inputs } = render(phase);
      const nick = byLabel(inputs, "운영자 닉네임");
      expect(nick).toHaveLength(1);
      expect(disabled(nick[0])).toBe(false);
      const messageInputs = inputs.filter((i) => i.label === null && (i.props.placeholder === "이 구간에서 보여줄 메시지" || i.props.max === 100));
      expect(messageInputs).toHaveLength(2); // threshold % + text of the one message row
      for (const m of messageInputs) expect(disabled(m)).toBe(false);
    }
  });

  it("6. T / N enabled only in waiting", () => {
    expect(SCHEDULE_LABELS.map((l) => disabled(byLabel(render("home").inputs, l)[0]))).toEqual([false, false]);
    for (const phase of ["strategy", "game", "ended"]) {
      expect(SCHEDULE_LABELS.map((l) => disabled(byLabel(render(phase).inputs, l)[0]))).toEqual([true, true]);
    }
  });

  it("no other input on the page is disabled in strategy", () => {
    const { inputs } = render("strategy");
    const locked = new Set([...ROUND_LABELS, ...SCHEDULE_LABELS]);
    expect(inputs.filter((i) => disabled(i) && !locked.has(i.label ?? ""))).toEqual([]);
  });
});
