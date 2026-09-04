import { describe, expect, it } from "vitest";
import type { DayAvailability, SlotStatus } from "@/services/availability.service";

/**
 * Lưới mở ở giờ nào.
 *
 * Sân mở 05:30 nhưng người mở trang lúc 3 giờ chiều thì trang đầu toàn ô xám
 * của khung đã trôi qua — họ phải bấm "Muộn hơn" hai lần mới thấy thứ mua
 * được. Đây là phép tính quyết định chuyện đó, tách ra để kiểm được mà không
 * phải dựng cả React.
 */
function firstBookablePage(day: DayAvailability, hoursPerPage: number): number {
  const grouped = new Map<number, number[]>();
  for (const minute of day.minutes) {
    const hour = Math.floor(minute / 60);
    grouped.set(hour, [...(grouped.get(hour) ?? []), minute]);
  }
  const hours = [...grouped.entries()].map(([hour, minutes]) => ({ hour, minutes }));

  const conBan = hours.findIndex((group) =>
    group.minutes.some((minute) =>
      day.courts.some(
        (court) => court.slots.find((slot) => slot.minute === minute)?.status === "FREE",
      ),
    ),
  );

  if (conBan <= 0) return 0;
  return Math.min(Math.max(0, conBan - 1), Math.max(0, hours.length - hoursPerPage));
}

/** Ngày mở 06:00–22:00; mọi khung trước `tuPhut` là đã trôi qua. */
function dungNgay(tuPhut: number, status: SlotStatus = "PAST"): DayAvailability {
  const minutes: number[] = [];
  for (let m = 6 * 60; m < 22 * 60; m += 30) minutes.push(m);

  return {
    venueId: "v1",
    date: "2026-09-04",
    minutes,
    summary: minutes.map(() => 1),
    isClosed: false,
    courts: [
      {
        courtId: "c1",
        courtName: "Sân 1",
        slots: minutes.map((minute) => ({
          minute,
          status: minute < tuPhut ? status : "FREE",
          price: 70_000,
          isPeak: false,
        })),
      },
    ],
  };
}

describe("lưới mở ở giờ nào", () => {
  it("ngày tương lai còn trống từ đầu thì mở ở giờ mở cửa", () => {
    expect(firstBookablePage(dungNgay(0), 7)).toBe(0);
  });

  it("hôm nay đã qua nửa ngày thì nhảy tới gần giờ còn bán được", () => {
    // Đã qua tới 15:00. Giờ đầu còn bán là 15 (chỉ số 9 tính từ 06:00).
    // Lùi một giờ để thấy bối cảnh → 8.
    expect(firstBookablePage(dungNgay(15 * 60), 7)).toBe(8);
  });

  it("không nhảy quá cuối dải — trang cuối vẫn đủ số cột", () => {
    // Chỉ còn khung 21:30. 16 giờ tổng cộng, 7 giờ mỗi trang → trần là 9.
    expect(firstBookablePage(dungNgay(21 * 60 + 30), 7)).toBe(9);
  });

  it("hết sạch chỗ thì về đầu chứ không nhảy lung tung", () => {
    // `findIndex` trả -1 khi không còn ô FREE nào.
    expect(firstBookablePage(dungNgay(24 * 60), 7)).toBe(0);
  });

  it("sân bảo trì cả buổi sáng cũng nhảy qua, không chỉ giờ đã trôi qua", () => {
    expect(firstBookablePage(dungNgay(14 * 60, "CLOSED"), 7)).toBe(7);
  });
});
