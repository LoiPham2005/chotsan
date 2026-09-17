import { describe, expect, it } from "vitest";
import { z } from "zod";
import { firstIssueMessage, formErrorMap } from "./form-errors";

/**
 * Câu lỗi phải nói Ô NÀO sai và SỬA THẾ NÀO — không bao giờ là câu tiếng Anh
 * mặc định của Zod ("Too small: expected number to be >=5").
 */
const LABELS = {
  name: "Tên sân",
  holdMinutes: "Giữ chỗ (phút)",
  email: "Email",
  pricePerSlot: "Giá / 30 phút",
  surface: "Mặt sân",
};

function messageOf(schema: z.ZodType, input: unknown): string {
  const parsed = schema.safeParse(input, { error: formErrorMap(LABELS) });
  if (parsed.success) throw new Error("dữ liệu mẫu phải sai");
  return firstIssueMessage(parsed.error, "không có");
}

describe("formErrorMap", () => {
  it("giữ nguyên câu tiếng Việt đã viết tay trong schema", () => {
    const schema = z.object({ name: z.string().min(2, "Tên sân quá ngắn") });
    expect(messageOf(schema, { name: "A" })).toBe("Tên sân quá ngắn");
  });

  it("số ngoài khoảng: nói tên ô và giới hạn", () => {
    const schema = z.object({ holdMinutes: z.coerce.number().int().min(5).max(120) });

    expect(messageOf(schema, { holdMinutes: "3" })).toBe("Giữ chỗ (phút) phải từ 5 trở lên");
    expect(messageOf(schema, { holdMinutes: "500" })).toBe("Giữ chỗ (phút) tối đa 120");
    expect(messageOf(schema, { holdMinutes: "abc" })).toBe("Giữ chỗ (phút) phải là một con số");
    expect(messageOf(schema, { holdMinutes: "7.5" })).toBe(
      "Giữ chỗ (phút) phải là số nguyên, không có phần lẻ",
    );
  });

  it("chuỗi: trống, quá dài, sai dạng email", () => {
    const schema = z.object({
      name: z.string().trim().min(1).max(10),
      email: z.email(),
    });

    expect(messageOf(schema, { name: " ", email: "a@b.vn" })).toBe("Tên sân đang để trống");
    expect(messageOf(schema, { name: "x".repeat(11), email: "a@b.vn" })).toBe(
      "Tên sân dài quá — tối đa 10 ký tự",
    );
    expect(messageOf(schema, { name: "Sân 1", email: "khong-phai-email" })).toBe(
      "Email chưa đúng dạng — ví dụ: ten@gmail.com",
    );
  });

  it("lỗi nằm sâu trong mảng vẫn lấy đúng tên ô cuối đường dẫn", () => {
    const schema = z.array(z.object({ pricePerSlot: z.number().int().min(0) }));
    expect(messageOf(schema, [{ pricePerSlot: 70_000 }, { pricePerSlot: -5 }])).toBe(
      "Giá / 30 phút phải từ 0 trở lên",
    );
  });

  it("chọn ngoài danh sách — kể cả ô chọn được phép để trống", () => {
    const schema = z.object({ surface: z.enum(["WOOD", "CLAY"]) });
    expect(messageOf(schema, { surface: "ICE" })).toBe("Mặt sân: chọn một giá trị trong danh sách");

    const optional = z.object({ surface: z.enum(["WOOD", "CLAY"]).or(z.literal("")) });
    expect(messageOf(optional, { surface: "ICE" })).toBe(
      "Mặt sân: chọn một giá trị trong danh sách",
    );
  });

  it("trường không có nhãn vẫn ra câu tiếng Việt, không lộ tên kỹ thuật", () => {
    const schema = z.object({ internalId: z.string().min(1) });
    expect(messageOf(schema, { internalId: "" })).toBe("Thông tin vừa nhập đang để trống");
  });
});
