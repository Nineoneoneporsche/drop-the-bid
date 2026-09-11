import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { GameProvider } from "./context/GameContext";

// Self-hosted variable font — one woff2 covering the whole 400–1000 weight
// range, so no per-weight files.
const wantedSans = localFont({
  src: "../public/fonts/WantedSansVariable.woff2",
  display: "swap",
  weight: "400 1000",
  variable: "--font-wanted-sans",
});

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
    <html lang="ko" className={wantedSans.variable}>
<body className="antialiased bg-gray-950 text-white min-h-screen">
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  );
}
