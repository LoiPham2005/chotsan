import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { tokenService } from "@/services/token.service";
import { SessionRevokeButton } from "./session-revoke-button";

export const metadata: Metadata = { title: "Thiết bị đang đăng nhập" };
export const dynamic = "force-dynamic";

/**
 * Rút gọn chuỗi User-Agent thành một nhãn đọc được.
 *
 * Cố ý làm rất thô, không dùng thư viện phân tích UA. Lý do: mục đích duy nhất
 * ở đây là giúp người dùng NHẬN RA thiết bị của họ — "iPhone" hay "Windows" là
 * đủ. Phân tích chính xác phiên bản trình duyệt cần một thư viện với bảng dữ
 * liệu phải cập nhật liên tục, đổi lại gần như không thêm giá trị gì.
 *
 * Chuỗi gốc vẫn được hiện đầy đủ bên dưới, nên nhận nhầm cũng không mất gì.
 */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Thiết bị không rõ";

  const ua = userAgent.toLowerCase();

  // Thứ tự quan trọng: iPad cũng chứa "safari", Android cũng chứa "linux".
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("android")) return "Thiết bị Android";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "máy Mac";
  if (ua.includes("windows")) return "máy Windows";
  if (ua.includes("linux")) return "máy Linux";

  return "Thiết bị không rõ";
}

export default async function SessionsPage() {
  const user = await requireUser("/sessions");

  // Gọi thẳng service, không đi qua REST API của chính mình: đây là Server
  // Component nên nó chạy cùng tiến trình với service — thêm một vòng HTTP chỉ
  // để tự gọi mình là lãng phí, và còn phải tự lo việc chuyển tiếp cookie.
  const sessions = await tokenService.listActive(user.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href="/security"
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← Bảo mật tài khoản
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Thiết bị đang đăng nhập
        </h1>
        <p className="mt-1 text-sm text-muted">
          Danh sách các thiết bị đã đăng nhập qua <strong>ứng dụng di động</strong>. Thấy thiết bị
          lạ thì đăng xuất nó ngay, rồi đổi mật khẩu.
        </p>
      </header>

      {/*
        Lời giải thích này BẮT BUỘC phải có, nếu không người dùng sẽ hoang mang.

        Phiên đăng nhập trên WEB dùng cookie đã ký (JWT), không tạo dòng nào
        trong bảng refresh token — nên trình duyệt bạn đang ngồi KHÔNG xuất
        hiện ở đây. Danh sách trống không có nghĩa là bạn chưa đăng nhập.
      */}
      <Notice tone="neutral" role="note" className="mt-4">
        Trình duyệt bạn đang dùng <strong>không</strong> nằm trong danh sách này. Phiên trên web
        dùng cookie, không phải refresh token — muốn thoát khỏi trình duyệt này thì bấm{" "}
        <strong>Đăng xuất</strong> ở đầu trang.
      </Notice>

      {sessions.length === 0 ? (
        <p className="mt-5 rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
          Chưa có thiết bị di động nào đăng nhập vào tài khoản này.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {sessions.map((item) => {
            const label = describeUserAgent(item.userAgent);

            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-3 rounded-token-lg border border-line bg-surface p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-content">{label}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    Đăng nhập {formatDateTime(item.createdAt)} · hết hạn{" "}
                    {formatDateTime(item.expiresAt)}
                  </p>
                  {item.userAgent && (
                    <p className="mt-1 break-all font-mono text-xs text-subtle">{item.userAgent}</p>
                  )}
                </div>

                <SessionRevokeButton
                  sessionId={item.id}
                  label={label}
                  accessTokenMinutes={env.ACCESS_TOKEN_TTL_MINUTES}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
