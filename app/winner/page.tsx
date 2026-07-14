"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WinnerPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/strategy"); }, [router]);
  return null;
}
