import type { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { hash } from "@node-rs/argon2";

/**
 * Dữ liệu mẫu cho môi trường DEV.
 *
 * KHÔNG BAO GIỜ chạy trên production — mật khẩu ở đây nằm công khai trong mã
 * nguồn. `seed.ts` chặn điều đó bằng `NODE_ENV`.
 */
const DEV_PASSWORD = "matkhau123";

/*
 * ChốtSân chỉ có BA vai trò nền tảng. "Chủ sân" và "nhân viên" không nằm ở đây
 * — chúng là dòng trong `VenueMember`, tạo ra khi seed sân mẫu bên dưới.
 */
const DEV_USERS = [
  { email: "admin@dev.local", fullName: "Quản trị viên Dev", role: SYSTEM_ROLES.ADMIN },
  { email: "chusan@dev.local", fullName: "Chủ sân Dev", role: SYSTEM_ROLES.USER },
  { email: "nhanvien@dev.local", fullName: "Nhân viên Dev", role: SYSTEM_ROLES.USER },
  { email: "user@dev.local", fullName: "Người dùng Dev", role: SYSTEM_ROLES.USER },
];

export async function seedDev(prisma: PrismaClient): Promise<void> {
  // Băm MỘT LẦN rồi dùng lại cho cả bốn tài khoản: Argon2id cố tình tốn ~100ms
  // mỗi lần, và ở đây tất cả đều dùng chung một mật khẩu nên băm lại là lãng
  // phí thuần tuý.
  const password = await hash(DEV_PASSWORD, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const item of DEV_USERS) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { key: item.role },
      select: { id: true },
    });

    // `upsert` cần một khoá DUY NHẤT mà Prisma biết, nhưng `email` được ràng
    // buộc bằng partial unique index viết tay (xem model `User`). Nên: tìm
    // trước, tạo sau.
    const existing = await prisma.user.findFirst({
      where: { email: item.email, deletedAt: null },
      select: { id: true },
    });

    const user =
      existing ??
      (await prisma.user.create({
        data: {
          email: item.email,
          password,
          emailVerifiedAt: new Date(),
          status: "ACTIVE",
          profile: { create: { fullName: item.fullName } },
        },
        select: { id: true },
      }));

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  console.log(`✓ Đã tạo ${DEV_USERS.length} tài khoản dev (mật khẩu chung: ${DEV_PASSWORD})`);
}
