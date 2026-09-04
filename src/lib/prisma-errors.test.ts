import { describe, expect, it } from "vitest";
import { isExclusionViolation, isUniqueViolation } from "./prisma-errors";

/**
 * Các lỗi trong tệp này được CHÉP NGUYÊN từ database thật (Postgres 17 qua
 * Neon, Prisma 7.9 + driver adapter pg), không phải bịa ra.
 *
 * Đó là toàn bộ giá trị của tệp: bản trước đây dò bằng `error.message` và
 * `meta.đích` — cả hai đều đúng theo tài liệu Prisma cũ, và cả hai đều KHÔNG
 * khớp với lỗi thật của Prisma 7. Nhánh bắt lỗi không bao giờ chạy, mà không
 * có gì báo: lỗi chỉ bung lên thành 500 khi có hai người bấm cùng lúc.
 */

/** Chép nguyên từ `db.payment.create()` khi vi phạm chỉ số partial unique. */
function loiTrungGiaoDich() {
  return Object.assign(
    new Error(
      "\nInvalid `db.payment.create()` invocation:\n\n" +
        "Unique constraint failed on the fields: (`booking_id`)",
    ),
    {
      code: "P2002",
      meta: {
        modelName: "Payment",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage:
              'duplicate key value violates unique constraint "payments_mot_giao_dich_song_cho_moi_booking"',
            kind: "UniqueConstraintViolation",
            constraint: { fields: ["booking_id"] },
          },
        },
      },
    },
  );
}

function loiTrungSuKien() {
  return Object.assign(
    new Error("Unique constraint failed on the fields: (`provider`,`external_event_id`)"),
    {
      code: "P2002",
      meta: {
        modelName: "PaymentEvent",
        driverAdapterError: {
          cause: {
            originalCode: "23505",
            originalMessage:
              'duplicate key value violates unique constraint "payment_events_provider_external_event_id_key"',
            constraint: { fields: ["provider", "external_event_id"] },
          },
        },
      },
    },
  );
}

/** Lỗi ràng buộc EXCLUDE — Prisma không ánh xạ 23P01 thành mã P2xxx nào. */
function loiTrungKhungGio() {
  return Object.assign(
    new Error(
      'conflicting key value violates exclusion constraint "bookings_khong_trung_khung_gio"',
    ),
    {
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "23P01",
            originalMessage:
              'conflicting key value violates exclusion constraint "bookings_khong_trung_khung_gio"',
          },
        },
      },
    },
  );
}

describe("isUniqueViolation", () => {
  it("nhận ra tên ràng buộc dù nó chỉ nằm trong meta, KHÔNG nằm trong message", () => {
    const error = loiTrungGiaoDich();

    // Chứng minh vì sao cần tệp này: dò kiểu cũ không khớp.
    expect(error.message.includes("payments_mot_giao_dich_song_cho_moi_booking")).toBe(false);
    expect(isUniqueViolation(error, "payments_mot_giao_dich_song_cho_moi_booking")).toBe(true);
  });

  it("nhận ra theo TÊN CỘT, kể cả khi meta.target không tồn tại", () => {
    // `meta.đích` là thứ mọi ví dụ trên mạng dùng, và Prisma 7 không có nó —
    // TypeScript cũng từ chối `error.meta.đích` trên hình dạng lỗi thật.
    const error = loiTrungGiaoDich();

    expect("target" in error.meta).toBe(false);
    expect(isUniqueViolation(error, "booking_id")).toBe(true);
  });

  it("nhận ra cột trong ràng buộc nhiều cột", () => {
    expect(isUniqueViolation(loiTrungSuKien(), "external_event_id")).toBe(true);
    expect(isUniqueViolation(loiTrungSuKien(), "provider")).toBe(true);
  });

  it("không truyền tên thì chỉ hỏi 'có phải trùng khoá không'", () => {
    expect(isUniqueViolation(loiTrungGiaoDich())).toBe(true);
    expect(isUniqueViolation(new Error("Can't reach database server"))).toBe(false);
  });

  it("KHÔNG khớp nhầm ràng buộc khác — đó là nuốt lỗi thật", () => {
    expect(isUniqueViolation(loiTrungSuKien(), "merchant_ref")).toBe(false);
    expect(isUniqueViolation(loiTrungGiaoDich(), "external_event_id")).toBe(false);
  });

  it("lỗi trùng khung giờ KHÔNG phải lỗi trùng khoá", () => {
    expect(isUniqueViolation(loiTrungKhungGio())).toBe(false);
  });

  it("không phải Error thì trả false, không ném thêm lỗi", () => {
    expect(isUniqueViolation("P2002")).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("isExclusionViolation", () => {
  it("nhận ra 23P01 kèm đúng tên ràng buộc", () => {
    expect(isExclusionViolation(loiTrungKhungGio(), "bookings_khong_trung_khung_gio")).toBe(true);
    expect(isExclusionViolation(loiTrungKhungGio())).toBe(true);
  });

  it("nhận ra cả khi lỗi tới dưới dạng thô, chỉ có chuỗi thông điệp", () => {
    // Tuỳ đường đi, lỗi có thể mất hết meta — vẫn phải nhận ra.
    expect(isExclusionViolation(new Error("... (code: 23P01) ..."))).toBe(true);
  });

  it("KHÔNG nhận nhầm lỗi trùng khoá thành lỗi trùng khung giờ", () => {
    // Nhầm chỗ này là khách bấm hai lần bị báo 'khung giờ vừa có người đặt mất'.
    expect(isExclusionViolation(loiTrungGiaoDich())).toBe(false);
  });

  it("tên ràng buộc khác thì không khớp", () => {
    expect(isExclusionViolation(loiTrungKhungGio(), "rang_buoc_khac")).toBe(false);
  });
});
