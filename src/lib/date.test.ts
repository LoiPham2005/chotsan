import { describe, expect, it } from "vitest";
import {
  parseDateKey,
  timeOfDay,
  dateKey,
  timeRangeLabel,
  dayLabel,
  fullDateLabel,
  addDays,
} from "./date";

/**
 * Máy chủ chạy UTC, trình duyệt chạy giờ máy người dùng. Sai ở tầng này thì
 * React báo lỗi hydration — hoặc tệ hơn, không báo gì mà hiện sai ngày.
 */

describe("dateKey", () => {
  it("dùng giờ VN, không dùng giờ máy chủ", () => {
    // 23:30 UTC ngày 03/09 = 06:30 sáng ngày 04/09 giờ VN.
    expect(dateKey(new Date("2026-09-03T23:30:00Z"))).toBe("2026-09-04");
    // 16:59 UTC vẫn còn là ngày 03/09 giờ VN (23:59).
    expect(dateKey(new Date("2026-09-03T16:59:00Z"))).toBe("2026-09-03");
    // 17:00 UTC là đã sang ngày mới giờ VN.
    expect(dateKey(new Date("2026-09-03T17:00:00Z"))).toBe("2026-09-04");
  });
});

describe("parseDateKey", () => {
  const now = new Date("2026-09-04T05:00:00Z");

  it("đọc được ngày hợp lệ trên URL", () => {
    expect(dateKey(parseDateKey("2026-12-25", now))).toBe("2026-12-25");
  });

  it("URL sửa bằng tay không được ra trang lỗi", () => {
    for (const rac of [undefined, "", "hom-nay", "2026-13-45", "31/02/2026", "2026-02-31"]) {
      expect(dateKey(parseDateKey(rac, now))).toBe("2026-09-04");
    }
  });
});

describe("addDays", () => {
  it("cộng ngày không rơi sang ngày khác vì lệch múi giờ", () => {
    const start = parseDateKey("2026-09-04");
    expect(dateKey(addDays(start, 1))).toBe("2026-09-05");
    expect(dateKey(addDays(start, 7))).toBe("2026-09-11");
    expect(dateKey(addDays(start, -1))).toBe("2026-09-03");
  });

  it("qua ranh giới tháng và năm vẫn đúng", () => {
    expect(dateKey(addDays(parseDateKey("2026-09-30"), 1))).toBe("2026-10-01");
    expect(dateKey(addDays(parseDateKey("2026-12-31"), 1))).toBe("2027-01-01");
  });

  it("cộng 14 ngày liên tiếp không lệch ngày nào", () => {
    // Dải chọn ngày dựng bằng đúng vòng lặp này; lệch một ngày là khách đặt
    // nhầm sang hôm sau.
    let d = parseDateKey("2026-09-04");
    const ra: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      ra.push(dateKey(d));
      d = addDays(d, 1);
    }
    expect(ra[0]).toBe("2026-09-04");
    expect(ra[13]).toBe("2026-09-17");
    expect(new Set(ra).size).toBe(14); // không trùng ngày nào
  });
});

describe("nhãn hiển thị", () => {
  it("dayLabel ra đúng thứ theo giờ VN", () => {
    // 04/09/2026 là thứ Sáu.
    expect(dayLabel(parseDateKey("2026-09-04"))).toEqual({ weekday: "Thứ 6", dayMonth: "04/09" });
    expect(dayLabel(parseDateKey("2026-09-06")).weekday).toBe("Chủ nhật");
  });

  it("fullDateLabel ghi đủ để không nhầm ngày", () => {
    expect(fullDateLabel(parseDateKey("2026-09-04"))).toBe("Thứ 6, 04/09/2026");
  });

  it("timeRangeLabel đệm số 0", () => {
    expect(timeRangeLabel(19 * 60, 21 * 60)).toBe("19:00 – 21:00");
    expect(timeRangeLabel(6 * 60 + 30, 7 * 60)).toBe("06:30 – 07:00");
  });

  it("timeOfDay đọc theo giờ VN", () => {
    expect(timeOfDay(new Date("2026-09-04T12:00:00Z"))).toBe("19:00");
  });
});
