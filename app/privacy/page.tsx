import type { Metadata } from "next";
import LegalDocument from "../components/LegalDocument";
import { PRIVACY_POLICY } from "../lib/legal";

export const metadata: Metadata = { title: "개인정보처리방침 | 드랍더비드" };

export default function Page() {
  return <LegalDocument title="개인정보처리방침" body={PRIVACY_POLICY} />;
}
