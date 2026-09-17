import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/ui/notice";
import { getSession, hasRevokedSessionCookie } from "@/lib/auth";
import { readPendingTwoFactor } from "@/lib/oauth/two-factor-cookie";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { verifyTicket } from "@/lib/tickets";
import { AuthHeader } from "../auth-form";
import { OAuthButtons, OAuthErrorBanner } from "../oauth-buttons";
import { LoginForm } from "./login-form";
import { PasskeyButton } from "./passkey-button";
import { QuickLogin } from "./quick-login";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    oauthError?: string;
    reset?: string;
    twoFactor?: string;
    quickLogin?: string;
  }>;
}) {
  const { next, oauthError, reset, twoFactor, quickLogin } = await searchParams;

  /*
   * Đã đăng nhập THẬT thì không cần trang này — về `next` (qua lọc), hoặc trang
   * chủ.
   *
   * Kiểm ở đây chứ không ở proxy: proxy chỉ thấy CHỮ KÝ cookie, không biết phiên
   * đã bị thu hồi. Cookie đúng chữ ký của tài khoản vừa đổi mật khẩu/bị khoá
   * mà proxy đá khỏi /login thì người đó không bao giờ tới được form để đăng
   * nhập lại — và trang cần đăng nhập đá ngược về /login thành vòng lặp.
   */
  if (await getSession()) redirect(safeRedirectPath(next, "/"));

  const revoked = await hasRevokedSessionCookie();

  // Lượt đăng nhập OAuth đang chờ mã 2FA: vé nằm trong cookie httpOnly, KHÔNG
  // trên URL — `?twoFactor=1` chỉ nói "hãy hiện form nhập mã".
  const pending = twoFactor ? await readPendingTwoFactor() : null;
  const pendingValid = pending ? (await verifyTicket(pending.ticket, "2fa")) !== null : false;

  return (
    <>
      <AuthHeader title="Đăng nhập">Nhập thông tin tài khoản của bạn để tiếp tục.</AuthHeader>

      {/*
        `?reset=1` do `resetPasswordAction` gắn vào sau khi đổi mật khẩu
        thành công. Không có nó thì người dùng bị đá về trang đăng nhập mà
        không biết việc đặt lại đã xong hay vừa thất bại.
      */}
      {reset && (
        <Notice tone="success" role="status" className="mb-4">
          Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.
        </Notice>
      )}

      {revoked && !reset && (
        <Notice tone="neutral" role="status" className="mb-4">
          Phiên đăng nhập trước trên trình duyệt này không còn hiệu lực — mật khẩu vừa được đổi,
          hoặc tài khoản đã bị khoá. Vui lòng đăng nhập lại.
        </Notice>
      )}

      {twoFactor && pendingValid ? (
        <>
          <TwoFactorForm />
          <p className="mt-5 text-sm text-muted">
            <Link href="/login">Đăng nhập bằng cách khác</Link>
          </p>
        </>
      ) : (
        <>
          {twoFactor && (
            <Notice tone="danger" role="alert" className="mb-4">
              Phiên xác thực hai lớp đã hết hạn. Vui lòng đăng nhập lại.
            </Notice>
          )}

          <OAuthErrorBanner code={oauthError} />
          <OAuthButtons next={next} />

          <LoginForm nextPath={next} />

          {/* Dưới form mật khẩu, không phải trên: passkey vẫn là lựa chọn thứ
              hai với đa số người dùng hôm nay, và đảo thứ tự làm màn hình quen
              thuộc trở nên lạ. Nút tự ẩn nếu trình duyệt không hỗ trợ. */}
          <PasskeyButton nextPath={next} />

          <div className="mt-5 space-y-2 text-sm text-muted">
            <p>
              <Link href="/forgot-password">Quên mật khẩu?</Link>
            </p>
            <p>
              Chưa có tài khoản?{" "}
              <Link href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}>
                Đăng ký
              </Link>
            </p>
          </div>

          <QuickLogin nextPath={next} result={quickLogin} />
        </>
      )}
    </>
  );
}
