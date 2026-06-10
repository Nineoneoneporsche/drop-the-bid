import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GameProvider } from "./context/GameContext";

export const metadata: Metadata = {
  title: "Rabbit",
  description: "기다릴수록 가격은 내려갑니다 — 실시간 역경매 라이브",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="antialiased bg-gray-950 text-white min-h-screen">
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  );
}
