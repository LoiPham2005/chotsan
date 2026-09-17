import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DayAvailability } from "@/services/availability.service";

/**
 * Quay về từ trang đăng nhập với lựa chọn cũ thì trang tự cuộn tới form đặt sân.
 * Người bật "giảm chuyển động" trong hệ điều hành phải được NHẢY thẳng tới đó,
 * không lướt — chuyển động dài trên màn hình gây chóng mặt cho đúng họ.
 */

vi.mock("@/app/(public)/venues/[slug]/actions", () => ({ holdBookingAction: vi.fn() }));

import { SelectAndBook } from "./select-and-book";

function buildDay(): DayAvailability {
  const minutes = [17 * 60, 17 * 60 + 30, 18 * 60];
  return {
    venueId: "v1",
    date: "2026-09-18",
    timing: "FUTURE",
    minutes,
    summary: minutes.map(() => 1),
    isClosed: false,
    courts: [
      {
        courtId: "c1",
        courtName: "Sân 1",
        slots: minutes.map((minute) => ({ minute, status: "FREE", price: 70_000, isPeak: false })),
      },
    ],
  };
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderReturningFromLogin() {
  return render(
    <SelectAndBook
      day={buildDay()}
      venueId="v1"
      date="2026-09-18"
      currentPath="/venues/san-a?date=2026-09-18"
      holdMinutes={10}
      user={{ name: "An", phone: "0912345678" }}
      initialSelection={[{ courtId: "c1", minute: 17 * 60 }]}
    />,
  );
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  // Chạy ngay nhịp vẽ kế tiếp — thứ component chờ trước khi cuộn.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SelectAndBook — cuộn tới form sau khi đăng nhập", () => {
  it("bình thường: lướt mượt tới form", () => {
    mockReducedMotion(false);
    renderReturningFromLogin();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  it("bật giảm chuyển động: nhảy thẳng, không lướt", () => {
    mockReducedMotion(true);
    renderReturningFromLogin();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  });
});
