import { describe, expect, it } from "vitest";
import {
  BANK_BINS,
  buildVietQrPayload,
  sanitizeTransferNote,
  transferNoteForBooking,
} from "./vietqr";

/**
 * QR sai một bit thì vẫn hiện ra bình thường nhưng mọi app ngân hàng đều từ
 * chối quét, và không có thông báo lỗi nào để lần ra. Vì vậy test ở đây kiểm
 * từng khối của chuỗi chứ không chỉ kiểm "có trả về chuỗi không".
 */

const VCB = BANK_BINS.VCB!;

/**
 * Tách chuỗi thành các khối TLV ở TẦNG TRÊN CÙNG.
 *
 * Kiểm bằng `toContain("54")` là sai: "54" xuất hiện cả trong các byte độ dài
 * của khối khác. Phải đọc đúng cấu trúc mới biết trường số tiền có mặt không.
 */
function topLevelTags(payload: string): Record<string, string> {
  const tags: Record<string, string> = {};
  let index = 0;

  while (index + 4 <= payload.length) {
    const id = payload.slice(index, index + 2);
    const length = Number(payload.slice(index + 2, index + 4));
    if (!Number.isFinite(length)) break;

    tags[id] = payload.slice(index + 4, index + 4 + length);
    index += 4 + length;
  }

  return tags;
}

describe("buildVietQrPayload", () => {
  it("dựng đủ các khối bắt buộc theo đặc tả EMVCo", () => {
    const payload = buildVietQrPayload({
      bankBin: VCB,
      accountNumber: "1234567890",
      amount: 360_000,
      transferNote: "CS 8F3K2",
    })!;

    expect(payload).not.toBeNull();
    expect(payload.startsWith("000201")).toBe(true); // phiên bản
    expect(payload).toContain("010212"); // QR dùng một lần
    expect(payload).toContain("A000000727"); // định danh NAPAS
    expect(payload).toContain(VCB);
    expect(payload).toContain("1234567890");
    expect(payload).toContain("5303704"); // VND
    expect(payload).toContain("5406360000"); // số tiền
    expect(payload).toContain("5802VN");
    expect(payload).toContain("CS 8F3K2");
  });

  it("CRC nằm ở 4 ký tự cuối và tính trên chuỗi ĐÃ gồm '6304'", () => {
    // Đây là chỗ hay làm sai nhất khi tự viết: tính CRC trước khi nối "6304".
    const payload = buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890" })!;

    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
    expect(payload.length).toBeGreaterThan(40);
  });

  it("đổi một ký tự thì CRC phải khác — nếu không thì CRC vô dụng", () => {
    const a = buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890", amount: 100_000 })!;
    const b = buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567891", amount: 100_000 })!;

    expect(a.slice(-4)).not.toBe(b.slice(-4));
  });

  it("bỏ số tiền thì QR thành loại dùng nhiều lần, khách tự nhập", () => {
    const withAmount = topLevelTags(
      buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890", amount: 360_000 })!,
    );
    const without = topLevelTags(
      buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890" })!,
    );

    expect(withAmount["01"]).toBe("12"); // dùng một lần
    expect(withAmount["54"]).toBe("360000");

    expect(without["01"]).toBe("11"); // dùng nhiều lần
    expect(without["54"]).toBeUndefined();
  });

  it("khối con của NAPAS chứa đúng BIN và số tài khoản", () => {
    const tags = topLevelTags(buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890" })!);

    expect(tags["38"]).toContain("A000000727");
    expect(tags["38"]).toContain(VCB);
    expect(tags["38"]).toContain("1234567890");
    expect(tags["38"]).toContain("QRIBFTTA"); // chuyển khoản tới tài khoản
    expect(tags["53"]).toBe("704");
    expect(tags["58"]).toBe("VN");
  });

  /**
   * Dựng một QR sai còn tệ hơn không dựng: khách quét, chuyển tiền vào tài
   * khoản không tồn tại, rồi mới phát hiện.
   */
  it("trả null thay vì dựng QR hỏng khi dữ liệu sai", () => {
    expect(buildVietQrPayload({ bankBin: "", accountNumber: "1234567890" })).toBeNull();
    expect(buildVietQrPayload({ bankBin: "97043", accountNumber: "1234567890" })).toBeNull(); // 5 số
    expect(buildVietQrPayload({ bankBin: VCB, accountNumber: "" })).toBeNull();
    expect(buildVietQrPayload({ bankBin: VCB, accountNumber: "abc" })).toBeNull();
    expect(buildVietQrPayload({ bankBin: VCB, accountNumber: "123" })).toBeNull(); // quá ngắn
    expect(buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890", amount: 0 })).toBeNull();
    expect(
      buildVietQrPayload({ bankBin: VCB, accountNumber: "1234567890", amount: -5 }),
    ).toBeNull();
  });
});

describe("sanitizeTransferNote", () => {
  it("bỏ dấu tiếng Việt — nhiều app ngân hàng cắt cụt nội dung có dấu", () => {
    // Mã đặt sân bị cắt là tiền vào tài khoản mà không ai biết của lượt nào.
    expect(sanitizeTransferNote("Đặt sân CS8F3K2")).toBe("Dat san CS8F3K2");
    expect(sanitizeTransferNote("Nguyễn Văn A")).toBe("Nguyen Van A");
  });

  it("bỏ ký tự đặc biệt, giữ chữ và số", () => {
    expect(sanitizeTransferNote("CS-8F3/K2 #abc")).toBe("CS8F3K2 abc");
  });

  it("cắt còn 25 ký tự — trần an toàn của phần lớn app ngân hàng", () => {
    expect(sanitizeTransferNote("A".repeat(60))).toHaveLength(25);
  });
});

describe("transferNoteForBooking", () => {
  it("dựng mã đối soát từ mã đặt sân", () => {
    expect(transferNoteForBooking("8F3K2")).toBe("CS 8F3K2");
  });
});
