import { describe, expect, it } from "vitest";
import {
  docKhoaNgay,
  gioPhut,
  khoaNgay,
  nhanKhungGio,
  nhanNgay,
  nhanNgayDay,
  themNgay,
} from "./ngay";

/**
 * Máy chủ chạy UTC, trình duyệt chạy giờ máy người dùng. Sai ở tầng này thì
 * React báo lỗi hydration — hoặc tệ hơn, không báo gì mà hiện sai ngày.
 */

describe("khoaNgay", () => {
  it("dùng giờ VN, không dùng giờ máy chủ", () => {
    // 23:30 UTC ngày 03/09 = 06:30 sáng ngày 04/09 giờ VN.
    expect(khoaNgay(new Date("2026-09-03T23:30:00Z"))).toBe("2026-09-04");
    // 16:59 UTC vẫn còn là ngày 03/09 giờ VN (23:59).
    expect(khoaNgay(new Date("2026-09-03T16:59:00Z"))).toBe("2026-09-03");
    // 17:00 UTC là đã sang ngày mới giờ VN.
    expect(khoaNgay(new Date("2026-09-03T17:00:00Z"))).toBe("2026-09-04");
  });
});

describe("docKhoaNgay", () => {
  const now = new Date("2026-09-04T05:00:00Z");

  it("đọc được ngày hợp lệ trên URL", () => {
    expect(khoaNgay(docKhoaNgay("2026-12-25", now))).toBe("2026-12-25");
  });

  it("URL sửa bằng tay không được ra trang lỗi", () => {
    for (const rac of [undefined, "", "hom-nay", "2026-13-45", "31/02/2026", "2026-02-31"]) {
      expect(khoaNgay(docKhoaNgay(rac, now))).toBe("2026-09-04");
    }
  });
});

describe("themNgay", () => {
  it("cộng ngày không rơi sang ngày khác vì lệch múi giờ", () => {
    const start = docKhoaNgay("2026-09-04");
    expect(khoaNgay(themNgay(start, 1))).toBe("2026-09-05");
    expect(khoaNgay(themNgay(start, 7))).toBe("2026-09-11");
    expect(khoaNgay(themNgay(start, -1))).toBe("2026-09-03");
  });

  it("qua ranh giới tháng và năm vẫn đúng", () => {
    expect(khoaNgay(themNgay(docKhoaNgay("2026-09-30"), 1))).toBe("2026-10-01");
    expect(khoaNgay(themNgay(docKhoaNgay("2026-12-31"), 1))).toBe("2027-01-01");
  });

  it("cộng 14 ngày liên tiếp không lệch ngày nào", () => {
    // Dải chọn ngày dựng bằng đúng vòng lặp này; lệch một ngày là khách đặt
    // nhầm sang hôm sau.
    let d = docKhoaNgay("2026-09-04");
    const ra: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      ra.push(khoaNgay(d));
      d = themNgay(d, 1);
    }
    expect(ra[0]).toBe("2026-09-04");
    expect(ra[13]).toBe("2026-09-17");
    expect(new Set(ra).size).toBe(14); // không trùng ngày nào
  });
});

describe("nhãn hiển thị", () => {
  it("nhanNgay ra đúng thứ theo giờ VN", () => {
    // 04/09/2026 là thứ Sáu.
    expect(nhanNgay(docKhoaNgay("2026-09-04"))).toEqual({ thu: "Thứ 6", ngay: "04/09" });
    expect(nhanNgay(docKhoaNgay("2026-09-06")).thu).toBe("Chủ nhật");
  });

  it("nhanNgayDay ghi đủ để không nhầm ngày", () => {
    expect(nhanNgayDay(docKhoaNgay("2026-09-04"))).toBe("Thứ 6, 04/09/2026");
  });

  it("nhanKhungGio đệm số 0", () => {
    expect(nhanKhungGio(19 * 60, 21 * 60)).toBe("19:00 – 21:00");
    expect(nhanKhungGio(6 * 60 + 30, 7 * 60)).toBe("06:30 – 07:00");
  });

  it("gioPhut đọc theo giờ VN", () => {
    expect(gioPhut(new Date("2026-09-04T12:00:00Z"))).toBe("19:00");
  });
});
