import { describe, expect, it } from "vitest";
import { BOOKING_STATUS, bookingStatusBadge, isHoldExpired } from "./booking-status";

/**
 * Nhãn trạng thái là thứ khách và chủ sân đọc cho nhau qua điện thoại. Gọi một
 * chỗ giữ đã quá hạn là "chờ thanh toán" là mời khách chuyển tiền cho một chỗ
 * người khác đặt được bất cứ lúc nào.
 *
 * Mốc dùng xuyên suốt: 10:00 ngày 04/09/2026 giờ VN.
 */

const NOW = new Date("2026-09-04T03:00:00Z");

describe("isHoldExpired", () => {
  it("HOLDING đã quá hạn thì là hết hạn, kể cả khi cron chưa đổi trạng thái", () => {
    expect(
      isHoldExpired({ status: "HOLDING", holdExpiresAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(true);
    // Đúng mốc hạn cũng là hết — khớp `lte` của cron và của lịch trống.
    expect(isHoldExpired({ status: "HOLDING", holdExpiresAt: NOW }, NOW)).toBe(true);
  });

  it("còn hạn thì chưa hết", () => {
    expect(
      isHoldExpired({ status: "HOLDING", holdExpiresAt: new Date(NOW.getTime() + 60_000) }, NOW),
    ).toBe(false);
  });

  it("đã báo chuyển khoản (hạn = null) thì KHÔNG bao giờ hết hạn", () => {
    // Đang chờ chủ sân đối chiếu tiền thật — gọi nó là hết hạn là bảo khách đặt lại.
    expect(isHoldExpired({ status: "HOLDING", holdExpiresAt: null }, NOW)).toBe(false);
  });

  it("chỉ áp cho HOLDING — lượt đã xác nhận không có khái niệm hết hạn giữ chỗ", () => {
    expect(
      isHoldExpired({ status: "CONFIRMED", holdExpiresAt: new Date(NOW.getTime() - 1) }, NOW),
    ).toBe(false);
  });

  it("nhận cả chuỗi ISO — giá trị đã qua ranh giới máy chủ → trình duyệt", () => {
    expect(
      isHoldExpired({ status: "HOLDING", holdExpiresAt: "2026-09-04T02:59:00.000Z" }, NOW),
    ).toBe(true);
  });
});

describe("bookingStatusBadge", () => {
  it("HOLDING quá hạn mang nhãn 'Hết hạn giữ chỗ', không phải 'Chờ thanh toán'", () => {
    expect(bookingStatusBadge("HOLDING", true).text).toBe("Hết hạn giữ chỗ");
    expect(bookingStatusBadge("HOLDING").text).toBe("Chờ thanh toán");
  });

  it("dùng CHUNG một bộ nhãn cho mọi màn", () => {
    expect(bookingStatusBadge("CONFIRMED")).toEqual(BOOKING_STATUS.CONFIRMED);
    // Cờ hết hạn không đổi nhãn của trạng thái khác HOLDING.
    expect(bookingStatusBadge("CONFIRMED", true)).toEqual(BOOKING_STATUS.CONFIRMED);
  });

  it("trạng thái lạ vẫn hiện chữ, không đổ trang", () => {
    expect(bookingStatusBadge("KHAC").text).toBe("KHAC");
  });
});
