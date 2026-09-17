import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { columnHeightPercent, RevenueChart } from "./revenue-chart";

/**
 * jsdom không tính bố cục, nên bài này khoá CẤU TRÚC đã sửa thay vì đo pixel.
 *
 * Lỗi thật trước đây: thanh mang `height: X%` nằm trong một cột KHÔNG có chiều
 * cao xác định (khung `items-end`, cột cao theo nội dung) → phần trăm tính như
 * `auto` → mọi thanh cao 0px, biểu đồ không có cột nào. Cột phải là `h-full`
 * (100% của khung `h-40`) và tự dồn thanh xuống đáy.
 */

const ROWS = [
  { date: "2026-09-01", bookings: 4, revenue: 400_000 },
  { date: "2026-09-02", bookings: 0, revenue: 0 },
  { date: "2026-09-03", bookings: 1, revenue: 1_000 },
];

describe("columnHeightPercent", () => {
  it("cao nhất 100%, ngày trống 0%, ngày có tiền nhưng ít vẫn thấy được (≥ 2%)", () => {
    expect(columnHeightPercent(400_000, 400_000)).toBe(100);
    expect(columnHeightPercent(200_000, 400_000)).toBe(50);
    expect(columnHeightPercent(0, 400_000)).toBe(0);
    expect(columnHeightPercent(1_000, 400_000)).toBe(2);
  });
});

describe("RevenueChart", () => {
  it("mỗi cột cao ĐỦ khung và dồn thanh xuống đáy — phần trăm của thanh mới có chỗ để tính", () => {
    const { container } = render(<RevenueChart rows={ROWS} />);

    const frame = container.querySelector('[aria-hidden="true"]')!;
    expect(frame).toHaveClass("h-40");

    const columns = [...frame.children];
    expect(columns).toHaveLength(3);
    for (const column of columns) {
      expect(column).toHaveClass("h-full", "flex", "flex-col", "justify-end");
    }

    const heights = columns.map((column) => (column.firstElementChild as HTMLElement).style.height);
    expect(heights).toEqual(["100%", "0%", "2%"]);
  });

  it("có bảng ẩn mang đúng số liệu cho trình đọc màn hình", () => {
    const { container } = render(<RevenueChart rows={ROWS} />);

    expect(container.querySelectorAll("table.sr-only tbody tr")).toHaveLength(3);
  });
});
