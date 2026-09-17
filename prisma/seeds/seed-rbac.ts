import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_METADATA,
  resolveSeedPermissions,
} from "@/lib/permissions";

/**
 * Đồng bộ danh mục quyền và vai trò hệ thống TỪ CODE xuống database.
 *
 * Chạy được nhiều lần, và PHẢI chạy đầu tiên trong mọi bộ seed — không có vai
 * trò thì không tạo được người dùng nào.
 *
 * ---
 * NGUYÊN TẮC: CHỈ THÊM, KHÔNG GHI ĐÈ
 *
 * Đây là điểm quan trọng nhất của file này. Quyền gán cho vai trò là thứ quản
 * trị viên chỉnh sửa trên giao diện. Nếu seed ghi đè lại theo
 * `DEFAULT_ROLE_PERMISSIONS` thì mỗi lần deploy sẽ xoá sạch công sức cấu hình
 * của khách hàng — và không ai hiểu vì sao phân quyền "tự nhiên quay về như cũ".
 *
 * Nên: quyền còn thiếu thì thêm vào, quyền đã bị gỡ bỏ có chủ đích thì để yên.
 *
 * ---
 * "CÒN THIẾU" NGHĨA LÀ GÌ
 *
 * Bảng `role_permissions` không nhớ một dòng "chưa từng có" hay "đã bị gỡ".
 * Bản trước thêm lại MỌI quyền mặc định còn thiếu, nên quản trị viên gỡ
 * `user:delete` khỏi ADMIN thì lần deploy sau nó quay lại. Giờ chỉ gắn quyền
 * mặc định khi chắc chắn không ai từng quyết định về nó:
 *
 *   (a) vai trò VỪA được tạo trong lần chạy này — chưa ai kịp chỉnh;
 *   (b) khoá quyền CHƯA TỪNG có trong database trước lần chạy — quyền mới thêm
 *       vào code, chưa ai kịp gỡ.
 *
 * Ngoại lệ: vai trò khai `"*"` (SUPER_ADMIN) luôn được bù đủ mọi quyền — "toàn
 * quyền" mà thiếu một quyền là mâu thuẫn, không phải cấu hình.
 */
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  // Chụp danh mục TRƯỚC khi đồng bộ: khoá nào không có ở đây là quyền mới.
  const knownKeys = new Set(
    (await prisma.permission.findMany({ select: { key: true } })).map(({ key }) => key),
  );

  // 1. Danh mục quyền. Nguồn sự thật là hằng PERMISSIONS trong code, nên ở đây
  //    ghi đè phần mô tả là ĐÚNG — đó là dữ liệu của code, không phải của người
  //    dùng.
  for (const key of PERMISSIONS) {
    const meta = PERMISSION_METADATA[key];
    await prisma.permission.upsert({
      where: { key },
      update: { name: meta.name, category: meta.category, description: meta.description },
      create: { key, name: meta.name, category: meta.category, description: meta.description },
    });
  }

  // 2. Vai trò hệ thống.
  for (const seed of DEFAULT_ROLE_PERMISSIONS) {
    const isNewRole =
      (await prisma.role.findUnique({ where: { key: seed.key }, select: { id: true } })) === null;

    const role = await prisma.role.upsert({
      where: { key: seed.key },
      // KHÔNG đụng vào `name`/`description` nếu vai trò đã tồn tại: khách hàng
      // có thể đã đổi tên hiển thị cho hợp ngữ cảnh của họ.
      //
      // `level` thì NGƯỢC LẠI — luôn đồng bộ từ code. Nó không phải nhãn hiển
      // thị mà là ràng buộc bảo mật: bậc của SUPER_ADMIN bị ai đó hạ xuống 5
      // nghĩa là mọi ADMIN đều thao tác được lên tài khoản quản trị tối cao.
      // Thứ như vậy phải có đúng một nguồn sự thật, và nó nằm trong code.
      update: { isSystem: true, level: seed.level },
      create: {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        level: seed.level,
        isSystem: true,
      },
      select: { id: true },
    });

    const wanted = resolveSeedPermissions(seed).filter(
      (key) => seed.permissions === "*" || isNewRole || !knownKeys.has(key),
    );
    if (wanted.length === 0) continue;

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...wanted] } },
      select: { id: true },
    });

    // `skipDuplicates`: dòng đã có thì bỏ qua — chạy lại bao nhiêu lần cũng vậy.
    await prisma.rolePermission.createMany({
      data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }
}
