import { describe, expect, it } from "vitest";
import { verifyPhoneOtpSchema } from "./auth.schema";

describe("verifyPhoneOtpSchema", () => {
  it("nhận mã có khoảng trắng ở GIỮA — kiểu dán phổ biến nhất từ tin nhắn", () => {
    // Lỗi thật trước đây: chú thích nói "chấp nhận khoảng trắng" nhưng schema
    // chỉ `trim()` hai đầu, nên `123 456` bị báo "gồm 6 chữ số".
    expect(verifyPhoneOtpSchema.parse({ code: " 123 456 " })).toEqual({ code: "123456" });
  });

  it("vẫn từ chối mã không đủ 6 chữ số hoặc có chữ", () => {
    expect(verifyPhoneOtpSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(verifyPhoneOtpSchema.safeParse({ code: "12a456" }).success).toBe(false);
    expect(verifyPhoneOtpSchema.safeParse({ code: 123456 }).success).toBe(false);
  });
});
