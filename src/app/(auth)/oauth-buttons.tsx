import Link from "next/link";
import { apiPath } from "@/lib/api/version";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { isProviderConfigured } from "@/lib/oauth/config";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "@/lib/oauth/types";

const LABELS: Record<OAuthProviderId, string> = {
  google: "Google",
  github: "Github",
  facebook: "Facebook",
  apple: "Apple",
};

/**
 * Chỉ hiện nút của provider ĐÃ CẤU HÌNH — thiếu CLIENT_ID/SECRET thì ẩn hẳn
 * thay vì hiện nút rồi bấm vào mới báo lỗi.
 */
export function OAuthButtons({ next }: { next?: string }) {
  const configured = OAUTH_PROVIDERS.filter(isProviderConfigured);
  if (configured.length === 0) return null;

  return (
    <div className="mb-5 grid gap-2">
      {/* Nút VIỀN (loại "Phụ"): nút đặc duy nhất của màn là "Đăng nhập"/"Đăng ký". */}
      {configured.map((provider) => (
        <Button key={provider} asChild variant="outline" className="w-full">
          <Link
            href={`${apiPath(`/auth/oauth/${provider}/start`)}${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            Tiếp tục với {LABELS[provider]}
          </Link>
        </Button>
      ))}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        <span aria-hidden className="h-px flex-1 bg-line" />
        hoặc
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

/**
 * Câu cho từng `?oauthError=` mà route callback gắn — xem `oauthErrorCode`
 * trong `api/v1/auth/oauth/[provider]/callback/route.ts`. Mã lạ (provider tự
 * gửi `error=` bất kỳ) rơi về câu `unknown`.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Bạn đã huỷ đăng nhập.",
  state_mismatch: "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.",
  not_configured: "Phương thức đăng nhập này chưa được bật.",
  email_required:
    "Tài khoản mạng xã hội của bạn không có email đã xác thực để liên kết. Vui lòng công khai/xác thực email rồi thử lại.",
  email_unverified:
    "Email này đã có tài khoản nhưng chưa được xác thực. Đăng nhập bằng mật khẩu, hoặc dùng “Quên mật khẩu” để lấy lại tài khoản rồi thử lại.",
  exchange_failed: "Không đăng nhập được. Vui lòng thử lại.",
  banned: "Tài khoản đã bị khoá. Vui lòng liên hệ quản trị viên.",
  account_unavailable:
    "Tài khoản này không còn khả dụng (đã bị xoá hoặc đang tạm ngưng). Vui lòng liên hệ quản trị viên.",
  invalid_provider: "Phương thức đăng nhập không hợp lệ.",
  unknown: "Có lỗi xảy ra khi đăng nhập. Vui lòng thử lại.",
};

export function OAuthErrorBanner({ code }: { code?: string }) {
  if (!code) return null;
  const message = OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_MESSAGES.unknown;

  return (
    <Notice tone="danger" role="alert" className="mb-4">
      {message}
    </Notice>
  );
}
