// Shipping info lives in Supabase Auth user_metadata, alongside the keys the
// signup form and the My Page address editor already write (phone,
// postcode, address, addressDetail). The recipient name is its own key,
// shippingRecipientName — deliberately NOT user_metadata.name, which is the
// member's profile name (and for OAuth accounts whatever the provider put
// there), a different concept from "who receives the parcel".
//
// Shared by app/mypage/page.tsx (editing), app/payment/page.tsx (client-side
// gate) and app/api/payment/confirm/route.ts (server-side gate + the
// orders snapshot) so all three agree on what "complete" means.

export const SHIPPING_INFO_REQUIRED = "SHIPPING_INFO_REQUIRED";

export type ShippingInfo = {
  recipientName: string;
  phone:         string;
  postcode:      string;
  address:       string;
  addressDetail: string; // optional — may be ""
};

export type ShippingField = keyof ShippingInfo;

export const SHIPPING_FIELD_LABELS: Record<ShippingField, string> = {
  recipientName: "받는 분",
  phone:         "휴대폰 번호",
  postcode:      "우편번호",
  address:       "기본 주소",
  addressDetail: "상세 주소",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function shippingFromMetadata(meta: Record<string, unknown> | null | undefined): ShippingInfo {
  const m = meta ?? {};
  return {
    recipientName: str(m.shippingRecipientName),
    phone:         str(m.phone),
    postcode:      str(m.postcode),
    address:       str(m.address),
    addressDetail: str(m.addressDetail),
  };
}

// Required: recipient name, phone (at least 10 digits, same rule as the
// signup form), postcode, base address. addressDetail is optional, as it
// already is at signup.
export function missingShippingFields(info: ShippingInfo): ShippingField[] {
  const missing: ShippingField[] = [];
  if (!info.recipientName) missing.push("recipientName");
  if (info.phone.replace(/\D/g, "").length < 10) missing.push("phone");
  if (!info.postcode) missing.push("postcode");
  if (!info.address) missing.push("address");
  return missing;
}
