import { NextResponse } from "next/server";
import { redirectRelative } from "@/lib/api/redirect";
import { createSession } from "@/lib/auth";
import { DomainError, TwoFactorRequiredError } from "@/lib/errors";
import { landingPathFor } from "@/lib/landing";
import { logger } from "@/lib/logger";
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

  let user;
  try {
    user = await authService.validateCredentials({ identifier, password });
  } catch (error) {
    /*
     * Bản cũ không bắt gì: tài khoản mẫu bật 2FA, bị khoá, sai mật khẩu (hoặc
     * database chưa seed) đều ra trang 500 trắng. Đưa về trang đăng nhập kèm
     * lý do. Đăng nhập nhanh KHÔNG hỗ trợ bước 2FA — cấp vé ở đây là mở thêm
     * một đường vào bước 2 không có rate limit.
     */
    if (error instanceof TwoFactorRequiredError) {
      return redirectRelative("/login?quickLogin=2fa", 303);
    }
    if (error instanceof DomainError) {
      return redirectRelative("/login?quickLogin=failed", 303);
    }
    logger.error("Đăng nhập nhanh thất bại", error, { identifier });
    return redirectRelative("/login?quickLogin=failed", 303);
  }

  await createSession({
    typ: "access" as const,
    sub: user.id,
    email: user.email,
    roles: user.roles,
  });

  // Cùng luật với đăng nhập thường: `?next=` thắng, không có thì về đúng chỗ
  // làm việc của vai. Bấm nút "Quản trị" phải vào thẳng khu quản trị.
  const next = form.get("next");
  const destination = typeof next === "string" && next ? next : await landingPathFor(user.id);
  // 303: sau một POST phải chuyển sang GET, nếu không bấm F5 là gửi lại form.
  // Tương đối, không dựng từ `request.url` — xem `src/lib/api/redirect.ts`.
  return redirectRelative(safeRedirectPath(destination, "/"), 303);
}
