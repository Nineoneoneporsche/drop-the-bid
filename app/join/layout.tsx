import type { Metadata } from "next";

// Static, server-rendered metadata — deliberately doesn't read searchParams
// or touch the DB/game_state, so it's identical for /join and
// /join?utm_source=share, and never breaks if Supabase is degraded.
const TITLE = "지금 가격이 내려가고 있습니다 | 드랍더비드";
const DESCRIPTION = "기다릴수록 낮아지는 가격, 원하는 가격에 구매하세요.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/join",
    siteName: "드랍더비드",
    type: "website",
    images: [{ url: "/og-image-main.jpg", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image-main.jpg"],
  },
};

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
