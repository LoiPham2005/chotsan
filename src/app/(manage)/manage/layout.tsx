import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";

/**
 * Khu quản lý của chủ sân.
 *
 * ⚠️ Layout KHÔNG phải ranh giới bảo mật — Server Action không đi qua nó, và
 * mỗi trang con cần một quyền khác nhau. Ở đây chỉ chặn người CHƯA ĐĂNG NHẬP
 * để họ thấy màn đăng nhập thay vì 404; quyền trên từng sân do trang con tự
 * kiểm bằng `requireVenueAccess`, action tự kiểm bằng `defineVenueAction`.
 */
export default async function ManageLayout({ children }: { children: ReactNode }) {
  await requireUser("/manage");
  return <>{children}</>;
}
