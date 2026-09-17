import type { z } from "zod";

/**
 * Câu lỗi của form: NÓI Ô NÀO SAI VÀ SỬA THẾ NÀO.
 *
 * ---
 * LỖI NÓ SỬA
 *
 * Luật nào trong schema không tự khai câu lỗi (`.max(120)`, `.int()`,
 * `z.coerce.number()` nhận chữ…) thì Zod dùng câu mặc định TIẾNG ANH: chủ sân
 * gõ "abc" vào ô giữ chỗ và đọc "Invalid input: expected number, received NaN".
 * Các action từng che chuyện đó bằng một câu chung ("Dữ liệu không hợp lệ",
 * "Sai định dạng") — người dùng biết là sai, không biết sai ô nào.
 *
 * ---
 * CÁCH DÙNG
 *
 * Truyền `formErrorMap(labels)` vào `safeParse(data, { error })`. Zod CHỈ gọi nó
 * cho luật không tự khai câu — câu tiếng Việt đã viết tay trong schema ("Số
 * điện thoại 10–11 số") luôn được giữ nguyên, bản dịch ở đây chỉ lấp chỗ trống.
 * `labels` là tên ô đúng như người dùng nhìn thấy trên form.
 *
 * ```ts
 * const parsed = schema.safeParse(input, { error: formErrorMap({ holdMinutes: "Giữ chỗ (phút)" }) });
 * if (!parsed.success) return { error: firstIssueMessage(parsed.error, "Kiểm tra lại giúp bạn nhé") };
 * ```
 */
export type FieldLabels = Readonly<Record<string, string>>;

type RawIssue = Parameters<z.core.$ZodErrorMap>[0];

/** Tên ô của một lỗi: khoá chữ CUỐI trong đường dẫn (`rules.2.pricePerSlot` → `pricePerSlot`). */
function labelOf(path: readonly PropertyKey[] | undefined, labels: FieldLabels): string {
  const key = [...(path ?? [])].reverse().find((part) => typeof part === "string");
  return (typeof key === "string" && labels[key]) || "Thông tin vừa nhập";
}

function describe(issue: RawIssue, label: string): string {
  switch (issue.code) {
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") {
        return min <= 1 ? `${label} đang để trống` : `${label} cần ít nhất ${min} ký tự`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return `${label}: chọn ít nhất ${min}`;
      }
      return issue.inclusive === false
        ? `${label} phải lớn hơn ${min}`
        : `${label} phải từ ${min} trở lên`;
    }

    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") return `${label} dài quá — tối đa ${max} ký tự`;
      if (issue.origin === "array" || issue.origin === "set") {
        return `${label}: tối đa ${max} mục`;
      }
      return issue.inclusive === false ? `${label} phải nhỏ hơn ${max}` : `${label} tối đa ${max}`;
    }

    case "invalid_type":
      if (issue.expected === "int") return `${label} phải là số nguyên, không có phần lẻ`;
      if (issue.input === undefined || issue.input === null) return `${label} đang để trống`;
      if (issue.expected === "number") return `${label} phải là một con số`;
      return `${label} không đọc được — tải lại trang rồi thử lại giúp bạn nhé`;

    case "invalid_format":
      return issue.format === "email"
        ? `${label} chưa đúng dạng — ví dụ: ten@gmail.com`
        : `${label} chưa đúng định dạng`;

    // `z.enum(...).or(z.literal(""))` — ô chọn "có thể để trống": giá trị lạ rơi vào đây.
    case "invalid_value":
    case "invalid_union":
      return `${label}: chọn một giá trị trong danh sách`;

    case "not_multiple_of":
      return `${label} phải là bội số của ${issue.divisor}`;

    default:
      return `${label} chưa đúng — kiểm tra lại giúp bạn nhé`;
  }
}

/** Bộ dịch lỗi mặc định của Zod cho MỘT form — xem chú thích đầu tệp. */
export function formErrorMap(labels: FieldLabels): z.core.$ZodErrorMap {
  return (issue) => describe(issue, labelOf(issue.path, labels));
}

/**
 * Câu của lỗi ĐẦU TIÊN — thứ hiện trong hộp báo lỗi của form. Một câu cụ thể
 * dễ sửa hơn một danh sách: sửa xong ô đó, bấm lại, form nói tiếp ô sau.
 */
export function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
