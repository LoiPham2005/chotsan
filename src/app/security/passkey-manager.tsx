"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Notice } from "@/components/ui/notice";
import { apiPath } from "@/lib/api/version";
import { removePasskeyAction } from "./actions";

type PasskeyRow = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * Thêm/xoá passkey.
 *
 * Việc THÊM đi qua REST (`apiPath("/auth/passkeys/register/*")`) chứ không qua
 * Server Action: `navigator.credentials.create()` trả về một đối tượng có
 * `ArrayBuffer` bên trong, và thư viện `@simplewebauthn/browser` đã chuyển nó
 * thành JSON thuần. Gửi JSON đó qua `fetch` là thẳng nhất — cùng endpoint mà
 * app mobile dùng, nên không có hai đường code phải giữ cho khớp nhau.
 *
 * Cookie phiên đi kèm tự động (`getApiSession` đọc header Authorization trước,
 * rồi mới tới cookie), và cookie đặt `sameSite: "lax"` nên không CSRF được.
 *
 * Xoá có bước xác nhận NGAY TẠI DÒNG (`ConfirmButton`), không dùng
 * `window.confirm`: hộp thoại của trình duyệt bị trình duyệt nhúng trong
 * Zalo/Facebook tắt đi — nút thành im lặng.
 */
export function PasskeyManager({
  available,
  passkeys,
}: {
  available: boolean;
  passkeys: PasskeyRow[];
}) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void import("@simplewebauthn/browser").then(({ browserSupportsWebAuthn }) => {
      setSupported(browserSupportsWebAuthn());
    });
  }, []);

  if (!available) {
    return (
      <Notice tone="neutral">
        Máy chủ chưa cấu hình WebAuthn. Cần <code className="font-mono">APP_URL</code> (hoặc{" "}
        <code className="font-mono">WEBAUTHN_RP_ID</code> +{" "}
        <code className="font-mono">WEBAUTHN_ORIGINS</code>) trong{" "}
        <code className="font-mono">.env</code>.
      </Notice>
    );
  }

  async function handleAdd() {
    setBusy(true);
    setError(null);

    try {
      const { startRegistration } = await import("@simplewebauthn/browser");

      const optionsResponse = await fetch(apiPath("/auth/passkeys/register/options"), {
        method: "POST",
      });
      if (!optionsResponse.ok) throw new Error("options");

      /*
       * Ép kiểu ở ĐÂY là không tránh được: `response.json()` trả `any`, và
       * đây là ranh giới HTTP thật.
       *
       * Không mô tả lại cấu trúc WebAuthn bằng Zod là có chủ đích — đặc tả còn
       * đang tiến hoá, và một bản chép tay sẽ bắt đầu từ chối những trình
       * duyệt hợp lệ. Giá trị này do CHÍNH máy chủ của ta sinh ra ở bước
       * `/register/options`, nên nó không phải dữ liệu không tin được.
       */
      const { data } = (await optionsResponse.json()) as {
        data: {
          options: Parameters<typeof startRegistration>[0]["optionsJSON"];
          challengeToken: string;
        };
      };

      const credential = await startRegistration({ optionsJSON: data.options });

      const verifyResponse = await fetch(apiPath("/auth/passkeys/register/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeToken: data.challengeToken,
          response: credential,
          // Tên gợi nhớ để người dùng phân biệt nhiều thiết bị. Không bắt nhập
          // ở bước này — thêm một hộp thoại nữa giữa lúc chờ vân tay là cách
          // nhanh nhất khiến người ta bỏ dở.
          name: navigator.platform || null,
        }),
      });

      if (!verifyResponse.ok) {
        const body = (await verifyResponse.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "Không lưu được passkey.");
        return;
      }

      router.refresh();
    } catch (err) {
      // Người dùng bấm Huỷ ở hộp thoại hệ điều hành cũng rơi vào đây. Không
      // phải lỗi — đừng hét lên.
      const name = err instanceof Error ? err.name : "";
      if (name !== "NotAllowedError" && name !== "AbortError") {
        setError("Không tạo được passkey trên thiết bị này.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {passkeys.length === 0 ? (
        <p className="text-sm text-muted">Chưa có passkey nào.</p>
      ) : (
        <ul className="divide-y divide-line rounded-token-md border border-line">
          {passkeys.map((passkey) => {
            const label = passkey.name ?? "Passkey không tên";

            return (
              <li key={passkey.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-content">{label}</p>
                  <p className="text-xs text-muted">
                    Tạo {passkey.createdAt} ·{" "}
                    {passkey.lastUsedAt ? `dùng lần cuối ${passkey.lastUsedAt}` : "chưa dùng"}
                  </p>
                </div>

                {/* Service từ chối nếu đây là cách đăng nhập CUỐI CÙNG — xoá được
                    thì người dùng tự khoá mình ra ngoài vĩnh viễn. */}
                <form
                  className="max-w-full"
                  action={async () => {
                    setError(null);
                    const result = await removePasskeyAction(passkey.id);
                    if (result.error) setError(result.error);
                  }}
                >
                  <ConfirmButton
                    label="Xoá"
                    prompt={`Xoá passkey "${label}"? Thiết bị đó không đăng nhập bằng passkey được nữa.`}
                    confirmLabel="Xác nhận xoá"
                    pendingLabel="Đang xoá…"
                  />
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      {supported ? (
        <div>
          {/* Nút VIỀN: nút đặc duy nhất của trang là "Bật 2FA" (SKILL.md §1, luật 1). */}
          <Button type="button" variant="outline" onClick={() => void handleAdd()} disabled={busy}>
            {busy ? "Đang chờ thiết bị…" : "Thêm passkey"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Trình duyệt này không hỗ trợ passkey.</p>
      )}
    </div>
  );
}
