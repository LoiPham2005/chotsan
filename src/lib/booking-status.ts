/**
 * Nhãn + màu của trạng thái lượt đặt — dùng chung cho màn khách và màn thanh toán.
 *
 * Nằm ở tệp thường, KHÔNG phải trong một component `"use client"`: Server
 * Component import một hằng số từ tệp client chỉ nhận về một tham chiếu rỗng,
 * đọc thuộc tính ra `undefined` mà không báo lỗi gì.
 */
export const BOOKING_STATUS: Record<string, { text: string; className: string }> = {
  HOLDING: { text: "Chờ thanh toán", className: "bg-peak-tint text-peak-text ring-peak-line" },
  CONFIRMED: { text: "Đã xác nhận", className: "bg-brand-tint text-brand-hover ring-brand-line" },
  CHECKED_IN: { text: "Đã tới sân", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  COMPLETED: { text: "Hoàn tất", className: "bg-elevated text-muted ring-line" },
  CANCELLED: { text: "Đã huỷ", className: "bg-elevated text-subtle ring-line" },
  EXPIRED: { text: "Hết hạn giữ chỗ", className: "bg-elevated text-subtle ring-line" },
  NO_SHOW: { text: "Không tới", className: "bg-red-50 text-red-700 ring-red-200" },
};
