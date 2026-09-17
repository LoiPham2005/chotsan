"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import {
  beginTwoFactorSetupAction,
  disableTwoFactorAction,
  enableTwoFactorAction,
  regenerateRecoveryCodesAction,
} from "./actions";

type Props = {
  enabled: boolean;
  available: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
};

/**
 * Bật/tắt 2FA.
 *
 * Luồng bật là BA bước, không phải một — bước xác nhận mã chứng minh app xác
 * thực ĐÃ lưu đúng bí mật. Bật ngay sau khi hiện QR thì người quét hỏng sẽ bị
 * khoá vĩnh viễn khỏi tài khoản của chính mình.
 *
 * Ô mã và ô mật khẩu là ô CÓ KIỂM SOÁT, không nằm trong `<form>`: báo lỗi (mã
 * sai, mật khẩu sai) thì chữ vừa gõ vẫn còn để sửa. Chúng không đi qua máy chủ
 * để quay lại — mã và mật khẩu chỉ nằm trong trình duyệt của chính người gõ.
 */
export function TwoFactorManager({ enabled, available, enabledAt, recoveryCodesRemaining }: Props) {
  const [isPending, startTransition] = useTransition();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!setup || !canvasRef.current) return;

    // Nạp động: thư viện QR chỉ cần khi người dùng thật sự bật 2FA, không phải
    // trong bundle của mọi lần mở trang.
    const canvas = canvasRef.current;
    void import("qrcode").then(({ default: QRCode }) => {
      void QRCode.toCanvas(canvas, setup.uri, { width: 200, margin: 1 });
    });
  }, [setup]);

  if (!available) {
    // Hiện một nút mà bấm vào chỉ ra lỗi cấu hình máy chủ thì tệ hơn là nói
    // thẳng vì sao chưa dùng được.
    return (
      <Notice tone="neutral">
        Máy chủ chưa cấu hình <code className="font-mono">ENCRYPTION_KEY</code> nên chưa bật được
        2FA. Sinh khoá bằng <code className="font-mono">openssl rand -base64 32</code> rồi đặt vào{" "}
        <code className="font-mono">.env</code>.
      </Notice>
    );
  }

  if (recoveryCodes) {
    return (
      <div>
        {/* Đỏ, không phải xám: bỏ qua bước này là có ngày mất hẳn tài khoản. */}
        <Notice tone="danger" as="div">
          <strong>Lưu ngay bộ mã dưới đây.</strong> Đây là lần DUY NHẤT chúng hiện ra. Mất điện
          thoại mà không có mã khôi phục thì không còn đường vào tài khoản.
        </Notice>
        <ul className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Mã khôi phục">
          {recoveryCodes.map((item) => (
            <li
              key={item}
              className="rounded-token-md border border-line bg-elevated px-2 py-2 text-center font-mono text-sm font-semibold tracking-wider text-content"
            >
              {item}
            </li>
          ))}
        </ul>
        <Button type="button" onClick={() => setRecoveryCodes(null)}>
          Tôi đã lưu xong
        </Button>
      </div>
    );
  }

  if (enabled) {
    const handleDisable = () => {
      setError(null);
      startTransition(async () => {
        const result = await disableTwoFactorAction(password, code);
        if (result.error) setError(result.error);
        else {
          setCode("");
          setPassword("");
        }
      });
    };

    const handleRegenerate = () => {
      setError(null);
      startTransition(async () => {
        const result = await regenerateRecoveryCodesAction(code);
        if (result.error) setError(result.error);
        else {
          setCode("");
          setRecoveryCodes(result.recoveryCodes ?? []);
        }
      });
    };

    return (
      <div className="grid gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="rounded-full bg-brand-tint px-2.5 py-0.5 text-xs font-semibold text-brand-text ring-1 ring-brand-line">
            Đang bật
          </span>
          {enabledAt && <span>từ {enabledAt}</span>}
        </p>
        <p className="text-sm text-muted">
          Còn <strong className="text-content">{recoveryCodesRemaining}</strong> mã khôi phục chưa
          dùng.
        </p>

        <div className="grid max-w-md gap-3">
          <div>
            <label
              htmlFor="two-factor-manage-code"
              className="mb-1.5 block text-sm font-semibold text-content"
            >
              Mã xác thực (hoặc mã khôi phục)
            </label>
            <Input
              id="two-factor-manage-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              placeholder="123456"
              className="font-mono tracking-widest"
            />
          </div>
          <div>
            <label
              htmlFor="two-factor-manage-password"
              className="mb-1.5 block text-sm font-semibold text-content"
            >
              Mật khẩu (chỉ cần khi TẮT 2FA)
            </label>
            <Input
              id="two-factor-manage-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleRegenerate} disabled={isPending}>
            Cấp lại mã khôi phục
          </Button>
          {/* Tắt 2FA là HẠ mức bảo vệ — kiểu nút nguy hiểm, không phải nút phụ. */}
          <Button type="button" variant="destructive" onClick={handleDisable} disabled={isPending}>
            Tắt 2FA
          </Button>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="grid gap-3">
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <div>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await beginTwoFactorSetupAction();
                if (result.error) setError(result.error);
                else if (result.secret && result.uri)
                  setSetup({ secret: result.secret, uri: result.uri });
              });
            }}
          >
            {isPending ? "Đang tạo…" : "Bật 2FA"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-content">
        Quét mã QR bằng ứng dụng xác thực, hoặc nhập tay khoá bí mật dưới đây.
      </p>

      {/*
        QR vẽ NGAY TRONG TRÌNH DUYỆT, không gọi dịch vụ sinh QR nào.

        Chuỗi `otpauth://` chứa CHÍNH bí mật TOTP. Đưa nó vào URL của một dịch
        vụ bên ngoài (api.qrserver.com và tương tự) là trao thẳng yếu tố thứ
        hai cho bên thứ ba, và để lại bản sao trong log truy cập của họ.
      */}
      <canvas
        ref={canvasRef}
        width={200}
        height={200}
        role="img"
        aria-label="Mã QR thiết lập 2FA"
        className="h-[216px] w-[216px] rounded-token-md border border-line bg-surface p-2"
      />

      <code className="break-all rounded-token-md bg-elevated px-3 py-2 font-mono text-sm text-content">
        {setup.secret}
      </code>

      <div className="max-w-md">
        <label
          htmlFor="two-factor-setup-code"
          className="mb-1.5 block text-sm font-semibold text-content"
        >
          Nhập mã 6 số từ ứng dụng để xác nhận
        </label>
        <Input
          id="two-factor-setup-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="123456"
          autoComplete="one-time-code"
          inputMode="numeric"
          className="font-mono tracking-widest"
        />
      </div>

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={isPending || code.length === 0}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await enableTwoFactorAction(code);
              if (result.error) setError(result.error);
              else {
                setSetup(null);
                setCode("");
                setRecoveryCodes(result.recoveryCodes ?? []);
              }
            });
          }}
        >
          {isPending ? "Đang bật…" : code.length === 0 ? "Nhập mã để bật" : "Xác nhận và bật"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setSetup(null)} disabled={isPending}>
          Thôi
        </Button>
      </div>
    </div>
  );
}
