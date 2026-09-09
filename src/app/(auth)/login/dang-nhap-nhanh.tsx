import { Button } from "@/components/ui/button";

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
const TAI_KHOAN = [
  { email: "admin@dev.local", vai: "Quản trị", mo: "Duyệt cơ sở, hoá đơn, người dùng" },
  { email: "chusan@dev.local", vai: "Chủ sân", mo: "3 cơ sở mẫu, toàn quyền trên sân" },
  {
    email: "nhanvien@dev.local",
    vai: "Nhân viên",
    mo: "Trực sân, không sửa giá, không quản nhân sự",
  },
  { email: "user@dev.local", vai: "Khách", mo: "Đặt sân, xem lượt đặt của mình" },
] as const;

const MAT_KHAU = "matkhau123";

export function DangNhapNhanh({ nextPath }: { nextPath?: string }) {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <section className="mt-6 rounded-token-lg border border-dashed border-peak-line bg-peak-tint/40 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-peak-text">
        Chỉ có ở môi trường dev
      </p>
      <p className="mt-0.5 text-xs text-muted">
        Bấm một vai để vào thẳng. Khối này không tồn tại trong bản production.
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {TAI_KHOAN.map((item) => (
          <li key={item.email}>
            {/*
              Form thật gửi tới CHÍNH action đăng nhập, không phải đường tắt bỏ
              qua xác thực. Nhờ vậy nút này đi qua đúng mọi lớp kiểm — rate
              limit, khoá tài khoản, 2FA — và không bao giờ che mất một lỗi chỉ
              xuất hiện ở luồng đăng nhập thật.
            */}
            <form action="/api/dev/quick-login" method="POST" className="contents">
              <input type="hidden" name="identifier" value={item.email} />
              <input type="hidden" name="password" value={MAT_KHAU} />
              {nextPath && <input type="hidden" name="next" value={nextPath} />}

              <Button
                type="submit"
                variant="outline"
                className="h-auto w-full justify-start bg-surface px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-content">{item.vai}</span>
                  <span className="block truncate text-xs font-normal text-muted">
                    {item.email} · {item.mo}
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
