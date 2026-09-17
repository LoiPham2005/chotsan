import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/**
 * Nút đăng nhập nhanh cho từng vai — CHỈ Ở MÔI TRƯỜNG DEV.
 *
 * ---
 * VÌ SAO CHẶN BẰNG `NODE_ENV`, KHÔNG PHẢI BẰNG CỜ BẬT/TẮT
 *
 * Đây là bốn tài khoản có mật khẩu nằm công khai trong mã nguồn. Một cờ trong
 * database hay biến môi trường thì có ngày ai đó bật nhầm trên production —
 * và lúc đó bất kỳ ai mở trang đăng nhập cũng bấm được vào tài khoản quản trị.
 *
 * `process.env.NODE_ENV` được thay thành hằng số lúc build, nên ở bản
 * production toàn bộ khối này bị loại khỏi bundle: không có nút, không có
 * email, không có mật khẩu. Không có cách nào bật lại lúc chạy.
 */
const ACCOUNTS = [
  {
    email: "admin@dev.local",
    role: "Quản trị",
    description: "Duyệt cơ sở, hoá đơn, người dùng",
  },
  {
    email: "chusan@dev.local",
    role: "Chủ sân",
    description: "3 cơ sở mẫu, toàn quyền trên sân",
  },
  {
    email: "nhanvien@dev.local",
    role: "Nhân viên",
    description: "Trực sân, không sửa giá, không quản nhân sự",
  },
  {
    email: "user@dev.local",
    role: "Khách",
    description: "Đặt sân, xem lượt đặt của mình",
  },
] as const;

const PASSWORD = "matkhau123";

/** Câu báo cho `?quickLogin=` mà route `/api/dev/quick-login` gắn khi không vào được. */
const RESULT_MESSAGES: Record<string, string> = {
  failed:
    "Đăng nhập nhanh không thành công: tài khoản mẫu sai mật khẩu, đang bị khoá, hoặc chưa có trong database (chạy pnpm db:seed).",
  "2fa":
    "Tài khoản mẫu này đã bật xác thực hai lớp — đăng nhập nhanh không hỗ trợ bước nhập mã. Dùng form đăng nhập thường ở trên.",
};

export function QuickLogin({ nextPath, result }: { nextPath?: string; result?: string }) {
  if (process.env.NODE_ENV === "production") return null;

  const message = result ? RESULT_MESSAGES[result] : undefined;

  return (
    // Viền đứt nét + nền xám: "khối tạm, không phải giao diện thật". KHÔNG tô cam
    // — cam chỉ nói "giờ vàng, giá cao hơn" (SKILL.md §2).
    <section className="mt-6 rounded-token-lg border border-dashed border-line-strong bg-elevated p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-content">
        Chỉ có ở môi trường dev
      </p>
      <p className="mt-0.5 text-xs text-muted">
        Bấm một vai để vào thẳng. Khối này không tồn tại trong bản production.
      </p>

      {message && (
        <Notice tone="danger" role="alert" className="mt-2 text-xs">
          {message}
        </Notice>
      )}

      <ul className="mt-2.5 space-y-1.5">
        {ACCOUNTS.map((item) => (
          <li key={item.email}>
            {/*
              Form thường POST tới `/api/dev/quick-login` — một route RIÊNG chỉ
              chạy ở dev, không phải action đăng nhập. Nó vẫn kiểm mật khẩu và
              trạng thái tài khoản bằng `validateCredentials`, nhưng KHÔNG có rate
              limit, và tài khoản đã bật 2FA thì không vào được (route báo lại
              bằng `?quickLogin=2fa`).
            */}
            <form action="/api/dev/quick-login" method="POST" className="contents">
              <input type="hidden" name="identifier" value={item.email} />
              <input type="hidden" name="password" value={PASSWORD} />
              {nextPath && <input type="hidden" name="next" value={nextPath} />}

              <Button
                type="submit"
                variant="outline"
                className="h-auto w-full justify-start bg-surface px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-content">{item.role}</span>
                  <span className="block truncate text-xs font-normal text-muted">
                    {item.email} · {item.description}
                  </span>
                </span>
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
