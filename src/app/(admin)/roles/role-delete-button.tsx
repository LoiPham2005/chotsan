"use client";

import { useState } from "react";
import { deleteRoleAction } from "./actions";
import { ConfirmButton } from "@/components/ui/confirm-button";

/**
 * Xoá một vai trò không phải của hệ thống.
 *
 * Vai trò còn người dùng thì KHÔNG có nút xoá — chỉ một dòng nói phải làm gì
 * trước (SKILL.md: nút không bấm được phải nói cần làm gì để bấm được). Bản cũ
 * hiện nút rồi bật `window.alert` khi bấm. Luật thật vẫn nằm trong service và
 * chạy dù ai đó gọi thẳng action.
 */
export function RoleDeleteButton({ roleKey, userCount }: { roleKey: string; userCount: number }) {
  const [error, setError] = useState<string | null>(null);

  if (userCount > 0) {
    return (
      <p className="max-w-[16rem] text-xs text-muted">
        Còn {userCount} người mang vai trò này — chuyển họ sang vai trò khác rồi mới xoá được.
      </p>
    );
  }

  return (
    <form
      className="max-w-full"
      action={async () => {
        setError(null);
        const res = await deleteRoleAction(roleKey);
        if (res.error) setError(res.error);
      }}
    >
      <ConfirmButton
        label="Xoá vai trò"
        prompt={`Xoá vai trò "${roleKey}"? Không lấy lại được bộ quyền đã tick.`}
        confirmLabel="Xác nhận xoá"
        pendingLabel="Đang xoá…"
        variant="destructive"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}
