import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { requireUser } from "@/lib/auth";
import { isWebAuthnConfigured } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { authService } from "@/services/auth.service";
import { twoFactorService } from "@/services/two-factor.service";
import { webauthnService } from "@/services/webauthn.service";
import { ChangeEmailForm, ChangePasswordForm, ResendVerificationButton } from "./account-forms";
import { PasskeyManager } from "./passkey-manager";
import { TwoFactorManager } from "./two-factor-manager";

export const metadata: Metadata = { title: "Bảo mật tài khoản" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireUser("/security");

  // Gọi thẳng service, không đi qua REST API của chính mình: đây là Server
  // Component nên nó chạy cùng tiến trình — thêm một vòng HTTP chỉ để tự gọi
  // mình là lãng phí, và còn phải tự lo việc chuyển tiếp cookie.
  const [status, passkeys, account] = await Promise.all([
    twoFactorService.status(user.id),
    webauthnService.list(user.id),
    authService.accountSecurity(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← Quay lại trang chủ
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Bảo mật tài khoản
        </h1>
        <p className="mt-1 text-sm text-muted">
          Email, mật khẩu và các lớp bảo vệ thêm. Bật 2FA hoặc passkey thì mật khẩu bị lộ cũng chưa
          đủ để đăng nhập.
        </p>
      </header>

      <div className="mt-6 space-y-4">
        <Section id="email-heading" title="Email">
          {account.email ? (
            <p className="text-sm text-muted">
              <span className="font-semibold text-content">{account.email}</span> ·{" "}
              {account.emailVerified ? "Đã xác thực" : "Chưa xác thực"}
            </p>
          ) : (
            <p className="text-sm text-muted">Tài khoản chưa có email.</p>
          )}

          {account.email && !account.emailVerified && (
            <div className="mt-3 grid gap-2">
              {/* Chưa xác thực thì đăng nhập Google/Apple bằng email này bị từ chối
                  (chống tiền-chiếm tài khoản, xem `oauthService`) — nói ra hậu quả
                  thì người dùng mới hiểu vì sao nên bấm. */}
              <p className="text-sm text-muted">
                Chưa xác thực thì không liên kết được đăng nhập Google/Apple với email này. Bấm nút
                dưới đây rồi mở thư để xác thực.
              </p>
              <ResendVerificationButton />
            </div>
          )}

          {account.pendingEmail && (
            // Đang CHỜ người dùng bấm link — không phải lỗi, nên giọng trung tính.
            <Notice tone="neutral" role="status" className="mt-3">
              Đang chờ xác nhận đổi sang <strong>{account.pendingEmail}</strong>. Mở hộp thư của địa
              chỉ đó và bấm liên kết trong thư — email chỉ đổi sau bước này.
            </Notice>
          )}

          <h3 className="mt-5 text-sm font-semibold text-content">Đổi email</h3>
          {account.hasPassword ? (
            <>
              <p className="mb-3 mt-1 text-sm text-muted">
                Liên kết xác nhận gửi tới địa chỉ MỚI; địa chỉ cũ nhận thư báo ngay.
              </p>
              <ChangeEmailForm />
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Đổi email cần mật khẩu hiện tại, mà tài khoản này chưa có mật khẩu. Đặt mật khẩu trước
              qua <Link href="/forgot-password">Quên mật khẩu</Link>.
            </p>
          )}
        </Section>

        <Section id="password-heading" title="Mật khẩu">
          {account.hasPassword ? (
            <>
              <p className="mb-3 text-sm text-muted">
                Đổi xong, các thiết bị khác bị đăng xuất; trình duyệt này vẫn giữ đăng nhập.
              </p>
              <ChangePasswordForm />
            </>
          ) : (
            <p className="text-sm text-muted">
              Tài khoản chưa có mật khẩu (đăng nhập bằng Google, Apple hoặc passkey). Muốn đặt mật
              khẩu thì dùng <Link href="/forgot-password">Quên mật khẩu</Link> với email của bạn.
            </p>
          )}
        </Section>

        <Section id="two-factor-heading" title="Xác thực hai lớp (2FA)">
          <p className="mb-4 text-sm text-muted">
            Mã 6 số đổi mỗi 30 giây, sinh bởi ứng dụng trên điện thoại (Google Authenticator,
            1Password, Authy…). Không cần mạng.
          </p>

          <TwoFactorManager
            enabled={status.enabled}
            available={twoFactorService.isAvailable()}
            enabledAt={status.enabledAt ? formatDateTime(status.enabledAt) : null}
            recoveryCodesRemaining={status.remainingRecoveryCodes}
          />
        </Section>

        <Section id="passkey-heading" title="Passkey">
          <p className="mb-4 text-sm text-muted">
            Vân tay, Face ID, Windows Hello hoặc khoá cứng. An toàn hơn mật khẩu + 2FA cộng lại:
            trình duyệt chỉ ký cho đúng tên miền đã đăng ký, nên trang giả không xin được chữ ký.
          </p>

          <PasskeyManager
            available={isWebAuthnConfigured()}
            passkeys={passkeys.map((passkey) => ({
              id: passkey.id,
              name: passkey.name,
              createdAt: formatDateTime(passkey.createdAt),
              lastUsedAt: passkey.lastUsedAt ? formatDateTime(passkey.lastUsedAt) : null,
            }))}
          />
        </Section>

        <Section id="devices-heading" title="Thiết bị đang đăng nhập">
          <p className="text-sm text-muted">
            Thấy thiết bị lạ thì đăng xuất nó ngay, rồi đổi mật khẩu.{" "}
            <Link href="/sessions">Xem danh sách →</Link>
          </p>
        </Section>
      </div>
    </div>
  );
}

/** Một khối của trang: thẻ viền, không đổ bóng (SKILL.md §4). */
function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-token-lg border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id={id} className="mb-2 text-lg font-bold text-content">
        {title}
      </h2>
      {children}
    </section>
  );
}
