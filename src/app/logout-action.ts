"use server";

import { redirect } from "next/navigation";
import { destroySession, getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Đăng xuất phía WEB.
 *
 * ---
 * VÌ SAO KHÔNG GỌI `/api/v1/auth/logout`
 *
 * Endpoint đó dành cho MOBILE: nó nhận Bearer token và một body JSON chứa
 * refresh token cần thu hồi. Form HTML của header gửi lên body rỗng, nên nó
 * trả `{"error":{"code":"VALIDATION_ERROR","message":"Body phải là JSON hợp
 * lệ"}}` — và trình duyệt đứng lại ở trang JSON thô đó, người dùng vẫn đang
 * đăng nhập.
 *
 * Hai bề mặt dùng chung TẦNG NGHIỆP VỤ, không dùng chung endpoint: web giữ
 * phiên bằng cookie `httpOnly`, mobile giữ bằng cặp token. Đăng xuất của web
 * là xoá cookie đó.
 */
export async function logoutAction(): Promise<never> {
  const session = await getSession();

  await destroySession();

  if (session) logger.info("Người dùng đăng xuất", { userId: session.sub });

  // `redirect()` ném exception — phải nằm ngoài mọi try/catch.
  redirect("/");
}
