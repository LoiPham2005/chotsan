import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { HoldCountdown } from "./hold-countdown";

/**
 * Đồng hồ đếm ngược giữ chỗ. Lỗi thật trước đây: trừ mốc hết hạn cho đồng hồ
 * của MÁY KHÁCH — điện thoại chạy nhanh vài phút là thấy hết giờ sớm, và trang
 * tự tải lại mỗi giây vì trang mới vẫn nói "còn hạn".
 *
 * Mốc dùng xuyên suốt: máy chủ 10:00:00 ngày 04/09/2026 giờ VN, hạn giữ chỗ
 * 10:10:00.
 */

const SERVER_NOW = new Date("2026-09-04T03:00:00Z");
const EXPIRES = new Date("2026-09-04T03:10:00Z");

beforeEach(() => {
  refresh.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HoldCountdown", () => {
  it("đồng hồ máy khách NHANH 3 phút vẫn đếm đúng 10 phút còn lại", () => {
    vi.setSystemTime(new Date(SERVER_NOW.getTime() + 3 * 60_000));

    render(
      <HoldCountdown
        expiresAtIso={EXPIRES.toISOString()}
        serverNowIso={SERVER_NOW.toISOString()}
      />,
    );

    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("đồng hồ máy khách CHẬM cũng không kéo dài hạn", () => {
    vi.setSystemTime(new Date(SERVER_NOW.getTime() - 5 * 60_000));

    render(
      <HoldCountdown
        expiresAtIso={EXPIRES.toISOString()}
        serverNowIso={SERVER_NOW.toISOString()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(screen.getByText("6:00")).toBeInTheDocument();
  });

  it("về 0 thì báo hết giờ và xin trang mới ĐÚNG MỘT LẦN — không tải lại vòng vòng", () => {
    vi.setSystemTime(SERVER_NOW);

    render(
      <HoldCountdown
        expiresAtIso={EXPIRES.toISOString()}
        serverNowIso={SERVER_NOW.toISOString()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText("Đã hết thời gian giữ chỗ")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Trang mới (lệch vài giây) vẫn dựng lại đúng mốc cũ: không xin thêm lần nào.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("được cấp hạn MỚI (chủ sân từ chối, khách khai lại) thì đếm tiếp và được làm mới lại khi hết", () => {
    vi.setSystemTime(SERVER_NOW);

    const { rerender } = render(
      <HoldCountdown
        expiresAtIso={EXPIRES.toISOString()}
        serverNowIso={SERVER_NOW.toISOString()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    const renewedNow = new Date(EXPIRES.getTime() + 1_000);
    const renewedExpiry = new Date(renewedNow.getTime() + 10 * 60_000);
    rerender(
      <HoldCountdown
        expiresAtIso={renewedExpiry.toISOString()}
        serverNowIso={renewedNow.toISOString()}
      />,
    );

    expect(screen.getByText("10:00")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
