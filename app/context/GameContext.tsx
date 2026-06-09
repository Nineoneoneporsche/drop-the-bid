"use client";

import React, { createContext, useContext, useReducer, useEffect } from "react";

export type Role = "participant" | "spectator";
export type Phase = "home" | "strategy" | "game" | "ended";
export type MessageKind = "chat" | "system" | "narrator";

export interface ChatMessage {
  id: string;
  nickname: string;
  message: string;
  kind?: MessageKind;
  timestamp: number;
}

export interface GameConfig {
  productName: string;
  startPrice: number;
  dropAmount: number;
  strategyDuration: number;
  gameStartTime: string | null;
}

export interface GameState {
  config: GameConfig;
  phase: Phase;
  currentUser: { nickname: string; role: Role } | null;
  currentPrice: number;
  winner: { nickname: string; price: number } | null;
  chatMessages: ChatMessage[];
  strategyStartedAt: number | null;
  gameStartedAt: number | null;
}

export type GameAction =
  | { type: "LOAD_CONFIG"; config: GameConfig }
  | { type: "UPDATE_CONFIG"; config: Partial<GameConfig> }
  | { type: "JOIN"; user: { nickname: string; role: Role } }
  | { type: "START_STRATEGY"; timestamp: number }
  | { type: "START_GAME"; timestamp: number }
  | { type: "TICK" }
  | { type: "RAISE_HAND"; nickname: string; price: number }
  | { type: "SEND_MESSAGE"; nickname: string; message: string; timestamp: number }
  | { type: "SEND_NARRATOR"; message: string; timestamp: number }
  | { type: "RESET" };

export const DEFAULT_CONFIG: GameConfig = {
  productName: "Mac mini M4",
  startPrice: 1_000_000,
  dropAmount: 1_000,
  strategyDuration: 180,
  gameStartTime: null,
};

export const MOCK_PARTICIPANT_COUNT = 217;
export const MOCK_SPECTATOR_COUNT = 31;

function makeMockMessages(baseTime: number): ChatMessage[] {
  return [
    {
      id: "m0",
      nickname: "system",
      message: `협상 라운지 입장 — ${MOCK_PARTICIPANT_COUNT}명 참여 중`,
      kind: "system",
      timestamp: baseTime - 32000,
    },
    {
      id: "m1",
      nickname: "kimchi_buyer",
      message: "다들 70만원까지는 기다리는 거죠? 🤝",
      kind: "chat",
      timestamp: baseTime - 26000,
    },
    {
      id: "m2",
      nickname: "techie_seoul",
      message: "70k 이전엔 절대 아무도 누르지 말아요. 약속해요!",
      kind: "chat",
      timestamp: baseTime - 20000,
    },
    {
      id: "m3",
      nickname: "bidder_pro",
      message: "우리 서로 믿으면 다 같이 싸게 살 수 있어요",
      kind: "chat",
      timestamp: baseTime - 14000,
    },
    {
      id: "m4",
      nickname: "mac_lover99",
      message: "작년엔 협력이 잘 돼서 87만원에 낙찰됐어요 💪",
      kind: "chat",
      timestamp: baseTime - 8000,
    },
    {
      id: "m5",
      nickname: "newbie_here",
      message: "저도 믿고 기다릴게요... 무섭지만 ㅠ",
      kind: "chat",
      timestamp: baseTime - 3000,
    },
  ];
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "LOAD_CONFIG":
      return { ...state, config: action.config, currentPrice: action.config.startPrice };

    case "UPDATE_CONFIG": {
      const newConfig = { ...state.config, ...action.config };
      return {
        ...state,
        config: newConfig,
        currentPrice:
          action.config.startPrice !== undefined
            ? action.config.startPrice
            : state.currentPrice,
      };
    }

    case "JOIN":
      return { ...state, currentUser: action.user };

    case "START_STRATEGY":
      return {
        ...state,
        phase: "strategy",
        strategyStartedAt: action.timestamp,
        chatMessages: makeMockMessages(action.timestamp),
      };

    case "START_GAME":
      return {
        ...state,
        phase: "game",
        gameStartedAt: action.timestamp,
        currentPrice: state.config.startPrice,
      };

    case "TICK": {
      if (state.phase !== "game") return state;
      const newPrice = Math.max(0, state.currentPrice - state.config.dropAmount);
      return { ...state, currentPrice: newPrice };
    }

    case "RAISE_HAND":
      return {
        ...state,
        phase: "ended",
        winner: { nickname: action.nickname, price: action.price },
      };

    case "SEND_MESSAGE":
      return {
        ...state,
        chatMessages: [
          ...state.chatMessages,
          {
            id: String(action.timestamp),
            nickname: action.nickname,
            message: action.message,
            kind: "chat" as MessageKind,
            timestamp: action.timestamp,
          },
        ],
      };

    case "SEND_NARRATOR":
      return {
        ...state,
        chatMessages: [
          ...state.chatMessages,
          {
            id: `n${action.timestamp}`,
            nickname: "narrator",
            message: action.message,
            kind: "narrator" as MessageKind,
            timestamp: action.timestamp,
          },
        ],
      };

    case "RESET":
      return {
        ...state,
        phase: "home",
        currentUser: null,
        currentPrice: state.config.startPrice,
        winner: null,
        chatMessages: [],
        strategyStartedAt: null,
        gameStartedAt: null,
      };

    default:
      return state;
  }
}

interface GameContextValue {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, {
    config: DEFAULT_CONFIG,
    phase: "home",
    currentUser: null,
    currentPrice: DEFAULT_CONFIG.startPrice,
    winner: null,
    chatMessages: [],
    strategyStartedAt: null,
    gameStartedAt: null,
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem("dtb_config");
      if (saved) {
        const config = JSON.parse(saved) as GameConfig;
        dispatch({ type: "LOAD_CONFIG", config });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("dtb_config", JSON.stringify(state.config));
  }, [state.config]);

  return (
    <GameContext.Provider value={{ state, dispatch }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}

export function formatKRW(amount: number): string {
  return "₩" + new Intl.NumberFormat("ko-KR").format(amount);
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.getHours().toString().padStart(2, "0") +
    ":" +
    d.getMinutes().toString().padStart(2, "0")
  );
}
