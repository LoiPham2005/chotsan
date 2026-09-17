import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DayAvailability, DayTiming, SlotStatus } from "@/services/availability.service";
import {
  firstBookableMinute,
  keepFreeSlots,
  SlotGrid,
  slotAriaLabel,
  slotKey,
  visibleMinutes,
} from "./slot-grid";

/**
 * Lưới tự cuộn tới khung đầu tiên còn đặt được.
 *
 * Sân mở 05:30 nhưng người mở trang lúc 3 giờ chiều thì phần đầu lưới toàn ô
 * "Đã qua" — họ phải tự cuộn qua mười mấy cột mới thấy thứ mua được.
 */

/** Ngày mở 06:00–22:00; mọi khung trước `fromMinute` mang trạng thái `before`. */
function buildDay(
  fromMinute: number,
  before: SlotStatus = "PAST",
  courtCount = 1,
  timing: DayTiming = "TODAY",
): DayAvailability {
  const minutes: number[] = [];
  for (let m = 6 * 60; m < 22 * 60; m += 30) minutes.push(m);

  return {
    venueId: "v1",
    date: "2026-09-04",
    timing,
    minutes,
    summary: minutes.map(() => 1),
    isClosed: false,
    courts: Array.from({ length: courtCount }, (_, index) => ({
      courtId: `c${index + 1}`,
      courtName: `Sân ${index + 1}`,
      slots: minutes.map((minute) => ({
        minute,
        status: minute < fromMinute ? before : "FREE",
        price: 70_000,
        isPeak: false,
      })),
    })),
  };
}

function renderGrid(day: DayAvailability) {
  return render(
    <SlotGrid day={day} selected={new Set()} axis="court-rows" onAxisChange={() => {}} />,
  );
}

describe("firstBookableMinute", () => {
  it("ngày tương lai còn trống từ đầu thì là giờ mở cửa", () => {
    expect(firstBookableMinute(buildDay(0))).toBe(6 * 60);
  });

  it("hôm nay đã qua nửa ngày thì là khung đầu tiên chưa qua", () => {
    expect(firstBookableMinute(buildDay(15 * 60))).toBe(15 * 60);
  });

  it("sân bảo trì cả buổi sáng cũng bỏ qua, không chỉ giờ đã trôi", () => {
    expect(firstBookableMinute(buildDay(14 * 60 + 30, "CLOSED"))).toBe(14 * 60 + 30);
  });

  it("khung chưa mở bán cũng bỏ qua — cuộn tới chỗ mua được", () => {
    expect(firstBookableMinute(buildDay(17 * 60, "NOT_FOR_SALE"))).toBe(17 * 60);
  });

  it("hết sạch chỗ thì null — không cuộn lung tung", () => {
    expect(firstBookableMinute(buildDay(24 * 60, "TAKEN"))).toBeNull();
  });

  it("chỉ cần MỘT sân còn trống là tính", () => {
    const day = buildDay(20 * 60, "TAKEN", 2);
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
    const { minutes, hidden } = visibleMinutes(buildDay(10 * 60));
    expect(hidden).toBe(8);
    expect(minutes[0]).toBe(10 * 60);
  });

  it("ngày tương lai không ẩn gì", () => {
    expect(visibleMinutes(buildDay(0)).hidden).toBe(0);
  });

  it("KHÔNG ẩn khung bảo trì, đã đặt hay chưa mở bán — chỉ ẩn khung đã qua giờ", () => {
    // Sân kín cả buổi sáng vẫn phải hiện: người dùng cần thấy "đã có người".
    expect(visibleMinutes(buildDay(12 * 60, "TAKEN")).hidden).toBe(0);
    expect(visibleMinutes(buildDay(12 * 60, "CLOSED")).hidden).toBe(0);
    expect(visibleMinutes(buildDay(12 * 60, "NOT_FOR_SALE")).hidden).toBe(0);
  });

  it("hết giờ trong ngày thì không còn cột nào", () => {
    expect(visibleMinutes(buildDay(24 * 60)).minutes).toEqual([]);
  });
});

describe("SlotGrid — lưới trống nói đúng chuyện", () => {
  /**
   * Lỗi thật trước đây: mở ngày đã qua thì mọi cột bị ẩn và lưới báo "Hôm nay
   * đã hết giờ đặt" — cho một ngày của tuần trước.
   */
  it("NGÀY ĐÃ QUA thì nói 'Ngày này đã qua', không nói 'Hôm nay đã hết giờ'", () => {
    renderGrid(buildDay(24 * 60, "PAST", 1, "PAST"));

    expect(screen.getByText("Ngày này đã qua")).toBeInTheDocument();
    expect(screen.queryByText("Hôm nay đã hết giờ đặt")).not.toBeInTheDocument();
  });

  it("HÔM NAY đã hết khung thì mới nói 'Hôm nay đã hết giờ đặt'", () => {
    renderGrid(buildDay(24 * 60, "PAST", 1, "TODAY"));

    expect(screen.getByText("Hôm nay đã hết giờ đặt")).toBeInTheDocument();
  });

  it("ô chưa mở bán không bấm được và không đọc ra giá", () => {
    renderGrid(buildDay(7 * 60, "NOT_FOR_SALE", 1, "FUTURE"));

    const cell = screen.getByRole("button", { name: /Sân 1 06:00–06:30/ });
    expect(cell).toBeDisabled();
    expect(cell).toHaveAccessibleName("Sân 1 06:00–06:30 — chưa mở bán");
  });
});

describe("slotAriaLabel", () => {
  it("ô còn trống đọc kèm giá", () => {
    expect(slotAriaLabel("Sân 1", 18 * 60, { status: "FREE", price: 70_000 }, false)).toBe(
      "Sân 1 18:00–18:30 — còn trống, 70k",
    );
  });

  it("KHÔNG BAO GIỜ đọc ', 0' — giá 0 không phải giá", () => {
    expect(slotAriaLabel("Sân 1", 18 * 60, { status: "FREE", price: 0 }, false)).not.toContain(
      ", 0",
    );
    expect(slotAriaLabel("Sân 1", 18 * 60, { status: "NOT_FOR_SALE", price: 0 }, false)).toBe(
      "Sân 1 18:00–18:30 — chưa mở bán",
    );
  });

  it("ô đã có người hay đã qua không đọc giá", () => {
    expect(slotAriaLabel("Sân 1", 18 * 60, { status: "TAKEN", price: 70_000 }, false)).toBe(
      "Sân 1 18:00–18:30 — đã có người đặt",
    );
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
    const day = buildDay(0, "PAST", 2);
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
    const day = buildDay(0);
    expect(keepFreeSlots(day, [{ courtId: "san-la", minute: 18 * 60 }])).toEqual({});
    expect(keepFreeSlots(day, [{ courtId: "c1", minute: 3 * 60 }])).toEqual({});
  });

  it("ô chưa mở bán không chọn được, kể cả khi mang về từ URL", () => {
    const day = buildDay(19 * 60, "NOT_FOR_SALE");
    expect(keepFreeSlots(day, [{ courtId: "c1", minute: 18 * 60 }])).toEqual({});
  });
});
