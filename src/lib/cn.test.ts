import { describe, expect, it } from "vitest";
import { cn } from "./cn";

/**
 * `cn` gộp class của component với class truyền vào từ ngoài. Class sau phải
 * THAY class trước cùng nhóm — kể cả khi một bên là token riêng của dự án.
 * Giữ cả hai thì bên thắng do thứ tự CSS quyết định, không phải do người viết.
 */
describe("cn — token riêng trong globals.css", () => {
  it("bo góc: token và thang mặc định thay nhau theo thứ tự viết", () => {
    expect(cn("rounded-md", "rounded-token-md")).toBe("rounded-token-md");
    expect(cn("rounded-token-md", "rounded-md")).toBe("rounded-md");
    expect(cn("rounded-token-control", "rounded-token-lg")).toBe("rounded-token-lg");
  });

  it("bóng đổ: token là KÍCH CỠ bóng, không bị đoán nhầm thành màu bóng", () => {
    expect(cn("shadow-sm", "shadow-nang-1")).toBe("shadow-nang-1");
    expect(cn("shadow-nang-1", "shadow-chon")).toBe("shadow-chon");
    expect(cn("shadow-chon", "shadow-none")).toBe("shadow-none");
    expect(cn("shadow-dock", "shadow-sticky-edge")).toBe("shadow-sticky-edge");
  });

  it("màu chữ: hai màu token không cùng tồn tại", () => {
    expect(cn("text-content", "text-brand-text")).toBe("text-brand-text");
    expect(cn("bg-surface", "bg-elevated")).toBe("bg-elevated");
    expect(cn("border-line-strong", "border-danger")).toBe("border-danger");
    expect(cn("text-sport-tennis", "text-muted")).toBe("text-muted");
  });

  it("màu chữ và CỠ chữ là hai nhóm khác nhau — không nuốt nhau", () => {
    expect(cn("text-sm text-content", "text-base")).toBe("text-content text-base");
    expect(cn("text-muted", "text-xs")).toBe("text-muted text-xs");
  });

  it("vẫn nhận điều kiện như clsx", () => {
    const active = false;
    expect(cn("h-11", active && "bg-brand", undefined, "h-9")).toBe("h-9");
  });
});
