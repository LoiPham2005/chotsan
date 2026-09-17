"use client";

import { createContext, useCallback, useContext, useState } from "react";

/**
 * Thông báo SAU một thao tác trên dòng của danh sách — sống NGOÀI dòng đó.
 *
 * ---
 * LỖI NÓ SINH RA ĐỂ SỬA
 *
 * Khách bấm "Huỷ lượt đặt", chủ sân bấm "Huỷ" hay "Đã nhận đủ tiền": action
 * gọi `revalidatePath`, danh sách dựng lại, và dòng vừa bấm ĐỔI NHÓM ("Sắp
 * tới" → "Đã qua") hoặc RỜI HẲN danh sách (hàng chờ duyệt). Component giữ
 * `useActionState` bị gỡ cùng dòng — câu "Đã huỷ. Sân sẽ hoàn 360.000đ" biến
 * mất trước khi ai kịp đọc, đúng lúc người dùng cần nó nhất.
 *
 * Nên câu thành công được đẩy lên đây: provider nằm ở cấp trang, không bị gỡ
 * khi danh sách đổi, và hiện thông báo ở mép dưới màn hình — thấy được dù dòng
 * đã cuộn đi đâu. Lỗi thì vẫn hiện NGAY TẠI dòng: thao tác hỏng thì không có
 * gì đổi, dòng còn nguyên, và câu lỗi đứng cạnh nút là dễ hiểu nhất.
 *
 * Không tự tắt: tự tắt sau vài giây là lặp lại đúng lỗi "biến mất trước khi
 * đọc được". Thông báo mới thay thông báo cũ; có nút "Đóng".
 */

const NotifyContext = createContext<(message: string) => void>(() => {});

export function ActionNoticeProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const notify = useCallback((next: string) => setMessage(next), []);

  return (
    <NotifyContext.Provider value={notify}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        <div
          className={
            message
              ? "pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-token-lg border border-brand-line bg-surface px-4 py-3 shadow-nang-3"
              : "sr-only"
          }
        >
          {/* Vùng đọc to LUÔN có mặt trong trang: trình đọc màn hình chỉ báo
              thay đổi của vùng đã tồn tại từ trước, không báo vùng mới chèn vào. */}
          <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm text-content">
            {message}
          </p>
          {message && (
            <button
              type="button"
              onClick={() => setMessage(null)}
              // Chữ nhỏ, vùng bấm đủ 44px (`after:`) — thông báo nổi ở mép dưới,
              // người dùng bấm "Đóng" bằng ngón cái.
              className="relative shrink-0 rounded-token-control px-1.5 py-1 text-xs font-semibold text-muted after:absolute after:-inset-2.5 hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    </NotifyContext.Provider>
  );
}

/**
 * Hàm đẩy một câu thành công lên thông báo của trang. Ngoài provider thì là
 * hàm rỗng — component vẫn chạy, chỉ là không có thông báo.
 */
export function useActionNotice(): (message: string) => void {
  return useContext(NotifyContext);
}
