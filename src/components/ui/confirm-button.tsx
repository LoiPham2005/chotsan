"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Nút cho thao tác KHÔNG LẤY LẠI ĐƯỢC — bấm lần đầu mở bước xác nhận ngay tại
 * chỗ, bấm lần hai mới gửi form.
 *
 * ---
 * VÌ SAO KHÔNG DÙNG `window.confirm`
 *
 * Hộp thoại của trình duyệt chặn cả trang, chữ nút theo ngôn ngữ máy ("OK" /
 * "Cancel"), không đặt được ô nhập lý do vào, và trình duyệt nhúng trong Zalo
 * hay Facebook có lúc tắt hẳn nó — nút thành im lặng. Một bước xác nhận nằm
 * ngay dưới nút thì nói được HẬU QUẢ bằng tiếng Việt và chứa được ô lý do.
 *
 * ---
 * BÀN PHÍM
 *
 * Mở bước xác nhận thì tiêu điểm nhảy vào nút xác nhận (Enter lần nữa là gửi,
 * Tab tới "Thôi"); Esc hoặc "Thôi" đóng lại và trả tiêu điểm về nút ban đầu —
 * người dùng bàn phím không bị bỏ lại giữa trang.
 *
 * PHẢI nằm TRONG `<form>`: nút xác nhận là `type="submit"` và đọc `useFormStatus`.
 */
export function ConfirmButton({
  label,
  prompt,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Thôi",
  variant = "outline",
  size = "sm",
  children,
}: {
  /** Chữ trên nút ban đầu, vd "Huỷ lượt đặt". */
  label: string;
  /** Câu hỏi lại — nói rõ HẬU QUẢ, không chỉ "Bạn chắc chứ?". */
  prompt: string;
  /** Chữ trên nút gửi, vd "Xác nhận huỷ". */
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Ô nhập thêm ở bước xác nhận (vd lý do huỷ). */
  children?: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const { pending } = useFormStatus();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const promptId = useId();

  useEffect(() => {
    // Chỉ dời tiêu điểm khi TRẠNG THÁI đổi — lần dựng đầu không được giật tiêu
    // điểm của người đang làm việc khác trên trang.
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={promptId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.preventDefault();
          setConfirming(false);
        }
      }}
      className="w-full rounded-token-md border border-line bg-elevated p-3"
    >
      <p id={promptId} className="text-sm font-medium text-content">
        {prompt}
      </p>

      {children && <div className="mt-2">{children}</div>}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button ref={confirmRef} type="submit" variant="destructive" size={size} disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={size}
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
