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
  description: string;
  startPrice: number;
  dropAmount: number;
  strategyDuration: number;
  gameStartTime: string | null;
  floorPrice: number;
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
  | { type: "LOAD_CONFIG"; config: Partial<GameConfig> }
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
  productName: "Apple iPad Air 11형 Wi-Fi 128GB",
  description: "강력한 M3 칩과 11형 Liquid Retina 디스플레이를 탑재한 iPad Air",
  startPrice: 899_000,
  dropAmount: 1_000,
  strategyDuration: 60,
  gameStartTime: null,
  floorPrice: 550_000,
};

export const MOCK_PARTICIPANT_COUNT = 217;
export const MOCK_SPECTATOR_COUNT = 3412;

function makeMockMessages(baseTime: number): ChatMessage[] {
  return [
    {
      id: "m0",
      nickname: "system",
      message: `참가자 라운지 입장 — ${MOCK_PARTICIPANT_COUNT}명 참여 중 👋`,
      kind: "system",
      timestamp: baseTime - 20000,
    },
    {
      id: "m1",
      nickname: "shopping_star",
      message: "조금 더 기다려볼까요? 😊",
      kind: "chat",
      timestamp: baseTime - 16000,
    },
    {
      id: "m2",
      nickname: "minivelo_fan",
      message: "20만원 밑으로 가면 좋겠네요",
      kind: "chat",
      timestamp: baseTime - 12000,
    },
    {
      id: "m3",
      nickname: "kid_gear_mom",
      message: "아직은 이른 것 같아요",
      kind: "chat",
      timestamp: baseTime - 8000,
    },
    {
      id: "m4",
      nickname: "smart_buyer",
      message: "다들 신중하게 가봐요 👍",
      kind: "chat",
      timestamp: baseTime - 4000,
    },
  ];
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "LOAD_CONFIG": {
      const merged = { ...DEFAULT_CONFIG, ...action.config };
      return {
        ...state,
        config: merged,
        currentPrice: merged.startPrice,
      };
    }

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
        const config = JSON.parse(saved) as Partial<GameConfig>;
        // Product fields always come from DEFAULT_CONFIG so deploys take effect immediately
        dispatch({ type: "LOAD_CONFIG", config: {
          ...config,
          productName:      DEFAULT_CONFIG.productName,
          description:      DEFAULT_CONFIG.description,
          startPrice:       DEFAULT_CONFIG.startPrice,
          floorPrice:       DEFAULT_CONFIG.floorPrice,
          dropAmount:       DEFAULT_CONFIG.dropAmount,
          strategyDuration: DEFAULT_CONFIG.strategyDuration,
        }});
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
