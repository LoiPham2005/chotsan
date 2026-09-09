import "server-only";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

/**
 * Đăng nhập xong thì về đâu.
 *
 * ---
 * MỖI VAI VỀ ĐÚNG CHỖ LÀM VIỆC CỦA MÌNH
 *
 * Một đích chung cho mọi người là sai với gần hết mọi người: quản trị viên
 * đăng nhập để duyệt cơ sở, chủ sân để xem lịch hôm nay, nhân viên để trực
 * sân. Ném tất cả về trang chủ bán hàng là bắt họ tự đi tìm đường mỗi lần.
 *
 * Bộ khung để lại `/users` — màn quản trị cần `user:read`, mà gần như không ai
 * trong ChốtSân có, nên đăng nhập xong là rơi vào 404. Sửa vội thành `/` thì
 * hết 404 nhưng vẫn sai với ba trong bốn vai.
 *
 * ---
 * THỨ TỰ XÉT: NỀN TẢNG → SÂN → KHÁCH
 *
 * Từ hẹp tới rộng. Quyền toàn nền tảng là thứ hiếm và được cấp có chủ đích,
 * nên ai có nó gần như chắc chắn đăng nhập để làm việc đó. Người vừa quản trị
 * nền tảng vừa có sân là trường hợp hiếm; họ vẫn tới được khu quản lý bằng
 * một cú bấm trên thanh điều hướng.
 */
export async function landingPathFor(userId: string): Promise<string> {
  const [canApproveVenues, canManageInvoices, canReadUsers, canReadRoles] = await Promise.all([
    permissionService.can(userId, "venue:approve"),
    permissionService.can(userId, "invoice:manage"),
    permissionService.can(userId, "user:read"),
    permissionService.can(userId, "role:read"),
  ]);

  if (canApproveVenues) return "/venue-approvals";
  if (canManageInvoices) return "/invoices";
  if (canReadUsers) return "/users";
  if (canReadRoles) return "/roles";

  // Chủ sân và nhân viên. `/manage` tự vào thẳng khi chỉ quản một sân, nên
  // người có đúng một cơ sở không phải bấm thêm lần nào.
  const venues = await venueService.listForUser(userId);
  if (venues.length > 0) return "/manage";

  return "/";
}
