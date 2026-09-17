import { describe, expect, it } from "vitest";
import type { DayAvailability, SlotStatus } from "@/services/availability.service";
import { firstBookableMinute, keepFreeSlots, slotKey, visibleMinutes } from "./slot-grid";

/**
 * Lưới tự cuộn tới khung đầu tiên còn đặt được.
 *
 * Sân mở 05:30 nhưng người mở trang lúc 3 giờ chiều thì phần đầu lưới toàn ô
 * "Đã qua" — họ phải tự cuộn qua mười mấy cột mới thấy thứ mua được.
 */

/** Ngày mở 06:00–22:00; mọi khung trước `tuPhut` mang trạng thái `truoc`. */
function dungNgay(tuPhut: number, truoc: SlotStatus = "PAST", soSan = 1): DayAvailability {
  const minutes: number[] = [];
  for (let m = 6 * 60; m < 22 * 60; m += 30) minutes.push(m);

  return {
    venueId: "v1",
    date: "2026-09-04",
    minutes,
    summary: minutes.map(() => 1),
    isClosed: false,
    courts: Array.from({ length: soSan }, (_, index) => ({
      courtId: `c${index + 1}`,
      courtName: `Sân ${index + 1}`,
      slots: minutes.map((minute) => ({
        minute,
        status: minute < tuPhut ? truoc : "FREE",
        price: 70_000,
        isPeak: false,
      })),
    })),
  };
}

describe("firstBookableMinute", () => {
  it("ngày tương lai còn trống từ đầu thì là giờ mở cửa", () => {
    expect(firstBookableMinute(dungNgay(0))).toBe(6 * 60);
  });

  it("hôm nay đã qua nửa ngày thì là khung đầu tiên chưa qua", () => {
    expect(firstBookableMinute(dungNgay(15 * 60))).toBe(15 * 60);
  });

  it("sân bảo trì cả buổi sáng cũng bỏ qua, không chỉ giờ đã trôi", () => {
    expect(firstBookableMinute(dungNgay(14 * 60 + 30, "CLOSED"))).toBe(14 * 60 + 30);
  });

  it("hết sạch chỗ thì null — không cuộn lung tung", () => {
    expect(firstBookableMinute(dungNgay(24 * 60, "TAKEN"))).toBeNull();
  });

  it("chỉ cần MỘT sân còn trống là tính", () => {
    const day = dungNgay(20 * 60, "TAKEN", 2);
    // Sân 2 trống từ 08:00 dù sân 1 kín tới 20:00.
    day.courts[1]!.slots = day.courts[1]!.slots.map((slot) => ({
      ...slot,
      status: slot.minute >= 8 * 60 ? "FREE" : "TAKEN",
    }));

    expect(firstBookableMinute(day)).toBe(8 * 60);
  });
});

describe("visibleMinutes — ẩn khung đã qua", () => {
  it("ẩn dải đầu ngày mà mọi sân đều đã qua giờ", () => {
    // Mở lúc 10 giờ: 8 khung 06:00–09:30 là một bức tường "Đã qua" không ai cần.
    const { minutes, hidden } = visibleMinutes(dungNgay(10 * 60));
    expect(hidden).toBe(8);
    expect(minutes[0]).toBe(10 * 60);
  });

  it("ngày tương lai không ẩn gì", () => {
    expect(visibleMinutes(dungNgay(0)).hidden).toBe(0);
  });

  it("KHÔNG ẩn khung bảo trì hay đã đặt — chỉ ẩn khung đã qua giờ", () => {
    // Sân kín cả buổi sáng vẫn phải hiện: người dùng cần thấy "đã có người".
    expect(visibleMinutes(dungNgay(12 * 60, "TAKEN")).hidden).toBe(0);
    expect(visibleMinutes(dungNgay(12 * 60, "CLOSED")).hidden).toBe(0);
  });

  it("hết giờ trong ngày thì không còn cột nào", () => {
    expect(visibleMinutes(dungNgay(24 * 60)).minutes).toEqual([]);
  });
});

describe("slotKey", () => {
  it("khác sân hoặc khác giờ thì khác khoá", () => {
    expect(slotKey("c1", 1080)).not.toBe(slotKey("c2", 1080));
    expect(slotKey("c1", 1080)).not.toBe(slotKey("c1", 1110));
  });
});

describe("keepFreeSlots", () => {
  it("giữ ô còn trống kèm giá, bỏ ô đã có người đặt trong lúc khách đăng nhập", () => {
    const day = dungNgay(0, "PAST", 2);
    day.courts[1]!.slots = day.courts[1]!.slots.map((slot) =>
      slot.minute === 18 * 60 ? { ...slot, status: "TAKEN" } : slot,
    );

    const picked = keepFreeSlots(day, [
      { courtId: "c1", minute: 18 * 60 },
      { courtId: "c2", minute: 18 * 60 },
    ]);

    expect(picked).toEqual({
      [slotKey("c1", 18 * 60)]: { courtId: "c1", minute: 18 * 60, price: 70_000 },
    });
  });

  it("sân không thuộc cơ sở này hoặc giờ ngoài lịch thì bỏ — URL là do người ngoài viết", () => {
    const day = dungNgay(0);
    expect(keepFreeSlots(day, [{ courtId: "san-la", minute: 18 * 60 }])).toEqual({});
    expect(keepFreeSlots(day, [{ courtId: "c1", minute: 3 * 60 }])).toEqual({});
  });
});
