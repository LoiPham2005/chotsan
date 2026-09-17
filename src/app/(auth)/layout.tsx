/**
 * Khung chung của các trang xác thực: một thẻ hẹp giữa trang.
 *
 * Chỉ lo phần nhìn — KHÔNG chặn gì ở đây. `/login`, `/register` tự đưa người đã
 * đăng nhập đi nơi khác bằng `getSession()` đầy đủ (xem ghi chú ở trang /login).
 *
 * Thẻ có viền, không đổ bóng (SKILL.md §4: thẻ thường không đổ bóng).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <div className="rounded-token-lg border border-line bg-surface p-5 sm:p-6">{children}</div>
    </div>
  );
}
