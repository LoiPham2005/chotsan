/**
 * Nhãn + màu của trạng thái lượt đặt — dùng chung cho màn khách, màn thanh toán
 * và lịch của chủ sân.
 *
 * Nằm ở tệp thường, KHÔNG phải trong một component `"use client"`: Server
 * Component import một hằng số từ tệp client chỉ nhận về một tham chiếu rỗng,
 * đọc thuộc tính ra `undefined` mà không báo lỗi gì.
 *
 * ---
 * MỘT BỘ NHÃN DUY NHẤT
 *
 * Lịch chủ sân từng có bộ nhãn riêng ("Chờ trả tiền", "Đã trả tiền", "Xong")
 * khác bộ của khách ("Chờ thanh toán", "Đã xác nhận", "Hoàn tất"). Chủ sân và
 * khách nói chuyện với nhau qua điện thoại về CÙNG một lượt đặt — hai cái tên
 * cho một trạng thái là một cuộc gọi hiểu nhầm.
 *
 * ---
 * MÀU THEO SKILL (SKILL.md §2) — `className` chỉ mang MÀU, nơi dùng tự thêm `ring-1`
 *
 *   Chờ thanh toán   ĐỎ nhạt — skill ghi đích danh nhãn "chờ thanh toán": chỗ giữ
 *                    sắp hết hạn, khách phải trả tiền ngay. KHÔNG cam (cam = giờ vàng).
 *   Đã xác nhận      xanh nhạt — đã chốt tiền.
 *   Đã tới sân       viền xanh đậm trên nền trắng — cùng nghĩa tích cực, khác
 *                    "Đã xác nhận" để người trực sân lướt là thấy ai đã tới.
 *   Hoàn tất         trắng viền xám — xong, không còn việc gì.
 *   Đã huỷ/Hết hạn   xám — lượt không còn hiệu lực, bình thường, không phải lỗi.
 *   Không tới        đỏ nhạt — sự cố của lượt đặt.
 */
export const BOOKING_STATUS: Record<string, { text: string; className: string }> = {
  HOLDING: {
    text: "Chờ thanh toán",
    className: "bg-danger-tint text-danger-text ring-danger-line",
  },
  CONFIRMED: { text: "Đã xác nhận", className: "bg-brand-tint text-brand-text ring-brand-line" },
  CHECKED_IN: { text: "Đã tới sân", className: "bg-surface text-brand-text ring-brand" },
  COMPLETED: { text: "Hoàn tất", className: "bg-surface text-content ring-line-strong" },
  CANCELLED: { text: "Đã huỷ", className: "bg-elevated text-muted ring-line" },
  EXPIRED: { text: "Hết hạn giữ chỗ", className: "bg-elevated text-muted ring-line" },
  NO_SHOW: { text: "Không tới", className: "bg-danger-tint text-danger-text ring-danger-line" },
};

/**
 * Chỗ giữ đã QUÁ HẠN mà cron chưa kịp đổi sang `EXPIRED`.
 *
 * Lịch trống đã coi chỗ này là trống từ lâu (`occupyingBookingWhere`); màn nào
 * còn gọi nó là "chờ thanh toán" là đang nói sai với người đọc — khách tưởng
 * vẫn trả tiền được, chủ sân tưởng vẫn có người sắp tới. `holdExpiresAt = null`
 * (khách đã báo chuyển khoản) thì KHÔNG bao giờ quá hạn.
 *
 * Nhận `now` từ nơi gọi: tầng giao diện không được đọc đồng hồ khi dựng.
 */
export function isHoldExpired(
  booking: { status: string; holdExpiresAt: Date | string | null },
  now: Date,
): boolean {
  if (booking.status !== "HOLDING" || booking.holdExpiresAt === null) return false;
  return new Date(booking.holdExpiresAt).getTime() <= now.getTime();
}

/**
 * Nhãn hiển thị của một lượt đặt. Chỗ giữ quá hạn mang nhãn "Hết hạn giữ chỗ"
 * dù trong database vẫn là `HOLDING`.
 */
export function bookingStatusBadge(
  status: string,
  holdExpired = false,
): { text: string; className: string } {
  const key = status === "HOLDING" && holdExpired ? "EXPIRED" : status;
  return BOOKING_STATUS[key] ?? { text: status, className: "bg-elevated text-muted ring-line" };
}
