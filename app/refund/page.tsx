import type { Metadata } from "next";
import LegalDocument from "../components/LegalDocument";
import { REFUND_POLICY } from "../lib/legal";

export const metadata: Metadata = { title: "환불정책 | 드랍더비드" };

export default function Page() {
  return <LegalDocument title="환불정책" body={REFUND_POLICY} />;
}
