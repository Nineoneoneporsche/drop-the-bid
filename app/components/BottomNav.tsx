"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    href: "/guide",
    label: "게임방법",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  {
    href: "/practice",
    label: "모의훈련",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    ),
  },
  {
    href: "/results",
    label: "지난결과",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 3 18 9"/>
        <path d="M6 9h12v6a6 6 0 0 1-12 0V9z"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="15" x2="12" y2="21"/>
      </svg>
    ),
  },
  {
    href: "/mini-game",
    label: "미니게임",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="6"/>
        <line x1="8" y1="12" x2="12" y2="12"/>
        <line x1="10" y1="10" x2="10" y2="14"/>
        <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/>
        <circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/>
      </svg>
    ),
  },
  {
    href: "/mypage",
    label: "My Page",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none">
      <nav
        className="w-full max-w-md bg-white border-t border-gray-100 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pointer-events-auto"
        style={{ height: 72 }}
      >
        <ul className="flex h-full">
          {NAV_ITEMS.map(({ href, label, icon }) => {
            const active = pathname === href;
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  className={`flex flex-col items-center justify-center h-full gap-1 transition-colors active:opacity-70 ${
                    active ? "text-orange-500" : "text-gray-400"
                  }`}
                >
                  {icon}
                  <span className={`text-[10px] font-semibold leading-none ${active ? "text-orange-500" : "text-gray-400"}`}>
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
