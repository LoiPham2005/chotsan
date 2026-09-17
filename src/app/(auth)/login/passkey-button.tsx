"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { getPasskeyLoginOptions, verifyPasskeyLogin } from "./passkey-actions";

/**
 * Nút "Đăng nhập bằng passkey".
 *
 * Không cần nhập email: trình duyệt tự hiện mọi passkey đã lưu cho tên miền
 * này, người dùng chọn một cái rồi mở khoá bằng vân tay/Face ID. Một chạm, và
 * an toàn hơn mật khẩu + TOTP cộng lại — vì trang giả không xin được chữ ký.
 */
export function PasskeyButton({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Kiểm tra trong `useEffect` chứ không phải lúc render: `window` không tồn
    // tại khi Next render phía server, và một nút "đăng nhập bằng passkey"
    // hiện trên trình duyệt không hỗ trợ chỉ dẫn tới ngõ cụt.
    void import("@simplewebauthn/browser").then(({ browserSupportsWebAuthn }) => {
      setSupported(browserSupportsWebAuthn());
    });
  }, []);

  if (!supported) return null;

  async function handleClick() {
    setBusy(true);
    setError(null);

    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const prepared = await getPasskeyLoginOptions();

      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }

      // Bước này mở secure enclave của thiết bị. Trình duyệt CHỈ ký cho đúng
      // tên miền đã đăng ký — đó là toàn bộ lý do passkey chống được phishing.
      const response = await startAuthentication({ optionsJSON: prepared.options });

      const result = await verifyPasskeyLogin(prepared.challengeToken, response, nextPath);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.push(result.next);
      // Server Component đọc cookie phiên vừa được đặt — không refresh thì
      // trang đích vẫn render theo trạng thái "chưa đăng nhập".
      router.refresh();
    } catch (err) {
      // Người dùng bấm Huỷ ở hộp thoại hệ điều hành cũng rơi vào đây. Không
      // phải lỗi — đừng hét lên.
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError("Không dùng được passkey trên thiết bị này.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleClick()}
        disabled={busy}
        className="w-full"
      >
        {/* Biểu tượng vẽ SVG nét, không dùng emoji (SKILL.md §7). */}
        <KeyIcon />
        {busy ? "Đang chờ thiết bị…" : "Đăng nhập bằng passkey"}
      </Button>

      <p className="mt-2 text-center text-xs text-muted">
        Không cần nhập email. Mở khoá bằng vân tay hoặc Face ID.
      </p>

      {error && (
        <Notice tone="danger" role="alert" className="mt-2">
          {error}
        </Notice>
      )}
    </div>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0 text-muted"
      aria-hidden
      focusable="false"
    >
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7M16.5 6.5l2.5 2.5M14 9l2 2" />
    </svg>
  );
}
