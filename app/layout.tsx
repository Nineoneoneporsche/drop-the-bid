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

// Absolute base for resolving relative og:image/og:url values in metadata.
// Prefers an explicit override, then Vercel's stable production-domain
// system env var (works whether the project is on the default .vercel.app
// domain or a custom one added later), then falls back to the known live
// domain — never localhost, since metadataBase only matters for what an
// external crawler (Kakao/Slack/etc.) resolves, and that's always prod.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  "https://drop-the-bid.vercel.app";

const SITE_TITLE = "드랍더비드";
const SITE_DESCRIPTION = "가격은 계속 내려갑니다. 원하는 타이밍에 먼저 선택한 한 명이 그 가격에 구매하는 실시간 역경매.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_TITLE,
    type: "website",
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: SITE_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.jpg"],
  },
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
