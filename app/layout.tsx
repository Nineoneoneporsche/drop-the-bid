import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GameProvider } from "./context/GameContext";

export const metadata: Metadata = {
  title: "Drop The Bid",
  description: "가격이 떨어질 때 손을 들어라 — 역경매 플랫폼",
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
