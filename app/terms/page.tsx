import type { Metadata } from "next";
import LegalDocument from "../components/LegalDocument";
import { TERMS_OF_SERVICE } from "../lib/legal";

export const metadata: Metadata = { title: "이용약관 | 드랍더비드" };

export default function Page() {
  return <LegalDocument title="이용약관" body={TERMS_OF_SERVICE} />;
}
