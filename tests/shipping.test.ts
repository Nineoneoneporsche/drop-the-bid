import { describe, expect, it } from "vitest";
import { missingShippingFields, shippingFromMetadata } from "../app/lib/shipping";

describe("shippingFromMetadata", () => {
  it("reads the shipping keys and trims them", () => {
    expect(shippingFromMetadata({
      shippingRecipientName: "  홍길동 ", phone: "010-1234-5678", postcode: "06236",
      address: "서울 강남구 테헤란로 152", addressDetail: " 12층 ",
    })).toEqual({
      recipientName: "홍길동", phone: "010-1234-5678", postcode: "06236",
      address: "서울 강남구 테헤란로 152", addressDetail: "12층",
    });
  });

  it("never falls back to the profile name", () => {
    expect(shippingFromMetadata({ name: "프로필이름", full_name: "Full Name" }).recipientName).toBe("");
  });

  it("treats non-string and missing values as empty", () => {
    expect(shippingFromMetadata(null)).toEqual({ recipientName: "", phone: "", postcode: "", address: "", addressDetail: "" });
    expect(shippingFromMetadata({ phone: 1012345678 }).phone).toBe("");
  });
});

describe("missingShippingFields", () => {
  const complete = { recipientName: "홍길동", phone: "01012345678", postcode: "06236", address: "서울", addressDetail: "" };

  it("accepts complete info with an empty addressDetail", () => {
    expect(missingShippingFields(complete)).toEqual([]);
  });

  it("lists every missing required field", () => {
    expect(missingShippingFields({ recipientName: "", phone: "", postcode: "", address: "", addressDetail: "x" }))
      .toEqual(["recipientName", "phone", "postcode", "address"]);
  });

  it("requires at least 10 phone digits", () => {
    expect(missingShippingFields({ ...complete, phone: "010-123-456" })).toEqual(["phone"]);
    expect(missingShippingFields({ ...complete, phone: "010-123-4567" })).toEqual([]);
  });

  it("treats whitespace-only values as missing", () => {
    expect(missingShippingFields(shippingFromMetadata({ shippingRecipientName: "   ", phone: "01012345678", postcode: "1", address: "a" })))
      .toEqual(["recipientName"]);
  });
});
