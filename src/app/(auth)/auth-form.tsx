import type { AuthFieldName, AuthFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

export type Field = {
  /**
   * Dùng chung union với `AuthFormState.fieldErrors`. Nhờ vậy một ô không tồn
   * tại trong schema sẽ bị TypeScript chặn ngay tại đây, thay vì lặng lẽ gửi
   * lên rồi bị Zod strip mất — đúng lỗi đã làm hỏng đăng nhập trước đây.
   */
  name: AuthFieldName;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  /** Chú thích dưới ô, cho những trường tuỳ chọn cần giải thích thêm. */
  hint?: string;
};

/** Khoảng cách giữa các ô của mọi form xác thực. */
export const AUTH_FORM_CLASS = "grid gap-4";

/** Tiêu đề + một câu dẫn ở đầu mỗi trang xác thực. */
export function AuthHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-extrabold tracking-tight text-content">{title}</h1>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

/**
 * Phần hiển thị dùng chung của form đăng nhập/đăng ký.
 *
 * Cố ý KHÔNG nhận Server Action qua prop: khi action đi xuyên qua ranh giới
 * prop, React không nhúng được `$ACTION_ID` vào HTML và form ngừng hoạt động
 * nếu trình duyệt chưa tải xong JS. Vì vậy mỗi form (login-form/register-form)
 * tự import action của nó, còn file này chỉ lo phần nhìn.
 *
 * ---
 * GIỮ CHỮ VỪA GÕ SAU KHI BÁO LỖI — TRỪ MẬT KHẨU
 *
 * React 19 tự xoá trắng form sau mỗi lần action chạy xong, KỂ CẢ khi action báo
 * lỗi: gõ sai mật khẩu là mất luôn email vừa gõ. Action trả lại những gì đã gửi
 * trong `state.values` và ô dựng lại bằng giá trị đó. Ô mật khẩu KHÔNG BAO GIỜ
 * có trong `values` — mật khẩu không được đi ngược từ máy chủ về HTML.
 */
export function AuthFields({
  fields,
  state,
  isPending,
  submitLabel,
  pendingLabel,
  nextPath,
}: {
  fields: Field[];
  state: AuthFormState;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  nextPath?: string;
}) {
  return (
    <>
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="mb-1.5 block text-sm font-semibold text-content">
            {field.label}
          </label>

          {/* `Input` tự lo aria-invalid và aria-describedby — xem ghi chú trong
              component. Trước đây phần nối trợ năng đó phải chép tay ở từng
              form, và hai trong ba form đã quên. */}
          <Input
            id={field.name}
            name={field.name}
            type={field.type ?? "text"}
            placeholder={field.placeholder}
            required={field.required}
            autoComplete={field.autoComplete}
            defaultValue={field.name === "password" ? undefined : state.values?.[field.name]}
            error={state.fieldErrors?.[field.name]?.[0]}
            hint={field.hint}
          />
        </div>
      ))}

      {state.error && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? pendingLabel : submitLabel}
      </Button>
    </>
  );
}
