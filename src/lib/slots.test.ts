import { describe, expect, it } from "vitest";
import {
  atMinuteVN,
  countSlots,
  formatHhMm,
  formatVnd,
  formatVndShort,
  groupConsecutive,
  isSlotAligned,
  minuteOfDayInVN,
  overlaps,
  parseHhMm,
  slotRange,
  weekdayInVN,
} from "./slots";

/**
 * Lệch một khung 30 phút nghĩa là bán trùng chỗ hoặc tính sai tiền, nên file
 * này được test dày hơn hẳn phần còn lại.
 */

describe("parseHhMm / formatHhMm", () => {
  it("đọc và ghi lại ra đúng chuỗi ban đầu", () => {
    for (const value of ["00:00", "06:30", "18:00", "23:30"]) {
      expect(formatHhMm(parseHhMm(value)!)).toBe(value);
    }
  });

  it("chấp nhận giờ một chữ số", () => {
    expect(parseHhMm("6:30")).toBe(390);
  });

  it("từ chối chuỗi sai thay vì đoán bừa", () => {
    for (const value of ["24:00", "12:60", "abc", "12", "12:3", ""]) {
      expect(parseHhMm(value)).toBeNull();
    }
  });
});

describe("slotRange", () => {
  it("khung cuối kết thúc ĐÚNG lúc đóng cửa, không lố ra ngoài", () => {
    // Sân mở 06:00–08:00 có đúng 4 khung; khung cuối 07:30–08:00.
    expect(slotRange(360, 480)).toEqual([360, 390, 420, 450]);
  });

  it("không sinh khung nào khi khoảng ngắn hơn 30 phút", () => {
    expect(slotRange(360, 380)).toEqual([]);
    expect(slotRange(360, 360)).toEqual([]);
  });

  it("làm tròn LÊN mốc bắt đầu về khung hợp lệ", () => {
    // Sân mở 06:10 thì khung đầu là 06:30 — không bán nửa khung.
    expect(slotRange(370, 480)).toEqual([390, 420, 450]);
  });

  it("trả rỗng cho khoảng ngược", () => {
    expect(slotRange(480, 360)).toEqual([]);
  });
});

describe("overlaps", () => {
  it("hai lượt đặt LIỀN KỀ không tính là trùng", () => {
    // Đây là chỗ dùng `<=` là chặn nhầm mọi lượt nối tiếp nhau.
    expect(overlaps(1080, 1140, 1140, 1200)).toBe(false);
  });

  it("bắt được mọi kiểu chồng lấn", () => {
    expect(overlaps(1080, 1200, 1140, 1260)).toBe(true); // gối đuôi
    expect(overlaps(1080, 1200, 1020, 1140)).toBe(true); // gối đầu
    expect(overlaps(1080, 1200, 1110, 1140)).toBe(true); // nằm gọn bên trong
    expect(overlaps(1110, 1140, 1080, 1200)).toBe(true); // bao trọn
  });
});

describe("countSlots", () => {
  it("đếm đúng số khung 30 phút", () => {
    expect(countSlots(1080, 1200)).toBe(4); // 18:00–20:00
    expect(countSlots(1080, 1110)).toBe(1);
  });

  it("làm tròn LÊN khi lẻ nửa khung", () => {
    // Thà tính dư một khung còn hơn tính thiếu tiền của chủ sân.
    expect(countSlots(1080, 1100)).toBe(1);
    expect(countSlots(1080, 1145)).toBe(3);
  });

  it("không trả số âm", () => {
    expect(countSlots(1200, 1080)).toBe(0);
  });
});

describe("groupConsecutive", () => {
  it("gộp các khung liền nhau thành một khối", () => {
    // Màn chủ sân vẽ lượt đặt thành MỘT khối liền, không lặp tên qua từng ô.
    expect(groupConsecutive([1080, 1110, 1140])).toEqual([{ start: 1080, end: 1170 }]);
  });

  it("tách khi có khoảng hở", () => {
    expect(groupConsecutive([1080, 1110, 1200])).toEqual([
      { start: 1080, end: 1140 },
      { start: 1200, end: 1230 },
    ]);
  });

  it("không phụ thuộc thứ tự đầu vào và bỏ trùng lặp", () => {
    expect(groupConsecutive([1110, 1080, 1110])).toEqual([{ start: 1080, end: 1140 }]);
  });

  it("mảng rỗng cho mảng rỗng", () => {
    expect(groupConsecutive([])).toEqual([]);
  });
});

describe("múi giờ Việt Nam", () => {
  /**
   * Bài test quan trọng nhất của file này.
   *
   * `date.getHours()` đọc theo múi giờ MÁY CHỦ. Container chạy UTC thì 19:00
   * giờ Việt Nam thành 12:00 và lịch sân lệch 7 tiếng — lỗi chỉ lộ ra sau khi
   * deploy, không bao giờ thấy trên máy dev.
   */
  it("đọc đúng giờ Việt Nam bất kể múi giờ máy chủ", () => {
    // 12:00 UTC = 19:00 giờ Việt Nam.
    expect(minuteOfDayInVN(new Date("2026-09-04T12:00:00Z"))).toBe(19 * 60);
    // 17:00 UTC = 00:00 hôm sau ở Việt Nam.
    expect(minuteOfDayInVN(new Date("2026-09-04T17:00:00Z"))).toBe(0);
  });

  it("thứ trong tuần cũng theo giờ Việt Nam", () => {
    // 04/09/2026 là thứ Sáu (getDay = 5).
    expect(weekdayInVN(new Date("2026-09-04T10:00:00Z"))).toBe(5); // 17:00 VN, vẫn thứ Sáu
    // 17:00 UTC đã là 00:00 hôm sau ở Việt Nam — sang thứ Bảy.
    expect(weekdayInVN(new Date("2026-09-04T17:00:00Z"))).toBe(6);
  });

  it("atMinuteVN dựng đúng mốc tuyệt đối", () => {
    const at = atMinuteVN(new Date("2026-09-04T03:00:00Z"), 19 * 60);
    // 19:00 giờ Việt Nam = 12:00 UTC.
    expect(at.toISOString()).toBe("2026-09-04T12:00:00.000Z");
  });

  it("đi vòng minuteOfDayInVN → atMinuteVN ra lại chính nó", () => {
    const original = new Date("2026-09-04T12:30:00Z");
    const minute = minuteOfDayInVN(original);

    expect(atMinuteVN(original, minute).toISOString()).toBe(original.toISOString());
  });
});

describe("định dạng tiền", () => {
  it("dạng đầy đủ có dấu chấm ngăn nghìn", () => {
    expect(formatVnd(180000)).toBe("180.000đ");
    expect(formatVnd(1500000)).toBe("1.500.000đ");
    expect(formatVnd(0)).toBe("0đ");
  });

  it("dạng rút gọn cho ô hẹp trong lưới", () => {
    expect(formatVndShort(90000)).toBe("90k");
    expect(formatVndShort(180000)).toBe("180k");
    expect(formatVndShort(1500000)).toBe("1.5tr");
    expect(formatVndShort(2000000)).toBe("2tr");
    expect(formatVndShort(500)).toBe("500");
  });
});

describe("isSlotAligned", () => {
  it("chỉ chấp nhận phút 0 và 30", () => {
    expect(isSlotAligned(1080)).toBe(true);
    expect(isSlotAligned(1110)).toBe(true);
    expect(isSlotAligned(1095)).toBe(false);
    expect(isSlotAligned(1080.5)).toBe(false);
  });
});
