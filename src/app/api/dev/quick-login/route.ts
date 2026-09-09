import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { landingPathFor } from "@/lib/landing";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { authService } from "@/services/auth.service";

/**
 * Đăng nhập nhanh bằng tài khoản mẫu — CHỈ Ở MÔI TRƯỜNG DEV.
 *
 * ---
 * BA LỚP CHẶN, KHÔNG PHẢI MỘT
 *
 * 1. `NODE_ENV` — trên production trả 404 ngay, không đọc gì thêm.
 * 2. Chỉ nhận email kết thúc bằng `@dev.local` — dữ liệu mẫu do `pnpm db:seed`
 *    tạo ra, không phải tài khoản thật của ai.
 * 3. Vẫn gọi `validateCredentials` như đăng nhập bình thường: mật khẩu phải
 *    đúng, tài khoản phải chưa bị khoá. Đây KHÔNG phải đường tắt bỏ qua xác
 *    thực — nó chỉ tiết kiệm thao tác gõ.
 *
 * Ba lớp vì một lớp là đủ để hỏng: `NODE_ENV` bị đặt sai lúc deploy là chuyện
 * xảy ra thật, và khi đó hai lớp còn lại vẫn giữ được cửa.
 */
const DEV_DOMAIN = "@dev.local";

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const form = await request.formData();

  // `formData.get()` trả `string | File | null`. Ép `String()` lên một `File`
  // cho ra "[object Object]" — kiểm kiểu tường minh thay vì để nó lọt qua.
  const identifier = form.get("identifier");
  const password = form.get("password");

  if (typeof identifier !== "string" || typeof password !== "string") {
    return new NextResponse(null, { status: 400 });
  }

  if (!identifier.endsWith(DEV_DOMAIN)) {
    return new NextResponse(null, { status: 404 });
  }

  const user = await authService.validateCredentials({ identifier, password });

  await createSession({
    typ: "access" as const,
    sub: user.id,
    email: user.email,
    roles: user.roles,
  });

  // Cùng luật với đăng nhập thường: `?next=` thắng, không có thì về đúng chỗ
  // làm việc của vai. Bấm nút "Quản trị" phải vào thẳng khu quản trị.
  const next = form.get("next");
  const dich = typeof next === "string" && next ? next : await landingPathFor(user.id);
  // 303: sau một POST phải chuyển sang GET, nếu không bấm F5 là gửi lại form.
  return NextResponse.redirect(new URL(safeRedirectPath(dich, "/"), request.url), 303);
}
